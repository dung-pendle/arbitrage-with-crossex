import { describe, expect, it } from 'vitest';
import type { CrossexPosition } from 'gate-api';
import { computeExposure } from '../../src/core/positions';

/** Minimal position stub — only the fields computeExposure reads. */
function pos(symbol: string, positionQty: string, positionValue: string, positionSide?: string): CrossexPosition {
  return { symbol, positionQty, positionValue, positionSide } as CrossexPosition;
}

describe('computeExposure', () => {
  it('groups a long+short of the same base into one neutral group', () => {
    const groups = computeExposure([
      pos('BINANCE_FUTURE_BTC_USDT', '0.1', '1000'),
      pos('OKX_FUTURE_BTC_USDT', '-0.1', '1000'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].base).toBe('BTC');
    expect(groups[0].neutral).toBe(true);
    expect(groups[0].singleLeg).toBe(false);
    expect(groups[0].netValue).toBe(0);
    expect(groups[0].grossValue).toBe(2000);
  });

  it('groups USDT and USDC quoted legs of one base together (cross-quote pair)', () => {
    // Mirrors a real book: HYPERLIQUID quotes USDC, OKX quotes USDT — one hedge.
    const groups = computeExposure([
      pos('HYPERLIQUID_FUTURE_BTC_USDC', '-0.152', '9389.50', 'SHORT'),
      pos('OKX_FUTURE_BTC_USDT', '0.152', '9387.50', 'LONG'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].base).toBe('BTC');
    expect(groups[0].neutral).toBe(true);
    expect(groups[0].legs.map((l) => l.quote).sort()).toEqual(['USDC', 'USDT']);
  });

  it('2% band edges: 1% is neutral, 2.05% is not, exactly 2% is not (strict <)', () => {
    const at = (long: number, short: number) =>
      computeExposure([
        pos('GATE_FUTURE_ETH_USDT', '1', String(long)),
        pos('BYBIT_FUTURE_ETH_USDT', '-1', String(short)),
      ])[0];
    expect(at(1010, 990).neutral).toBe(true); // |20|/2000 = 1%
    expect(at(1020.5, 979.5).neutral).toBe(false); // 2.05%
    expect(at(1020, 980).neutral).toBe(false); // exactly 2% — strict <
  });

  it('flags a lone leg as singleLeg (and not neutral)', () => {
    const groups = computeExposure([pos('GATE_FUTURE_SOL_USDT', '5', '700')]);
    expect(groups[0].singleLeg).toBe(true);
    expect(groups[0].neutral).toBe(false);
  });

  it('nets a 3-leg group (two longs vs one short) correctly', () => {
    const [g] = computeExposure([
      pos('GATE_FUTURE_ETH_USDT', '1', '600'),
      pos('BINANCE_FUTURE_ETH_USDT', '1', '400'),
      pos('BYBIT_FUTURE_ETH_USDT', '-2', '1000'),
    ]);
    expect(g.longValue).toBe(1000);
    expect(g.shortValue).toBe(1000);
    expect(g.neutral).toBe(true);
    expect(g.legs).toHaveLength(3);
  });

  it('infers direction from qty sign when positionSide is absent, and skips zero-qty rows', () => {
    const groups = computeExposure([
      pos('GATE_FUTURE_XRP_USDT', '-100', '250'),
      pos('BYBIT_FUTURE_XRP_USDT', '0', '0'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].legs).toHaveLength(1);
    expect(groups[0].legs[0].side).toBe('SHORT');
  });

  it('falls back to qty×mark when positionValue is missing, so a hedged pair is not mis-flagged', () => {
    const long = { symbol: 'GATE_FUTURE_ETH_USDT', positionQty: '1', positionValue: '0', markPrice: '1700', positionSide: 'LONG' } as CrossexPosition;
    const short = pos('BYBIT_FUTURE_ETH_USDT', '-1', '1700', 'SHORT');
    const [g] = computeExposure([long, short]);
    expect(g.longValue).toBeCloseTo(1700, 6); // derived from qty×mark, not 0
    expect(g.singleLeg).toBe(false); // NOT mis-reported as single-legged
    expect(g.neutral).toBe(true);
  });

  it('single-leg is decided by leg presence per side, not by value being 0', () => {
    const long = { symbol: 'GATE_FUTURE_SOL_USDT', positionQty: '5', positionValue: '0', markPrice: '0', entryPrice: '140', positionSide: 'LONG' } as CrossexPosition;
    const [g] = computeExposure([long]);
    expect(g.singleLeg).toBe(true);
  });

  it('keeps multi-token bases distinct from their plain sibling', () => {
    const groups = computeExposure([
      pos('GATE_FUTURE_1000_PEPE_USDT', '10', '100'),
      pos('BYBIT_FUTURE_PEPE_USDT', '-10', '100'),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.base).sort()).toEqual(['1000_PEPE', 'PEPE']);
  });

  it('sorts groups by gross value descending', () => {
    const groups = computeExposure([
      pos('GATE_FUTURE_SOL_USDT', '1', '100'),
      pos('GATE_FUTURE_BTC_USDT', '1', '5000'),
      pos('OKX_FUTURE_BTC_USDT', '-1', '5000'),
    ]);
    expect(groups.map((g) => g.base)).toEqual(['BTC', 'SOL']);
  });
});
