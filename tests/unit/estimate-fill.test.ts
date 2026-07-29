/**
 * estimateFill's labeled fallback chain, driven with an INJECTED fetchBook
 * (deps.fetchBook) and a fake Clients for the reference-price fallback — no network.
 * Pins source/confidence/partialDepth per branch and the ACTUAL slippagePct sign.
 */
import { describe, expect, it } from 'vitest';
import type { Clients } from '../../src/core/clients';
import type { NormalizedBook } from '../../src/core/estimate/books';
import { estimateFill } from '../../src/core/estimate/fill';

/** A book with best bid 99 / best ask 100 (mid 99.5) plus deeper levels. */
const book = (over?: Partial<NormalizedBook>): NormalizedBook => ({
  bids: [
    [99, 10],
    [98, 10],
  ],
  asks: [
    [100, 1],
    [101, 10],
  ],
  ts: 0,
  ...over,
});

/** fetchBook stub: returns `map[exchange]` (default null). */
function fetchBookFor(map: Record<string, NormalizedBook | null>) {
  return async (exchange: string): Promise<NormalizedBook | null> => map[exchange.toUpperCase()] ?? null;
}

/** Fake Clients whose Gate spot ticker yields `last` (drives resolveReferencePrice). */
function clientsWithTicker(last: string | null): Clients {
  return {
    spot: {
      listTickers: async () => ({ body: last == null ? [] : [{ last }] }),
    },
    futures: {
      listFuturesTickers: async () => ({ body: [] }),
    },
  } as unknown as Clients;
}

const noClients = {} as Clients;

describe('estimateFill — venue orderbook (source 1)', () => {
  it('BUY that walks the asks → venue-orderbook / high, positive slippage vs mid', async () => {
    const est = await estimateFill(
      { clients: noClients, fetchBook: fetchBookFor({ BYBIT: book() }) },
      { symbol: 'BYBIT_FUTURE_ETH_USDT', side: 'BUY', qty: '0.5' },
    );
    expect(est).toMatchObject({ source: 'venue-orderbook', confidence: 'high', venue: 'BYBIT' });
    expect(est!.avgPrice).toBe(100); // 0.5 filled entirely at the 100 ask level
    expect(est!.midPrice).toBe(99.5);
    // BUY above mid → paying up → positive.
    expect(est!.slippagePct).toBeGreaterThan(0);
    expect(est!.partialDepth).toBeUndefined();
  });

  it('SELL that walks the bids → slippagePct is ALSO positive (signedSlippage flips SELL)', async () => {
    // signedSlippage returns `side==='BUY' ? raw : -raw`; a SELL fills BELOW mid so raw<0,
    // and -raw>0 — the convention reports "paying up vs mid" as positive on BOTH sides.
    const est = await estimateFill(
      { clients: noClients, fetchBook: fetchBookFor({ BYBIT: book() }) },
      { symbol: 'BYBIT_FUTURE_ETH_USDT', side: 'SELL', qty: '0.5' },
    );
    expect(est!.avgPrice).toBe(99); // filled at the 99 bid
    expect(est!.midPrice).toBe(99.5);
    expect(est!.slippagePct).toBeGreaterThan(0);
  });

  it('walk that exhausts depth → confidence medium + partialDepth', async () => {
    const est = await estimateFill(
      { clients: noClients, fetchBook: fetchBookFor({ BYBIT: book() }) },
      { symbol: 'BYBIT_FUTURE_ETH_USDT', side: 'BUY', qty: '15' }, // asks total only 11
    );
    expect(est).toMatchObject({ source: 'venue-orderbook', confidence: 'medium', partialDepth: true });
  });
});

describe('estimateFill — Gate proxy book (source 2)', () => {
  it('target venue book null but GATE book present → gate-orderbook / medium', async () => {
    const est = await estimateFill(
      { clients: noClients, fetchBook: fetchBookFor({ BINANCE: null, GATE: book() }) },
      { symbol: 'BINANCE_FUTURE_ETH_USDT', side: 'BUY', qty: '0.5' },
    );
    // venue is always the TARGET; source says the numbers came from Gate.
    expect(est).toMatchObject({ source: 'gate-orderbook', confidence: 'medium', venue: 'BINANCE' });
  });

  it('gate proxy that exhausts depth → confidence low', async () => {
    const est = await estimateFill(
      { clients: noClients, fetchBook: fetchBookFor({ BINANCE: null, GATE: book() }) },
      { symbol: 'BINANCE_FUTURE_ETH_USDT', side: 'BUY', qty: '15' },
    );
    expect(est).toMatchObject({ source: 'gate-orderbook', confidence: 'low', partialDepth: true });
  });
});

describe('estimateFill — reference + spread (source 3)', () => {
  it('no books, explicit refPrice → reference+spread / low, avg = ref×(1+bps) for BUY', async () => {
    const est = await estimateFill(
      { clients: noClients, fetchBook: fetchBookFor({}) },
      { symbol: 'GATE_FUTURE_ETH_USDT', side: 'BUY', qty: '0.5', refPrice: 2000 },
    );
    // default EST_SPREAD_BPS = 10 bps → +0.1%
    expect(est).toMatchObject({ source: 'reference+spread', confidence: 'low', midPrice: 2000 });
    expect(est!.avgPrice).toBeCloseTo(2000 * 1.001, 6);
    expect(est!.slippagePct).toBeGreaterThan(0);
  });

  it('SELL haircut is on the LOW side: avg = ref×(1−bps)', async () => {
    const est = await estimateFill(
      { clients: noClients, fetchBook: fetchBookFor({}) },
      { symbol: 'GATE_FUTURE_ETH_USDT', side: 'SELL', qty: '0.5', refPrice: 2000 },
    );
    expect(est!.avgPrice).toBeCloseTo(2000 * 0.999, 6);
    expect(est!.slippagePct).toBeGreaterThan(0); // SELL below ref → reported positive
  });

  it('no refPrice arg → resolves it from the fake Clients Gate ticker', async () => {
    const est = await estimateFill(
      { clients: clientsWithTicker('2000'), fetchBook: fetchBookFor({}) },
      { symbol: 'GATE_FUTURE_ETH_USDT', side: 'BUY', qty: '0.5' },
    );
    expect(est).toMatchObject({ source: 'reference+spread', confidence: 'low' });
    expect(est!.avgPrice).toBeCloseTo(2000 * 1.001, 6);
  });
});

describe('estimateFill — exhausted chain (source 4)', () => {
  it('no books and no reference price → null', async () => {
    const est = await estimateFill(
      { clients: clientsWithTicker(null), fetchBook: fetchBookFor({}) },
      { symbol: 'GATE_FUTURE_ETH_USDT', side: 'BUY', qty: '0.5' },
    );
    expect(est).toBeNull();
  });

  it('invalid qty → null before any lookup', async () => {
    const est = await estimateFill(
      { clients: noClients, fetchBook: fetchBookFor({ GATE: book() }) },
      { symbol: 'GATE_FUTURE_ETH_USDT', side: 'BUY', qty: '0' },
    );
    expect(est).toBeNull();
  });
});
