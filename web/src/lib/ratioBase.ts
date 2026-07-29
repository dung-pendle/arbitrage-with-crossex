/**
 * CrossEx also lists RATIO perps whose BASE is itself a coin pair, e.g.
 * GATE_FUTURE_ETHBTC_USDT (ETH priced in BTC). The coin pickers should list
 * single coins only, but the symbol feed carries no "ratio" flag, so we detect
 * them heuristically:
 *
 *   a base is a ratio pair when it ends with 'BTC' or 'ETH' (the only
 *   denominators CrossEx uses for ratio listings) AND the remaining prefix is
 *   itself a known base (length >= 2 and present in `allBases`).
 *
 * Worked examples (with 'ETH' listed in `allBases`):
 *   - 'ETHBTC' → prefix 'ETH' is a listed base → ratio (filtered)
 *   - 'WBTC'   → prefix 'W' too short          → kept (wrapped BTC, not a ratio)
 *   - 'BTC'    → empty prefix                  → kept
 *   - 'FOOBTC' with no 'FOO' base listed       → kept (can't be a ratio of an
 *     unlisted coin; better to over-show than hide a real market)
 *
 * Caveat — the heuristic is only as good as `allBases`. It must be the WIDEST
 * base universe available, NOT the current search result set: a substring search
 * for "ETHBTC" does NOT also return plain "ETH" (its symbols don't contain the
 * substring "ETHBTC"), so a result-set-only index would omit the prefix and fail
 * to filter. Because the index is result-set-derived today, detection is
 * inherently unstable.
 *
 * That same instability could HIDE a real coin whose ticker legitimately ends in
 * a denominator (renBTC's prefix 'REN' being a listed base would flag RENBTC as
 * a ratio). Such wrapped/derivative assets are allowlisted below and never
 * treated as ratio pairs, regardless of `allBases`.
 *
 * Only the coin LIST/search is filtered with this — pasting a full ratio
 * symbol into the single ticket still selects it, on purpose.
 */
const RATIO_DENOMINATORS = ['BTC', 'ETH'] as const;

/** Real wrapped/derivative coins whose ticker ends in a ratio denominator —
 * never ratio listings, so they must survive the heuristic (case-insensitive). */
const WRAPPED_EXCEPTIONS = new Set(['WBTC', 'RENBTC', 'TBTC', 'CBBTC', 'WBETH', 'WSTETH', 'STETH', 'RETH']);

export function isRatioBase(base: string, allBases: Set<string>): boolean {
  if (WRAPPED_EXCEPTIONS.has(base.toUpperCase())) return false;
  for (const denom of RATIO_DENOMINATORS) {
    if (!base.endsWith(denom)) continue;
    const prefix = base.slice(0, base.length - denom.length);
    if (prefix.length >= 2 && allBases.has(prefix)) return true;
  }
  return false;
}
