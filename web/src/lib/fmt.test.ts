import { describe, expect, it } from 'vitest';
import { bps, feePct, fmtPct, fmtUsd, num, parseSymbol, sig, toDate } from './fmt';

// num/sig expectations are copied from tests/unit/format.test.ts in the repo
// root — the web port must behave identically to src/core/numbers.ts.

describe('num (port of core numbers.num)', () => {
  it('formats with fixed decimals and thousands separators', () => {
    expect(num(1234.5, 2)).toBe('1,234.50');
  });
});

describe('sig (port of core numbers.sig)', () => {
  it.each([
    [0, '0'],
    [65432.1, '65432.1'], // toFixed(2) then trailing zeros stripped
    [1234.5678, '1234.57'], // abs >= 1000 -> only 2 dp, so it rounds
    [1.23456789, '1.2346'], // 1 <= abs < 1000 -> 4 dp
    // double nearest to 0.000012345 is just under, so toFixed(8) rounds DOWN
    [0.000012345, '0.00001234'],
  ])('sig(%f) -> %s', (value, expected) => {
    expect(sig(value)).toBe(expected);
  });
});

describe('parseSymbol (port of core numbers.parseSymbol)', () => {
  it('parses EXCHANGE_BUSINESS_BASE_QUOTE', () => {
    expect(parseSymbol('BINANCE_FUTURE_BTC_USDT')).toEqual({
      exchange: 'BINANCE',
      business: 'FUTURE',
      base: 'BTC',
      quote: 'USDT',
      pair: 'BTC_USDT',
    });
  });

  it('joins multi-token bases', () => {
    expect(parseSymbol('GATE_FUTURE_1000_PEPE_USDT')).toMatchObject({
      base: '1000_PEPE',
      pair: '1000_PEPE_USDT',
    });
  });
});

describe('web additions', () => {
  it('fmtUsd renders signed dollars', () => {
    expect(fmtUsd(9387.2, 0)).toBe('$9,387');
    expect(fmtUsd('-1234.5')).toBe('-$1,234.50');
  });

  it('fmtPct treats input as a ratio', () => {
    expect(fmtPct('0.1234')).toBe('12.34%');
  });

  it('bps and feePct render fee fractions', () => {
    expect(bps('0.0002')).toBe('2.0 bps');
    expect(bps(-0.00005)).toBe('-0.5 bps');
    expect(feePct('0.0002')).toBe('0.0200%');
  });

  it('toDate handles seconds AND milliseconds epochs', () => {
    const fromSeconds = toDate(1_735_689_600); // < 1e12 ⇒ seconds
    const fromMillis = toDate(1_735_689_600_000);
    expect(fromSeconds?.getTime()).toBe(1_735_689_600_000);
    expect(fromMillis?.getTime()).toBe(1_735_689_600_000);
    expect(toDate('1735689600')).toEqual(fromSeconds);
    expect(toDate(undefined)).toBeNull();
    expect(toDate('nope')).toBeNull();
  });
});
