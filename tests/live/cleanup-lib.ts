/**
 * Cleanup primitives shared by the live suite's backstop (afterAll / signal
 * handlers) and the standalone `yarn live:cleanup` script. Direct SDK only —
 * cleanup must work even when the in-process app is gone.
 */
import type { CrossexPosition, Symbol as RuleSymbol } from 'gate-api';
import type { Clients } from '../../src/core/clients';
import { describeError } from '../../src/core/errors';
import { roundToStep } from '../../src/core/numbers';
import { CrossexOrderRequest } from 'gate-api';
import { marketableClosePrice, type Side } from '../../src/core/orders';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Escalating protection bands for the forced closes (percent). */
const CLOSE_ESCALATION_PCT = [1, 2, 4];

export async function positionOn(clients: Clients, symbol: string): Promise<CrossexPosition | undefined> {
  const { body } = await clients.crossEx.listCrossexPositions({ symbol });
  return (body ?? []).find((p) => Number(p.positionQty ?? 0) !== 0);
}

/** Cancel every open order on `symbols` whose client text starts with `tag`.
 * The tag prefix IS the attribution — foreign orders are never touched. */
export async function cancelByTag(
  clients: Clients,
  symbols: string[],
  tag: string,
  onStep?: (msg: string) => void,
): Promise<string[]> {
  const canceled: string[] = [];
  for (const symbol of symbols) {
    const { body: open } = await clients.crossEx.listCrossexOpenOrders({ symbol });
    for (const order of (open ?? []).filter((o) => String(o.text ?? '').startsWith(tag))) {
      const id = String(order.orderId);
      try {
        await clients.crossEx.cancelCrossexOrder(id);
        canceled.push(id);
        onStep?.(`canceled tagged order ${id} on ${symbol} (text=${order.text})`);
      } catch (err) {
        onStep?.(`cancel ${id} on ${symbol} failed: ${describeError(err)}`);
      }
    }
  }
  return canceled;
}

/**
 * Force-close whatever position exists on each symbol with reduce-only IOC
 * marketable limits, escalating slippage 1% → 2% → 4% and re-checking the live
 * position between attempts. Reduce-only means it can only ever SHRINK exposure.
 */
export async function closeTestPositions(
  clients: Clients,
  symbols: string[],
  onStep?: (msg: string) => void,
): Promise<void> {
  if (symbols.length === 0) return;
  const { body: ruleList } = await clients.crossEx.listCrossexRuleSymbols({ symbols: symbols.join(',') });
  const rules = new Map<string, RuleSymbol>((ruleList ?? []).map((r) => [r.symbol, r]));

  for (const slippagePct of CLOSE_ESCALATION_PCT) {
    let anyOpen = false;
    for (const symbol of symbols) {
      const pos = await positionOn(clients, symbol);
      if (!pos) continue;
      anyOpen = true;
      const rule = rules.get(symbol);
      if (!rule) {
        onStep?.(`no rule for ${symbol} — cannot auto-close, close manually`);
        continue;
      }
      const qtyN = Number(pos.positionQty);
      const side: Side = qtyN > 0 ? 'SELL' : 'BUY';
      const qty = roundToStep(Math.abs(qtyN), rule.lotSize, 'down');
      const mark = Number(pos.markPrice) || Number(pos.entryPrice);
      if (!(mark > 0) || Number(qty) <= 0) {
        onStep?.(`cannot price close on ${symbol} (mark=${pos.markPrice}, qty=${qty}) — close manually`);
        continue;
      }
      const price = marketableClosePrice(mark, side, slippagePct, symbol, rule.tickSize);
      try {
        const req = new CrossexOrderRequest();
        req.symbol = symbol;
        req.side = side === 'BUY' ? CrossexOrderRequest.Side.BUY : CrossexOrderRequest.Side.SELL;
        req.type = CrossexOrderRequest.Type.LIMIT;
        req.timeInForce = CrossexOrderRequest.TimeInForce.IOC;
        req.qty = qty;
        req.price = price;
        req.reduceOnly = CrossexOrderRequest.ReduceOnly.True;
        req.text = `ltcl_${Date.now().toString(36)}`;
        const created = await clients.crossEx.createCrossexOrder({ crossexOrderRequest: req });
        onStep?.(`close attempt @${slippagePct}% on ${symbol}: ${side} ${qty} @ ${price} → order ${created.body.orderId}`);
      } catch (err) {
        onStep?.(`close attempt @${slippagePct}% on ${symbol} failed: ${describeError(err)}`);
      }
    }
    if (!anyOpen) return;
    await sleep(1500); // let fills settle before re-checking / escalating
  }
}

/** True only when every symbol has NO position and NO open order left. */
export async function verifyFlat(clients: Clients, symbols: string[]): Promise<boolean> {
  for (const symbol of symbols) {
    if (await positionOn(clients, symbol)) return false;
    const { body: open } = await clients.crossEx.listCrossexOpenOrders({ symbol });
    if ((open ?? []).length > 0) return false;
  }
  return true;
}
