import { describe, expect, it } from 'vitest';
import type { PreviewResult } from '../api/types';
import { finalizeActions } from './finalize';

/** finalizeActions only reads p.input / p.qty / p.price — build minimal previews. */
const preview = (input: PreviewResult['input'], qty: string, price?: string): PreviewResult =>
  ({ input, qty, price } as PreviewResult);

describe('finalizeActions', () => {
  it('stamps the resolved qty and strips notional on an open-market leg', () => {
    const [a] = finalizeActions([
      preview({ kind: 'open-market', symbol: 'GATE_FUTURE_ETH_USDT', side: 'BUY', notional: '1000' }, '0.4'),
    ]);
    expect(a).toEqual({ kind: 'open-market', symbol: 'GATE_FUTURE_ETH_USDT', side: 'BUY', qty: '0.4' });
    expect('notional' in a).toBe(false);
  });

  it('stamps the resolved (tick-snapped) price on an open-limit leg', () => {
    const [a] = finalizeActions([
      preview(
        { kind: 'open-limit', symbol: 'HYPERLIQUID_FUTURE_ETH_USDC', side: 'BUY', notional: '1000', price: '2500.123', tif: 'POC' },
        '0.4',
        '2500.1',
      ),
    ]);
    expect(a).toMatchObject({ kind: 'open-limit', qty: '0.4', price: '2500.1', tif: 'POC' });
    expect('notional' in a).toBe(false);
  });

  it('passes a close-position through untouched (server re-derives from the live position)', () => {
    const input = { kind: 'close-position' as const, symbol: 'GATE_FUTURE_ETH_USDT', slippagePct: 0.5, qty: '0.2' };
    const [a] = finalizeActions([preview(input, '0.2')]);
    expect(a).toEqual(input);
  });
});
