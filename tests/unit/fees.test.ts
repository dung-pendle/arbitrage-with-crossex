import { describe, it, expect } from 'vitest';
import { estimateFees, resolveFeeRates, type VenueFeeRow } from '../../src/core/estimate/fees';

const FEE_ROWS: VenueFeeRow[] = [
  {
    exchangeType: 'BINANCE',
    futureMakerFee: '0.0002',
    futureTakerFee: '0.0005',
    spotMakerFee: '0.001',
    spotTakerFee: '0.001',
    specialFeeList: [{ symbol: 'BINANCE_FUTURE_BTC_USDT', makerFeeRate: '0.0001', takerFeeRate: '0.0002' }],
  },
  { exchangeType: 'KRAKEN', futureMakerFee: '0.0002', futureTakerFee: '0.0005', specialFeeList: [] },
  { exchangeType: 'HYPERLIQUID', futureMakerFee: '0.00015', futureTakerFee: '0.00045', specialFeeList: [] },
];

describe('resolveFeeRates', () => {
  it('special-fee override wins over the venue future rates', () => {
    const r = resolveFeeRates(FEE_ROWS, 'BINANCE_FUTURE_BTC_USDT')!;
    expect(r.takerRate).toBe(0.0002);
    expect(r.makerRate).toBe(0.0001);
    expect(r.specialOverride).toBe(true);
    expect(r.quote).toBe('USDT');
  });

  it('sibling symbol on the same venue is unaffected by the override', () => {
    const r = resolveFeeRates(FEE_ROWS, 'BINANCE_FUTURE_ETH_USDT')!;
    expect(r.takerRate).toBe(0.0005);
    expect(r.makerRate).toBe(0.0002);
    expect(r.specialOverride).toBe(false);
  });

  it('missing venue row returns null (caller shows "unknown")', () => {
    expect(resolveFeeRates(FEE_ROWS, 'DERIBIT_FUTURE_BTC_USDC')).toBeNull();
  });

  it('quote follows the symbol: KRAKEN → USD, HYPERLIQUID → USDC', () => {
    expect(resolveFeeRates(FEE_ROWS, 'KRAKEN_FUTURE_BTC_USD')!.quote).toBe('USD');
    expect(resolveFeeRates(FEE_ROWS, 'HYPERLIQUID_FUTURE_BTC_USDC')!.quote).toBe('USDC');
  });
});

describe('estimateFees', () => {
  const rates = { makerRate: 0.0002, takerRate: 0.0005, specialOverride: false, quote: 'USDT' };

  it('MARKET ⇒ taker only', () => {
    const f = estimateFees(rates, { type: 'MARKET', tif: 'IOC', qty: '1', price: 100 });
    expect(f.est.taker).toBeCloseTo(0.05, 10);
    expect(f.est.maker).toBeUndefined();
  });

  it('LIMIT IOC ⇒ taker only', () => {
    const f = estimateFees(rates, { type: 'LIMIT', tif: 'IOC', qty: '1', price: 100 });
    expect(f.est.taker).toBeCloseTo(0.05, 10);
    expect(f.est.maker).toBeUndefined();
  });

  it('LIMIT POC ⇒ maker only', () => {
    const f = estimateFees(rates, { type: 'LIMIT', tif: 'POC', qty: '1', price: 100 });
    expect(f.est.maker).toBeCloseTo(0.02, 10);
    expect(f.est.taker).toBeUndefined();
  });

  it('LIMIT GTC ⇒ both (a maker/taker range)', () => {
    const f = estimateFees(rates, { type: 'LIMIT', tif: 'GTC', qty: '1', price: 100 });
    expect(f.est.taker).toBeCloseTo(0.05, 10);
    expect(f.est.maker).toBeCloseTo(0.02, 10);
  });

  it('decimal-string qty math stays within tolerance', () => {
    const r = resolveFeeRates(FEE_ROWS, 'BINANCE_FUTURE_BTC_USDT')!;
    const f = estimateFees(r, { type: 'MARKET', tif: 'IOC', qty: '0.007', price: 65000 });
    expect(Math.abs(f.est.taker! - 0.091)).toBeLessThan(1e-9); // 0.007 * 65000 * 0.0002
  });

  it('carries rates/quote/override through to the FeeEstimate', () => {
    const r = resolveFeeRates(FEE_ROWS, 'BINANCE_FUTURE_BTC_USDT')!;
    const f = estimateFees(r, { type: 'MARKET', tif: 'IOC', qty: '1', price: 100 });
    expect(f.makerRate).toBe(0.0001);
    expect(f.takerRate).toBe(0.0002);
    expect(f.specialOverride).toBe(true);
    expect(f.quote).toBe('USDT');
  });
});
