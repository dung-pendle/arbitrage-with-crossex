import { describe, expect, it } from 'vitest';
import { makeSharePayload } from '../test/fixtures';
import { shareDaysText, shareTermDays } from './share';

/** THE MIRROR PIN: `termDays` in src/server/position.ts computes the same
 * number for the OG description that this computes for the card and the tweet,
 * and no cross-tree import can enforce it. tests/server/position-page.test.ts
 * asserts this exact table — change one, change both. */
export const TERM_DAY_VECTORS: Array<[cs: number | null, t: number, m: number, days: number]> = [
  // [clock start, snapshot, maturity, expected whole days]
  [1_000_000_000, 1_000_100_000, 1_000_000_000 + 14 * 86_400, 14], // ordinary term
  [null, 1_000_000_000, 1_000_000_000 + 12 * 86_400, 12], // no open time → snapshot stands in
  [1_000_000_000, 1_000_000_000, 1_000_000_000 + 14 * 86_400 - 1, 13], // FLOORS, never rounds up
  [1_000_000_000, 1_000_000_000, 1_000_000_000 + 86_400, 1], // exact one-day boundary
  [1_000_000_000, 1_000_000_000, 1_000_000_000 + 3_600, 1], // sub-day term clamps to 1
  [1_000_000_000, 1_000_000_000, 1_000_000_000, 1], // matured at share time still reads 1
];

describe('shareTermDays', () => {
  it('matches the server-side mirror on every day boundary', () => {
    for (const [cs, t, m, days] of TERM_DAY_VECTORS) {
      expect(shareTermDays({ cs, t, m }), `cs=${cs} t=${t} m=${m}`).toBe(days);
    }
  });

  it('labels the term, singular at one day', () => {
    const p = makeSharePayload();
    expect(shareDaysText(p)).toBe('14-day term');
    expect(shareDaysText(makeSharePayload({ m: p.cs! + 86_400 }))).toBe('1-day term');
  });
});
