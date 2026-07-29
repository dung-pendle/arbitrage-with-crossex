import { describe, it, expect } from 'vitest';
import { walkBook } from '../../src/core/estimate/fill';

// walkBook is direction-agnostic: callers pass asks (asc) for BUY, bids (desc) for SELL.
const ASKS: Array<[number, number]> = [
  [100, 1],
  [101, 2],
];

describe('walkBook', () => {
  it('exact-depth boundary consumes the whole book', () => {
    const r = walkBook(ASKS, 3)!;
    expect(r).not.toBeNull();
    expect(Math.abs(r.avgPrice - 100.6667)).toBeLessThan(1e-4); // (100*1 + 101*2) / 3
    expect(r.worstPrice).toBe(101);
    expect(r.filledQty).toBe(3);
    expect(r.exhausted).toBe(false);
  });

  it('partial second level', () => {
    const r = walkBook(ASKS, 1.5)!;
    expect(Math.abs(r.avgPrice - 100.3333)).toBeLessThan(1e-4); // (100*1 + 101*0.5) / 1.5
    expect(r.worstPrice).toBe(101);
    expect(r.filledQty).toBe(1.5);
    expect(r.exhausted).toBe(false);
  });

  it('exhausted book extrapolates the remainder at the last level', () => {
    const r = walkBook(ASKS, 5)!;
    expect(r.filledQty).toBe(3);
    expect(r.exhausted).toBe(true);
    // (100*1 + 101*2 + 101*2 extrapolated) / 5
    expect(r.avgPrice).toBeCloseTo(100.8, 10);
    expect(r.worstPrice).toBe(101);
  });

  it('empty book returns null', () => {
    expect(walkBook([], 1)).toBeNull();
  });

  it('qty <= 0 returns null', () => {
    expect(walkBook(ASKS, 0)).toBeNull();
    expect(walkBook(ASKS, -1)).toBeNull();
    expect(walkBook(ASKS, NaN)).toBeNull();
  });

  it('single level fills flat', () => {
    const r = walkBook([[50, 10]], 4)!;
    expect(r.avgPrice).toBe(50);
    expect(r.worstPrice).toBe(50);
    expect(r.filledQty).toBe(4);
    expect(r.exhausted).toBe(false);
  });

  it('SELL semantics: walking bids (desc) yields decreasing worst price', () => {
    const bids: Array<[number, number]> = [
      [99, 1],
      [98, 2],
    ];
    const r = walkBook(bids, 2)!;
    expect(r.avgPrice).toBeCloseTo(98.5, 10); // (99*1 + 98*1) / 2
    expect(r.worstPrice).toBe(98);
    expect(r.exhausted).toBe(false);
  });

  it('skips invalid levels rather than failing the walk', () => {
    const r = walkBook(
      [
        [0, 5],
        [100, 1],
        [101, -2],
        [102, 2],
      ],
      2,
    )!;
    expect(r.avgPrice).toBeCloseTo(101, 10); // (100*1 + 102*1) / 2
    expect(r.worstPrice).toBe(102);
  });
});
