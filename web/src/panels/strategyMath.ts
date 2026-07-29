/** Display-side strategy arithmetic shared by the home totals strip and
 * StrategyCard — the server never bakes the perp exit parts into any number;
 * each part (exit trading fees / exit slippage) folds in via its own checkbox. */

export const SECONDS_IN_YEAR = 365 * 24 * 3600;

/** The two independent "future perp exit" toggles. */
export interface ExitFlags {
  inclExitFees: boolean;
  inclExitSlippage: boolean;
}

export interface ExitCostApplied {
  /** The exit cost actually folded in (0 when both off / unknown / no perps).
   * Can be NEGATIVE when the assumed exit slippage is favorable. */
  exitUsd: number;
  netUsd: number;
  /** Server APR when untouched; re-annualized (same formula, adjusted
   * numerator) when the exit applies; null when it can't be re-derived. */
  apr: number | null;
  /** Null passes through from expectedPnlToMaturityUsd (unknowable clock). */
  expectedUsd: number | null;
}

/** Fold the checked perp exit parts into the headline numbers. */
export function applyExitCost(opts: {
  flags: ExitFlags;
  /** feesUsd.future.perpExitFeesUsd — null = unknown, never guess. */
  perpExitFeesUsd: number | null;
  /** feesUsd.future.perpExitSlippageUsd — signed; null = unknown. */
  perpExitSlippageUsd: number | null;
  realizedPnlUsd: number;
  realizedApr: number | null;
  expectedPnlToMaturityUsd: number | null;
  capitalUsd: number;
  /** Annualization window (capital-weighted for totals); null = unknown. */
  elapsedSeconds: number | null;
}): ExitCostApplied {
  const feesPart =
    opts.flags.inclExitFees && opts.perpExitFeesUsd !== null && opts.perpExitFeesUsd > 0
      ? opts.perpExitFeesUsd
      : 0;
  // Slippage is signed — a favorable (negative) assumed exit still folds in.
  const slipPart =
    opts.flags.inclExitSlippage && opts.perpExitSlippageUsd !== null
      ? opts.perpExitSlippageUsd
      : 0;
  const exitUsd = feesPart + slipPart;
  const netUsd = opts.realizedPnlUsd - exitUsd;
  let apr = opts.realizedApr;
  if (exitUsd !== 0 && apr !== null && opts.capitalUsd > 0) {
    apr =
      opts.elapsedSeconds !== null && opts.elapsedSeconds > 0
        ? (netUsd / opts.capitalUsd) * (SECONDS_IN_YEAR / opts.elapsedSeconds)
        : null;
  }
  return {
    exitUsd,
    netUsd,
    apr,
    expectedUsd:
      opts.expectedPnlToMaturityUsd === null ? null : opts.expectedPnlToMaturityUsd - exitUsd,
  };
}
