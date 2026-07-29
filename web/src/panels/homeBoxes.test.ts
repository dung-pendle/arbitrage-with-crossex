/** buildBoxes taxonomy: every position lands in exactly one box, rollup bases
 * consume their exposure groups, leftovers split perp-only vs stray. */
import { describe, expect, it } from 'vitest';
import type { PositionsResponse } from '../api/types';
import {
  makeCrossexPosition,
  makeExposureGroup,
  makeStrategyReturns,
  makeStrategyRollup,
} from '../test/fixtures';
import { buildBoxes } from './homeBoxes';

const positions = (over: Partial<PositionsResponse> = {}): PositionsResponse => ({
  positions: [],
  exposure: [],
  ...over,
});

describe('buildBoxes', () => {
  it('no address (strategy undefined): every exposure group becomes perp-only or stray', () => {
    const boxes = buildBoxes(undefined, positions({
      exposure: [
        makeExposureGroup({ base: 'ETH' }),
        makeExposureGroup({ base: 'SOL', singleLeg: true, legs: [makeExposureGroup().legs[0]] }),
      ],
    }));
    expect(boxes.map((b) => b.kind)).toEqual(['perp-only', 'stray']);
  });

  it('a rollup base consumes its exposure group (no duplicate perp-only box)', () => {
    const boxes = buildBoxes(
      makeStrategyReturns({ strategies: [makeStrategyRollup({ base: 'ETH' })] }),
      positions({ exposure: [makeExposureGroup({ base: 'ETH' }), makeExposureGroup({ base: 'HYPE' })] }),
    );
    expect(boxes.map((b) => b.kind)).toEqual(['strategy', 'perp-only']);
    expect(boxes[1].kind === 'perp-only' && boxes[1].group.base).toBe('HYPE');
  });

  it('matches rollup bases case-insensitively', () => {
    const boxes = buildBoxes(
      makeStrategyReturns({ strategies: [makeStrategyRollup({ base: 'eth' })] }),
      positions({ exposure: [makeExposureGroup({ base: 'ETH' })] }),
    );
    expect(boxes.map((b) => b.kind)).toEqual(['strategy']);
  });

  it('multi-maturity: two rollups of one base both render; the group is consumed once', () => {
    const boxes = buildBoxes(
      makeStrategyReturns({
        strategies: [
          makeStrategyRollup({ base: 'ETH' }),
          makeStrategyRollup({ base: 'ETH', maturity: 1_760_000_000 }),
        ],
      }),
      positions({ exposure: [makeExposureGroup({ base: 'ETH' })] }),
    );
    expect(boxes.map((b) => b.kind)).toEqual(['strategy', 'strategy']);
  });

  it('boros-only rollup (no exposure group at all) still gets a strategy box', () => {
    const boxes = buildBoxes(
      makeStrategyReturns({ strategies: [makeStrategyRollup({ base: 'BTC', hedge: 'unhedged' })] }),
      positions(),
    );
    expect(boxes.map((b) => b.kind)).toEqual(['strategy']);
  });

  it('orders: strategy boxes first (server order), then perp-only by gross, strays last', () => {
    const boxes = buildBoxes(
      makeStrategyReturns({ strategies: [makeStrategyRollup({ base: 'HYPE' })] }),
      positions({
        exposure: [
          makeExposureGroup({ base: 'SOL', singleLeg: true, grossValue: 9000 }),
          makeExposureGroup({ base: 'ETH', grossValue: 1500 }),
          makeExposureGroup({ base: 'BTC', grossValue: 8000 }),
        ],
      }),
    );
    expect(
      boxes.map((b) => (b.kind === 'strategy' ? `s:${b.rollup.base}` : `${b.kind}:${b.group.base}`)),
    ).toEqual(['s:HYPE', 'perp-only:BTC', 'perp-only:ETH', 'stray:SOL']);
  });

  it('empty inputs produce no boxes', () => {
    expect(buildBoxes(undefined, undefined)).toEqual([]);
    expect(buildBoxes(makeStrategyReturns({ strategies: [] }), positions())).toEqual([]);
  });

  it('INVARIANT: every position appears in exactly one box', () => {
    // Positions: HYPE pair (in the rollup), ETH pair (perp-only), SOL stray.
    const pos = positions({
      positions: [
        makeCrossexPosition({ symbol: 'BYBIT_FUTURE_HYPE_USDT' }),
        makeCrossexPosition({ symbol: 'HYPERLIQUID_FUTURE_HYPE_USDC' }),
        makeCrossexPosition({ symbol: 'GATE_FUTURE_ETH_USDT' }),
        makeCrossexPosition({ symbol: 'HYPERLIQUID_FUTURE_ETH_USDC' }),
        makeCrossexPosition({ symbol: 'BINANCE_FUTURE_SOL_USDT' }),
      ],
      exposure: [
        makeExposureGroup({
          base: 'HYPE',
          legs: [
            { symbol: 'BYBIT_FUTURE_HYPE_USDT', exchange: 'BYBIT', quote: 'USDT', side: 'LONG', qty: 1, value: 100 },
            { symbol: 'HYPERLIQUID_FUTURE_HYPE_USDC', exchange: 'HYPERLIQUID', quote: 'USDC', side: 'SHORT', qty: 1, value: 100 },
          ],
        }),
        makeExposureGroup({ base: 'ETH' }),
        makeExposureGroup({
          base: 'SOL',
          singleLeg: true,
          legs: [{ symbol: 'BINANCE_FUTURE_SOL_USDT', exchange: 'BINANCE', quote: 'USDT', side: 'LONG', qty: 1, value: 50 }],
        }),
      ],
    });
    const strategy = makeStrategyReturns({ strategies: [makeStrategyRollup({ base: 'HYPE' })] });
    const boxes = buildBoxes(strategy, pos);

    // Each position's base is claimed by exactly one box: a strategy box (by
    // rollup base) or the leftover group carrying its symbol.
    for (const p of pos.positions) {
      const base = p.symbol.split('_')[2];
      const claims = boxes.filter((b) =>
        b.kind === 'strategy'
          ? b.rollup.base.toUpperCase() === base
          : b.group.legs.some((l) => l.symbol === p.symbol),
      );
      expect(claims, `position ${p.symbol} must be claimed exactly once`).toHaveLength(1);
    }
  });
});
