/** Display-side strategy arithmetic shared by the home totals strip and
 * StrategyCard — the server never bakes the perp exit parts into any number
 * (each part folds in via its own toggle), and it always bakes the perp ENTRY
 * parts in, which the "rolled over" toggle backs out again. */

export const SECONDS_IN_YEAR = 365 * 24 * 3600;

/** The per-position cost assumptions. Entry and exit are INDEPENDENT: the
 * server seeds the exit slippage estimate from the observed entry gap
 * (`returns.ts`: "exit crossing assumed symmetric to entry"), but omitting a
 * rolled-in position's entry cost must not zero the cost of crossing back out. */
export interface CostFlags {
  inclExitFees: boolean;
  inclExitSlippage: boolean;
  /** False = this strategy is NOT charged the perp entry fees + entry slippage.
   * Gate reports a position's fee CUMULATIVELY and its entryPrice from the
   * original open, so for a perp rolled into a new maturity both predate the
   * strategy — charging them here bills it for a previous life's spending. */
  inclEntryCost: boolean;
}

export interface CostsApplied {
  /** The exit cost actually folded in (0 when both off / unknown / no perps).
   * Can be NEGATIVE when the assumed exit slippage is favorable. */
  exitUsd: number;
  /** The entry cost handed BACK (0 while included). Signed — a favorable
   * (negative) entry slippage hands back negatively. */
  entryAddBackUsd: number;
  /** Current PnL under the ENTRY assumption only. The exit parts are future
   * costs — money not yet spent — so they never move the "now" line, only the
   * by-maturity target. */
  currentNetUsd: number;
  /** currentNetUsd less the assumed exit cost — the basis the realized APR is
   * re-annualized from. */
  netUsd: number;
  /** Server APR when untouched; re-annualized (same formula, adjusted
   * numerator) when either adjustment applies; null when it can't be re-derived. */
  apr: number | null;
  /** Null passes through from expectedPnlToMaturityUsd (unknowable clock). */
  expectedUsd: number | null;
}

/** Fold the chosen cost assumptions into the headline numbers. */
export function applyCostFlags(opts: {
  flags: CostFlags;
  /** feesUsd.future.perpExitFeesUsd — null = unknown, never guess. */
  perpExitFeesUsd: number | null;
  /** feesUsd.future.perpExitSlippageUsd — signed; null = unknown. */
  perpExitSlippageUsd: number | null;
  /** feesUsd.paid.perpTradingUsd — Gate's cumulative position fee. */
  perpEntryFeesUsd: number;
  /** feesUsd.paid.perpEntrySlippageUsd — signed; null = unknown. */
  perpEntrySlippageUsd: number | null;
  realizedPnlUsd: number;
  realizedApr: number | null;
  expectedPnlToMaturityUsd: number | null;
  capitalUsd: number;
  /** Annualization window (capital-weighted for totals); null = unknown. */
  elapsedSeconds: number | null;
}): CostsApplied {
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
  // Both parts are ALREADY subtracted server-side — inside realizedPnlUsd (via
  // each leg's net) and inside expectedPnlToMaturityUsd (via paid.totalUsd) —
  // so omitting means adding them back. Unknown slippage counts as 0, exactly
  // as the server counts it when summing.
  const entryAddBackUsd = opts.flags.inclEntryCost
    ? 0
    : opts.perpEntryFeesUsd + (opts.perpEntrySlippageUsd ?? 0);
  const currentNetUsd = opts.realizedPnlUsd + entryAddBackUsd;
  const netUsd = currentNetUsd - exitUsd;
  let apr = opts.realizedApr;
  if ((exitUsd !== 0 || entryAddBackUsd !== 0) && apr !== null && opts.capitalUsd > 0) {
    apr =
      opts.elapsedSeconds !== null && opts.elapsedSeconds > 0
        ? (netUsd / opts.capitalUsd) * (SECONDS_IN_YEAR / opts.elapsedSeconds)
        : null;
  }
  return {
    exitUsd,
    entryAddBackUsd,
    currentNetUsd,
    netUsd,
    apr,
    expectedUsd:
      opts.expectedPnlToMaturityUsd === null
        ? null
        : opts.expectedPnlToMaturityUsd + entryAddBackUsd - exitUsd,
  };
}
