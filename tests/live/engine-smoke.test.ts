/**
 * LIVE SMOKE TEST — probes the Gate CrossEx venue behaviors the engine's
 * adapter (src/engine/venueGate.ts) depends on but the SDK/docs leave unverified
 * (MAKER-HEDGE.md §13/§17). It RECORDS verdicts rather than asserting venue
 * behavior: the whole point is that we do not know the answers yet. Run it once,
 * read the "SMOKE VERDICTS" block, adjust venueGate.ts accordingly.
 *
 * What it probes:
 *   P1  create-response shape (which fields really come back)
 *   P2  GET order by client text as the order-id path param ('t-…' form)
 *   P3  text WITHOUT the 't-' prefix: accepted at create? readable? cancelable by text?
 *   P4  the post-terminal text-lookup window (read at +5s and +70s after cancel)
 *   P5  history listing semantics: `from` units (seconds vs ms), symbol filter, pagination
 *   P6  POC would-cross outcome: create-reject label vs accepted-then-insta-cancel (state+reason)
 *   P7  IOC zero-fill terminal state string
 *
 * Risk profile: two far-from-market POC probes and one unfillable IOC (cannot
 * execute; charged $0 against the budget, still gated by the hard ceiling), plus
 * ONE would-cross POC at the smallest valid qty — the only order that could
 * execute if POC semantics are broken (bounded ≈ $5-10; auto-closed reduce-only
 * immediately if it happens, and that outcome is itself a critical verdict).
 *
 * Run (never in CI):
 *   LIVE_TRADE_ACK="I understand real orders will be placed with real money" \
 *     yarn test:live:smoke
 *
 * If the process dies mid-run the resting probes are 20% away from the market
 * and cannot fill; cancel them on Gate's UI (texts start with "t-lt…"/"lt…"),
 * or run `yarn live:cleanup` for the position/close backstop.
 */
import { afterAll, beforeAll, describe, it } from 'vitest';
import type { Clients } from '../../src/core/clients';
import { formatLimitPrice } from '../../src/core/numbers';
import { marketableClosePrice } from '../../src/core/orders';
import { CrossexOrderRequest } from 'gate-api';
import { closeTestPositions, verifyFlat } from './cleanup-lib';
import { budget, NOTIONAL, runId, TAG } from './env';
import {
  assertAck,
  assertCredentials,
  assertLiveTestsEnabled,
  assertMarginHeadroom,
  assertNoExistingExposure,
  assertNotionalCeiling,
} from './guards';
import { report } from './report';
import { writeLastRun } from './state';
import { selectPairSymbols, smallestValidQty, type SelectedSymbol } from './symbols';

const RUN = process.env.SMOKE === '1';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let clients: Clients;
let sym: SelectedSymbol;
let qty: string;
const placedOrderIds: string[] = [];
const verdicts: string[] = [];

function verdict(line: string): void {
  verdicts.push(line);
  report.note(`[smoke] ${line}`);
  console.log(`  ▸ ${line}`);
}

function errInfo(err: unknown): { status?: number; label?: string; message: string } {
  const e = err as { response?: { status?: number; data?: { label?: string; message?: string } }; message?: string };
  return {
    status: e?.response?.status,
    label: e?.response?.data?.label,
    message: e?.response?.data?.message ?? e?.message ?? String(err),
  };
}

/** Raw create via the SDK; returns the raw body so P1 can inspect its real shape. */
async function rawCreate(o: {
  side: 'BUY' | 'SELL';
  qty: string;
  price?: string;
  tif: 'poc' | 'ioc';
  text: string;
  reduceOnly?: boolean;
}): Promise<Record<string, unknown>> {
  const req = new CrossexOrderRequest();
  req.symbol = sym.symbol;
  req.side = o.side === 'BUY' ? CrossexOrderRequest.Side.BUY : CrossexOrderRequest.Side.SELL;
  req.type = o.price ? CrossexOrderRequest.Type.LIMIT : CrossexOrderRequest.Type.MARKET;
  req.timeInForce = o.tif === 'poc' ? CrossexOrderRequest.TimeInForce.POC : CrossexOrderRequest.TimeInForce.IOC;
  req.qty = o.qty;
  if (o.price) req.price = o.price;
  if (o.reduceOnly) req.reduceOnly = CrossexOrderRequest.ReduceOnly.True;
  req.text = o.text;
  const { body } = await clients.crossEx.createCrossexOrder({ crossexOrderRequest: req });
  const raw = body as unknown as Record<string, unknown>;
  if (raw.orderId !== undefined) placedOrderIds.push(String(raw.orderId));
  return raw;
}

async function readById(id: string): Promise<{ ok: boolean; state?: string; cum?: string; reason?: string; err?: ReturnType<typeof errInfo> }> {
  try {
    const { body } = await clients.crossEx.getCrossexOrder(id);
    report.observeState(String(body.state ?? ''), `smoke read ${id}`);
    return { ok: true, state: String(body.state ?? ''), cum: String(body.executedQty ?? ''), reason: String(body.reason ?? '') };
  } catch (err) {
    return { ok: false, err: errInfo(err) };
  }
}

describe.skipIf(!RUN)('live smoke — Gate CrossEx venue-behavior probes', () => {
  beforeAll(async () => {
    console.log('smoke: probes are far-POC/IOC (cannot fill) + ONE minimal would-cross POC');
    assertLiveTestsEnabled();
    assertAck();
    assertNotionalCeiling();
    clients = assertCredentials();
    const sel = await selectPairSymbols(clients, NOTIONAL);
    sym = sel.primary; // one symbol is enough for every probe
    await assertNoExistingExposure(clients, [sym.symbol]);
    await assertMarginHeadroom(clients);
    qty = smallestValidQty(sym.rule, sym.refPrice);
    writeLastRun({ runId, tag: TAG, symbols: [sym.symbol], startedAt: Date.now() });
    report.note(`[smoke] symbol=${sym.symbol} ref=${sym.refPrice} qty=${qty} (~$${(Number(qty) * sym.refPrice).toFixed(2)})`);
  }, 120_000);

  afterAll(async () => {
    // Backstop: cancel everything we placed (by recorded id — texts vary by design),
    // close any accidental position, verify flat, and print the verdict block.
    for (const id of placedOrderIds) {
      try {
        await clients.crossEx.cancelCrossexOrder(id);
        report.cleanup(`smoke: canceled ${id} (or already terminal)`);
      } catch {
        /* already terminal — fine */
      }
    }
    try {
      await closeTestPositions(clients, [sym.symbol], (m) => report.cleanup(`smoke: ${m}`));
      const flat = await verifyFlat(clients, [sym.symbol]);
      report.setVerdict(flat);
      if (!flat) console.error(`NOT FLAT on ${sym.symbol} — inspect on Gate and run yarn live:cleanup`);
    } catch (err) {
      report.cleanup(`smoke cleanup error: ${(err as Error).message}`);
      report.setVerdict(false);
    }
    console.log('\n================ SMOKE VERDICTS ================');
    for (const v of verdicts) console.log(`• ${v}`);
    console.log('===================================================\n');
    report.write();
  }, 120_000);

  it('P1-P2: far POC with a t- text — create shape, read-by-id, read-by-text', async () => {
    budget.beforeOrder(0, 'smoke far POC (t- text)'); // 20% away, post-only: cannot execute
    const text = `t-${TAG}a`;
    const price = formatLimitPrice(sym.refPrice * 0.8, sym.symbol, sym.rule.tickSize);
    const raw = await rawCreate({ side: 'BUY', qty, price, tif: 'poc', text });
    verdict(`P1 create-response keys: ${JSON.stringify(Object.keys(raw))} (values: orderId=${raw.orderId}, text=${raw.text}, state=${raw.state ?? '<absent>'})`);
    await sleep(1_500);

    const byId = await readById(String(raw.orderId));
    verdict(`P1 read-by-id: ok=${byId.ok} state="${byId.state}" cum="${byId.cum}"`);

    const byText = await readById(text);
    verdict(
      byText.ok
        ? `P2 GET-by-text ('${text}') WORKS while live — state="${byText.state}" ✅ venueGate can probe by text directly`
        : `P2 GET-by-text ('${text}') FAILED while live — status=${byText.err?.status} label=${byText.err?.label} ❌ keep the open+history scan fallback`,
    );

    const { body: open } = await clients.crossEx.listCrossexOpenOrders({ symbol: sym.symbol });
    const listed = (open ?? []).find((o) => String(o.orderId) === String(raw.orderId));
    verdict(`P2 open-orders echo: found=${Boolean(listed)} text-echo="${listed?.text ?? '<missing>'}" (verbatim=${listed?.text === text})`);
  }, 60_000);

  it('P3: plain (no t-) text — accepted? readable by text? cancelable by text?', async () => {
    budget.beforeOrder(0, 'smoke far POC (plain text)');
    const text = `${TAG}b`; // legacy-style, no t- prefix
    const price = formatLimitPrice(sym.refPrice * 0.8, sym.symbol, sym.rule.tickSize);
    try {
      const raw = await rawCreate({ side: 'BUY', qty, price, tif: 'poc', text });
      verdict(`P3 plain text ACCEPTED at create (echo="${raw.text}")`);
      await sleep(1_500);
      const byPlain = await readById(text);
      const byPrefixed = byPlain.ok ? { ok: false } : await readById(`t-${text}`);
      verdict(
        `P3 read: by plain="${text}" ok=${byPlain.ok}` +
          (byPlain.ok ? '' : `; by 't-${text}' ok=${byPrefixed.ok}`) +
          ' (tells venueGate which form the lookup needs)',
      );
      try {
        await clients.crossEx.cancelCrossexOrder(text);
        verdict('P3 cancel-by-TEXT works ✅');
      } catch (err) {
        const e = errInfo(err);
        verdict(`P3 cancel-by-TEXT failed (status=${e.status} label=${e.label}) — cancel by numeric id only`);
        await clients.crossEx.cancelCrossexOrder(String((await clients.crossEx.listCrossexOpenOrders({ symbol: sym.symbol })).body?.find((o) => o.text === text)?.orderId ?? ''));
      }
    } catch (err) {
      const e = errInfo(err);
      verdict(`P3 plain text REJECTED at create (status=${e.status} label=${e.label}) — 't-' prefix is REQUIRED ❗ the engine's client ids already comply; plain ids do not`);
    }
  }, 60_000);

  it('P4-P5: cancel the t- probe, then the post-terminal text window + history semantics', async () => {
    const text = `t-${TAG}a`;
    const id = placedOrderIds[0];
    const createdAtSec = Math.floor(Date.now() / 1000) - 120;
    await clients.crossEx.cancelCrossexOrder(id);
    await sleep(5_000);

    const at5s = await readById(text);
    verdict(`P4 GET-by-text +5s after terminal: ok=${at5s.ok} state="${at5s.state ?? ''}" label=${at5s.err?.label ?? '-'}`);
    verdict('P4 waiting 70s to probe the documented 60s post-terminal text window…');
    await sleep(70_000);
    const at75s = await readById(text);
    verdict(
      `P4 GET-by-text +75s: ok=${at75s.ok} label=${at75s.err?.label ?? '-'} ` +
        (at75s.ok ? '(window longer than documented — text stays usable)' : '(60s window CONFIRMED — persist numeric ids immediately, as venueGate does)'),
    );
    const byIdAfter = await readById(id);
    verdict(`P4 GET-by-numeric-id after terminal: ok=${byIdAfter.ok} state="${byIdAfter.state ?? ''}" (must be true — the durable key)`);

    // History listing semantics: symbol filter, `from` variants, pagination.
    // Every variant is individually caught — a 400 is itself a VERDICT (the
    // 2026-07-23 run showed from:<seconds> 400s), never a suite failure.
    const tryHist = async (
      params: { symbol?: string; from?: number; to?: number; limit?: number; page?: number },
    ): Promise<{ rows: number; found: boolean; err?: string }> => {
      try {
        const body = (await clients.crossEx.listCrossexHistoryOrders(params)).body ?? [];
        return { rows: body.length, found: body.some((o) => String(o.orderId) === id) };
      } catch (err) {
        const e = errInfo(err);
        return { rows: -1, found: false, err: `${e.status}/${e.label ?? e.message}` };
      }
    };
    const fmt = (r: { rows: number; found: boolean; err?: string }) =>
      r.err ? `ERR(${r.err})` : `rows=${r.rows} found=${r.found}`;
    const noFrom = await tryHist({ symbol: sym.symbol, limit: 100, page: 1 });
    const fromSec = await tryHist({ symbol: sym.symbol, from: createdAtSec, limit: 100, page: 1 });
    const fromMs = await tryHist({ symbol: sym.symbol, from: createdAtSec * 1000, limit: 100, page: 1 });
    const fromToSec = await tryHist({
      symbol: sym.symbol,
      from: createdAtSec,
      to: Math.floor(Date.now() / 1000),
      limit: 100,
      page: 1,
    });
    const fromToMs = await tryHist({
      symbol: sym.symbol,
      from: createdAtSec * 1000,
      to: Date.now(),
      limit: 100,
      page: 1,
    });
    const page99 = await tryHist({ symbol: sym.symbol, limit: 100, page: 99 });
    verdict(
      `P5 history: no-from ${fmt(noFrom)}; from-SECONDS ${fmt(fromSec)}; from-MILLIS ${fmt(fromMs)}; ` +
        `from+to-SECONDS ${fmt(fromToSec)}; from+to-MILLIS ${fmt(fromToMs)}; page=99 ${fmt(page99)} ` +
        `→ sweepForOrder currently uses NO time bound; if a from-variant works AND finds the order, re-bound it`,
    );
    if (noFrom.rows >= 0) {
      const body = (await clients.crossEx.listCrossexHistoryOrders({ symbol: sym.symbol, limit: 100, page: 1 })).body ?? [];
      const histText = body.find((o) => String(o.orderId) === id)?.text;
      verdict(`P5 history text echo: "${histText ?? '<missing>'}" (verbatim=${histText === text})`);
    }
  }, 150_000);

  it('P6: POC that would cross — reject label or insta-cancel strings', async () => {
    const text = `t-${TAG}c`;
    const price = formatLimitPrice(sym.refPrice * 1.05, sym.symbol, sym.rule.tickSize);
    budget.beforeOrder(Number(qty) * sym.refPrice * 1.05, 'smoke would-cross POC'); // could execute if POC is broken
    try {
      const raw = await rawCreate({ side: 'BUY', qty, price, tif: 'poc', text });
      await sleep(1_000);
      const r1 = await readById(String(raw.orderId));
      verdict(`P6 would-cross POC was ACCEPTED (state="${r1.state}" cum="${r1.cum}" reason="${r1.reason}")`);
      if (Number(r1.cum) > 0) {
        verdict('P6 ❗❗ POC EXECUTED — post-only semantics NOT honored at create. Closing reduce-only now. the engine must treat POC as unsafe on this venue!');
        const closePx = marketableClosePrice(sym.refPrice, 'SELL', 1, sym.symbol, sym.rule.tickSize);
        await rawCreate({ side: 'SELL', qty: r1.cum!, price: closePx, tif: 'ioc', text: `t-${TAG}x`, reduceOnly: true });
      } else {
        await sleep(2_000);
        const r2 = await readById(String(raw.orderId));
        verdict(
          `P6 insta-cancel probe +3s: state="${r2.state}" reason="${r2.reason}" ` +
            `→ ${/CANCEL|IOC|FINISH|REJECT/i.test(r2.state ?? '') ? `accepted-then-dead; loop's CLOSEDISH must match "${r2.state}" and POC_REASON must match reason="${r2.reason}"` : 'still open?! cancel + inspect manually'}`,
        );
      }
    } catch (err) {
      const e = errInfo(err);
      verdict(
        `P6 would-cross POC REJECTED at create: status=${e.status} label="${e.label}" msg="${e.message}" ` +
          `→ allowlist ${e.label && /POST_ONLY|POC|IMMEDIATE/i.test(e.label) ? 'already matches ✅' : `MUST ADD "${e.label}" ❗`}`,
      );
    }
  }, 60_000);

  it('P7: unfillable IOC — zero-fill terminal state string', async () => {
    budget.beforeOrder(0, 'smoke unfillable IOC'); // 20% below market: cannot fill
    const text = `t-${TAG}d`;
    const price = formatLimitPrice(sym.refPrice * 0.8, sym.symbol, sym.rule.tickSize);
    try {
      const raw = await rawCreate({ side: 'BUY', qty, price, tif: 'ioc', text });
      await sleep(1_500);
      const r = await readById(String(raw.orderId));
      verdict(`P7 IOC whiff terminal: state="${r.state}" reason="${r.reason}" cum="${r.cum}" → loop's CLOSEDISH must match "${r.state}"`);
    } catch (err) {
      const e = errInfo(err);
      verdict(`P7 IOC whiff REJECTED at create: label="${e.label}" → whiffs surface as create-rejects on this venue`);
    }
  }, 60_000);
});
