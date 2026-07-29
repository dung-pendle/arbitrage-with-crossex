import { describe, expect, it } from 'vitest';
import { isRatioBase } from './ratioBase';

describe('isRatioBase', () => {
  const index = new Set(['ETH', 'BTC', 'SOL', 'ETHBTC', 'SOLBTC', 'WBTC']);

  it('flags ratio bases whose prefix is a listed coin', () => {
    expect(isRatioBase('ETHBTC', index)).toBe(true);
    expect(isRatioBase('SOLBTC', index)).toBe(true);
  });

  it('keeps coins whose prefix is too short (WBTC is wrapped BTC, not a ratio)', () => {
    expect(isRatioBase('WBTC', index)).toBe(false);
  });

  it('keeps BTC and ETH themselves (empty prefix)', () => {
    expect(isRatioBase('BTC', index)).toBe(false);
    expect(isRatioBase('ETH', index)).toBe(false);
  });

  it('keeps ETHBTC when ETH is not in the index', () => {
    expect(isRatioBase('ETHBTC', new Set(['ETHBTC', 'BTC']))).toBe(false);
  });

  it('never treats allowlisted wrapped assets as ratio pairs, even with a listed prefix', () => {
    // 'REN' / 'ST' are listed bases, so without the allowlist RENBTC/STETH would
    // be filtered as ratios and the real wrapped coins would vanish.
    const idx = new Set(['REN', 'RENBTC', 'ST', 'STETH', 'BTC', 'ETH']);
    expect(isRatioBase('RENBTC', idx)).toBe(false);
    expect(isRatioBase('STETH', idx)).toBe(false);
    // A genuine ratio (ETHBTC, prefix ETH listed) is still filtered.
    expect(isRatioBase('ETHBTC', idx)).toBe(true);
  });

  it('matches the wrapped-asset allowlist case-insensitively (cbBTC kept)', () => {
    expect(isRatioBase('cbBTC', new Set(['CB', 'BTC']))).toBe(false);
    expect(isRatioBase('WBETH', new Set(['WB', 'ETH']))).toBe(false);
  });
});
