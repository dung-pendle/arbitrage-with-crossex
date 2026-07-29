/** Net-exposure/neutrality view over CrossEx positions (the arb "neutral ✓" signal). */
import type { CrossexPosition } from 'gate-api';
import { parseSymbol } from './numbers';
import { direction } from './orders';

export interface ExposureLeg {
  symbol: string;
  exchange: string;
  quote: string;
  side: 'LONG' | 'SHORT';
  qty: number;
  value: number; // absolute notional (position_value)
}

export interface ExposureGroup {
  base: string;
  legs: ExposureLeg[];
  longValue: number;
  shortValue: number;
  netValue: number; // long - short
  grossValue: number; // long + short
  /** |net|/gross < 2% — the arb pair is effectively delta-neutral. */
  neutral: boolean;
  /** Only one direction present — an unhedged leg. */
  singleLeg: boolean;
}

/**
 * Group positions BY BASE COIN (not BASE_QUOTE): a BINANCE BTC_USDT long hedged by a
 * HYPERLIQUID BTC_USDC short is one delta-neutral group even though the quotes differ —
 * position values are all ≈USD, so cross-quote summation is fine at the 2% band.
 */
export function computeExposure(positions: CrossexPosition[]): ExposureGroup[] {
  const groups = new Map<string, ExposureGroup>();
  const legCount = new Map<string, { long: number; short: number }>();
  for (const p of positions) {
    const { exchange, base, quote } = parseSymbol(p.symbol ?? '');
    const qty = Number(p.positionQty ?? 0);
    if (qty === 0) continue;
    // Prefer positionValue; fall back to qty×mark (or ×entry) when it's missing/0 so a
    // real leg doesn't count as $0 and make a hedged pair look single-legged.
    let value = Math.abs(Number(p.positionValue ?? 0));
    if (!(value > 0)) {
      const ref = Number(p.markPrice ?? 0) || Number(p.entryPrice ?? 0);
      if (ref > 0) value = Math.abs(qty) * ref;
    }
    const side = direction(p.positionSide, qty);
    const g = groups.get(base) ?? {
      base,
      legs: [],
      longValue: 0,
      shortValue: 0,
      netValue: 0,
      grossValue: 0,
      neutral: false,
      singleLeg: false,
    };
    g.legs.push({ symbol: p.symbol ?? '', exchange, quote, side, qty: Math.abs(qty), value });
    if (side === 'LONG') g.longValue += value;
    else g.shortValue += value;
    groups.set(base, g);
    const lc = legCount.get(base) ?? { long: 0, short: 0 };
    if (side === 'LONG') lc.long += 1;
    else lc.short += 1;
    legCount.set(base, lc);
  }
  for (const g of groups.values()) {
    g.netValue = g.longValue - g.shortValue;
    g.grossValue = g.longValue + g.shortValue;
    g.neutral = g.grossValue > 0 && Math.abs(g.netValue) / g.grossValue < 0.02;
    // Single-legged = legs on exactly one side (by count, not by value being 0).
    const lc = legCount.get(g.base)!;
    g.singleLeg = (lc.long === 0) !== (lc.short === 0);
  }
  return [...groups.values()].sort((a, b) => b.grossValue - a.grossValue);
}
