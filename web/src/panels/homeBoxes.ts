/** Pure taxonomy for the home view: every position lands in exactly one box.
 *
 * - 'strategy'  — a server StrategyRollup (has Boros legs; 0..n perp legs
 *                 attached). Complete/partial/boros-only render from its hedge.
 * - 'perp-only' — an exposure group (≥2 legs) whose base has NO Boros cohort:
 *                 the delta-neutral pair exists but the rate isn't locked.
 * - 'stray'     — a single unpaired perp leg with no Boros cohort.
 *
 * The leftover set is exactly what returns.ts drops when attaching perps to
 * cohorts (perps whose base has no Boros cohort). With no tracked address the
 * strategy feed is undefined and every exposure group becomes perp-only/stray.
 */
import type {
  ExposureGroup,
  PositionsResponse,
  StrategyReturns,
  StrategyRollup,
} from '../api/types';

export type HomeBox =
  | { kind: 'strategy'; rollup: StrategyRollup }
  | { kind: 'perp-only'; group: ExposureGroup }
  | { kind: 'stray'; group: ExposureGroup };

export function buildBoxes(
  strategy: StrategyReturns | undefined,
  positions: PositionsResponse | undefined,
): HomeBox[] {
  const rollups = strategy?.strategies ?? [];
  const rollupBases = new Set(rollups.map((r) => r.base.toUpperCase()));
  const leftovers = (positions?.exposure ?? []).filter(
    (g) => !rollupBases.has(g.base.toUpperCase()),
  );
  const byGross = (a: ExposureGroup, b: ExposureGroup) => b.grossValue - a.grossValue;
  return [
    // Server order (by notional) is kept for strategy boxes.
    ...rollups.map((rollup) => ({ kind: 'strategy' as const, rollup })),
    ...leftovers.filter((g) => !g.singleLeg).sort(byGross).map((group) => ({
      kind: 'perp-only' as const,
      group,
    })),
    ...leftovers.filter((g) => g.singleLeg).sort(byGross).map((group) => ({
      kind: 'stray' as const,
      group,
    })),
  ];
}
