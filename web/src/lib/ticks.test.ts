import { describe, expect, it } from 'vitest';
import { decimalsOf, formatLimitPrice, formatRestPrice } from './ticks';

// These helpers are a port of src/core/numbers.ts, and the port had drifted: the
// sci-notation branch was missing here, so a CrossEx tick like "1e-4" counted 0
// decimals and toFixed(0) rewrote the user's typed limit price as an integer.
// The value still parsed as positive, so the ticket stayed armed and the server
// faithfully re-snapped the already-wrong price — no warning anywhere.
describe('decimalsOf', () => {
  it.each([
    ['0.001', 3],
    ['0.0001', 4],
    ['1', 0],
    ['10', 0],
    ['0.10', 1],
  ])('counts %s as %i decimals', (step, want) => {
    expect(decimalsOf(step)).toBe(want);
  });

  it.each([
    ['1e-5', 5],
    ['1e-4', 4],
    ['1E-3', 3],
    ['2.5e-4', 5],
    ['1e-2', 2],
    ['1e2', 0],
  ])('reads sci-notation %s as %i decimals', (step, want) => {
    expect(decimalsOf(step)).toBe(want);
  });
});

describe('formatLimitPrice', () => {
  it('does not collapse a sci-notation tick to an integer', () => {
    // Mirrors tests/unit/format.test.ts so the web port and core cannot drift apart.
    expect(formatLimitPrice(0.00234, 'GATE_FUTURE_X_USDT', '1e-5')).toBe('0.00234');
  });

  it.each([
    [1.2345, '1e-4', '1.2345'],
    [65432.123, '1e-2', '65432.12'],
    [2.5, '1e-3', '2.5'],
    [0.35, '1e-4', '0.35'],
  ])('snaps %f on tick %s to %s', (price, tick, want) => {
    expect(formatLimitPrice(price, 'GATE_FUTURE_X_USDT', tick)).toBe(want);
  });

  it('still snaps plain decimal ticks', () => {
    expect(formatLimitPrice(1.23456, 'GATE_FUTURE_X_USDT', '0.001')).toBe('1.235');
  });

  it('keeps the Hyperliquid 5-significant-figure cap', () => {
    // NEAREST-mode rounding — still correct for non-resting uses, but note this
    // is exactly the round-up that crosses a resting BUY onto the ask; RESTING
    // (post-only) callers must use formatRestPrice instead (tested below).
    expect(formatLimitPrice(61717.6, 'HYPERLIQUID_FUTURE_BTC_USDT', '0.1')).toBe('61718');
  });
});

// Mirrors tests/unit/format.test.ts (formatRestPrice) so the web port and core
// cannot drift apart — SingleTicket's limits always rest post-only (tif POC),
// and a client-side NEAREST snap produces a valid tick multiple the server's
// own formatRestPrice can no longer fix (its snap is a no-op on it).
describe('formatRestPrice', () => {
  it('rounds AWAY from crossing so a post-only snap cannot become a taker reject', () => {
    // Tick 0.05: a BUY must stay at/below what it asked for, a SELL at/above.
    expect(formatRestPrice(2.01, 'BUY', 'GATE_FUTURE_X_USDT', '0.05')).toBe('2');
    expect(formatRestPrice(1.99, 'SELL', 'GATE_FUTURE_X_USDT', '0.05')).toBe('2');
  });

  it('does not snap a Hyperliquid BUY up onto the ask', () => {
    // The reported case: HL BTC bid 61717 / ask 61718, tick 0.1. The web ticket
    // used formatLimitPrice on blur, whose NEAREST 5-sig-fig cap turned a
    // 61717.6 resting BUY into 61718 — exactly the ask — so the venue
    // insta-rejected the POC order, and no "price adjusted" warning fired
    // because the server saw price === input.price.
    expect(formatLimitPrice(61717.6, 'HYPERLIQUID_FUTURE_BTC_USDC', '0.1')).toBe('61718');
    expect(formatRestPrice(61717.6, 'BUY', 'HYPERLIQUID_FUTURE_BTC_USDC', '0.1')).toBe('61717');
    // Mirror side: a resting SELL must never be dragged down onto the bid.
    expect(formatRestPrice(61717.4, 'SELL', 'HYPERLIQUID_FUTURE_BTC_USDC', '0.1')).toBe('61718');
  });

  it('never moves the price in the crossing direction, on either side', () => {
    for (const px of [2.4321, 0.00234, 65432.123, 61717.6]) {
      for (const sym of ['GATE_FUTURE_X_USDT', 'HYPERLIQUID_FUTURE_X_USDC']) {
        expect(Number(formatRestPrice(px, 'BUY', sym, '0.001'))).toBeLessThanOrEqual(px);
        expect(Number(formatRestPrice(px, 'SELL', sym, '0.001'))).toBeGreaterThanOrEqual(px);
      }
    }
  });

  it('handles sci-notation ticks (decimalsOf already parses them)', () => {
    // CrossEx rule feeds really do return ticks like "1e-4"/"1e-5".
    expect(formatRestPrice(0.00234, 'BUY', 'GATE_FUTURE_X_USDT', '1e-5')).toBe('0.00234');
    expect(formatRestPrice(0.23457, 'BUY', 'GATE_FUTURE_X_USDT', '1e-4')).toBe('0.2345');
    expect(formatRestPrice(0.23451, 'SELL', 'GATE_FUTURE_X_USDT', '1e-4')).toBe('0.2346');
  });
});
