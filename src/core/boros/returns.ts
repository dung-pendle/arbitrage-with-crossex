/**
 * 4-leg strategy returns: join Boros funding-rate legs (by entered EVM address)
 * with the Gate CrossEx perp legs (connected account) and compute realized +
 * locked returns, net of all fees.
 *
 * The strategy (per boros-knowledge-base "fixed-return funding-rate arbitrage"):
 *   L1 perp SHORT on venue A  → receives A floating funding
 *   L2 perp LONG  on venue B  → pays     B floating funding   (delta-neutral)
 *   L3 Boros SHORT FR on A    → receives fixed rate_A, pays A floating
 *   L4 Boros LONG  FR on B    → pays     fixed rate_B, receives B floating
 * Floating cancels per venue → locked (rate_A − rate_B) APR on notional.
 *
 * Money conventions: every *Usd number is USD, positive = gain to the owner.
 * APRs are per-year decimal fractions. We SUM each leg's actual signed cash
 * flows (never "net out" the floating cancellation) so the totals reflect the
 * true near-cancellation plus any residual basis.
 *
 * Perp leg net = funding − trading fees (price MtM is EXCLUDED: on the
 * delta-neutral pair the two uPnLs cancel to entry-gap noise, which the
 * strategy already accounts as entry slippage — subtracted once at pair level
 * inside realizedPnlUsd). Funding is measured FROM THE STRATEGY CLOCK START:
 * when a perp position predates the clock (a pre-existing arb later locked on
 * Boros), the CrossEx account-book funding ledger re-bases it; Gate's
 * position-lifetime cumulative counter is only used when it equals the
 * since-start value (position opened at/after the clock) or as a warned
 * fallback when the ledger can't cover the window.
 */
import { resolveFeeRates, type VenueFeeRow } from '../estimate/fees';
import { parseSymbol } from '../numbers';
import {
  BOROS_TOKEN_SYMBOLS,
  norm18,
  type BorosCollateralZone,
  type BorosMarket,
  type BorosMarketPosition,
  type BorosTxn,
} from './client';

export const SECONDS_IN_YEAR = 365 * 24 * 3600;

/** Structural subset of gate-api's CrossexPosition (all fields optional there). */
export interface PerpPositionLike {
  symbol?: string;
  positionId?: string;
  positionSide?: string;
  positionQty?: string;
  positionValue?: string;
  entryPrice?: string;
  leverage?: string;
  upnl?: string;
  fundingFee?: string;
  fee?: string;
  initialMargin?: string;
  createTime?: string;
}

/** One FUNDING_FEE settlement from the CrossEx account book, attributed to a
 * position (businessId = `{positionId}_{fundingTs}`). USD ≈ coin (USDT/USDC). */
export interface PerpFundingEntry {
  positionId: string;
  /** Unix seconds of the ledger row. */
  timeSec: number;
  /** Signed funding amount (positive = received). */
  changeUsd: number;
}

/** Per-position funding ledger + the earliest instant it covers. */
export interface PerpFundingLedger {
  byPosition: Map<string, PerpFundingEntry[]>;
  /** Unix seconds — rows older than this were not fetched; a clock start
   * before it means the ledger cannot re-base that strategy's funding. */
  coversFromSec: number;
}

/** One finished two-leg deal from the local engine journal, shaped by the
 * route. Both fills of one deal are contemporaneous by construction (the
 * engine hedges within seconds), so each deal's fill gap is pure crossing
 * cost — unlike the gap between two live entry averages, which absorbs every
 * market move between the legs' open times. Contracts are venue-qualified
 * CrossEx symbols. */
export interface DealFillRecord {
  /** The journal pair row's id — stable identity for this one execution. */
  dealId: string;
  aContract: string;
  aSide: 'BUY' | 'SELL';
  bContract: string;
  bSide: 'BUY' | 'SELL';
  /** Absolute filled qty per leg. */
  aFilled: number;
  bFilled: number;
  /** Qty-weighted average fill price per leg. */
  aAvgFill: number;
  bAvgFill: number;
  /** Unix seconds of the deal row. */
  createdAtSec: number;
}

export interface StrategyLeg {
  kind: 'perp' | 'boros';
  /** Normalized venue key (BINANCE / HYPERLIQUID / …). */
  venue: string;
  base: string;
  side: 'LONG' | 'SHORT';
  notionalUsd: number;
  /** Boros only: the collateral token the position is margined and sized in. */
  collateral?: string;
  /** |notional| in token units — Boros: |notionalSize| in the collateral token
   * (notionalUsd = notionalToken × its USD price); perp: |qty| in the base coin. */
  notionalToken?: number;
  /** Boros only: entry fixed APR and current mark APR. */
  entryApr?: number;
  markApr?: number;
  /** Boros only: the reference perp's live floating APR (from /markets). */
  floatingApr?: number;
  /** Funding (perp) or settlement (Boros, net of settle fees) cash to date. */
  cashFlowUsd: number;
  /** Mark-to-market of the open position. */
  mtmUsd: number;
  /** Realized trade PnL NET of trade fees (Boros closes/partials; 0 for pure holds). */
  tradePnlUsd: number;
  /** Trading fees paid, as a POSITIVE cost number. */
  feesUsd: number;
  /** The leg's bottom line (fees not double-subtracted where already netted). */
  netUsd: number;
  /** Unix seconds the position was opened, when known. */
  openedAt: number | null;
  /** Boros only: unix-seconds maturity of the market. */
  maturity?: number;
  /** Perp only: the exact CrossEx symbol — the client's join key to the live
   * 4s-polled position (entry/mark/leverage display + close/lev actions). */
  symbol?: string;
  warnings: string[];
}

/** One tickable piece of a strategy's PAID perp entry cost.
 *
 * INVARIANT: the parts always sum to
 *   paid.perpTradingUsd + (paid.perpEntrySlippageUsd ?? 0)
 * — the client subtracts the un-ticked ones from exactly those two aggregates,
 * so any drift shows up immediately as a waterfall that misses its total.
 *
 * The two kinds are NOT symmetric, and the UI has to say so:
 *  - `slippage` is genuinely per-execution — one part per journal deal (a venue
 *    migration or a DCA top-up each get their own), or a single whole-book part
 *    when both legs were opened together.
 *  - `fees` is per LEG, covering that position's whole life. Gate reports a
 *    position's `fee` as one cumulative scalar, and neither the deal journal nor
 *    the funding ledger records a trading fee at any finer granularity, so a
 *    per-execution split would be a fabrication. A leg migrated away from has no
 *    live position and therefore contributes nothing here at all. */
export interface PerpEntryCostPart {
  /** Stable across reloads: the client persists the un-ticked ids. */
  id: string;
  kind: 'slippage' | 'fees';
  /** Signed — a favorable crossing is negative. */
  usd: number;
  /** Unix seconds; null when the cost has no single point in time (a leg's
   * lifetime fees). */
  atSec: number | null;
  /** Two venues for a slippage part (the pair that was crossed), one for fees. */
  venues: string[];
  /** Fees parts only. */
  side: 'LONG' | 'SHORT' | null;
  /** Matched qty — slippage parts only. */
  qty: number | null;
}

/** The strategy's cost ledger, split by whether the money is already gone
 * (paid) or still ahead (future). Feeds `expectedPnlToMaturityUsd`:
 * spread return − paid.totalUsd − future.borosSettlementUsd; the perp exit
 * parts are NOT baked in — the client folds each in via its own checkbox. */
export interface StrategyFees {
  paid: {
    /** Gate live position `fee` — exact for open positions. */
    perpTradingUsd: number;
    /** Entry crossing cost: (entry price of the LONG − entry price of the
     * SHORT) × matched qty. Signed — negative means the pair was entered at a
     * favorable gap. Null unless the strategy has exactly 1 long + 1 short
     * perp leg (no other reading is computable). */
    perpEntrySlippageUsd: number | null;
    /** Σ actual per-fill fees from /pnl/transactions since open — exact. */
    borosTradeUsd: number;
    /** Accrued settlement fees, estimated as notional × settleFeeApr × elapsed.
     * Display-only: settlement PnL is already NET of these (never re-subtract). */
    borosSettlementUsd: number;
    /** Sum of the above; a null slippage counts as 0 (a warning says so). */
    totalUsd: number;
  };
  future: {
    /** Exit trading fees assuming maker+hedge execution: maker rate on one
     * perp leg + taker on the other, cheaper assignment. Falls back to taker
     * on every leg when the strategy isn't a simple 2-leg pair. 0 when no
     * perp legs; null when perps exist but the fee schedule is unknown. */
    perpExitFeesUsd: number | null;
    /** Assumed equal to paid.perpEntrySlippageUsd (symmetric crossing cost). */
    perpExitSlippageUsd: number | null;
    /** Σ notional × settleFeeApr × time remaining to maturity — the exact
     * amount already subtracted inside expectedPnlToMaturityUsd. */
    borosSettlementUsd: number;
    /** Sum of the above; null propagates from the perp exit parts. */
    totalUsd: number | null;
  };
}

export type HedgeStatus = 'hedged' | 'partial' | 'unhedged';

/**
 * The three sizing checks that must ALL pass before the strategy's headline
 * numbers (APR on capital, capital, PnL by maturity) describe a real 4-leg
 * position rather than one still being built. Each ratio is matched/larger
 * (min/max), 0 when a side is absent entirely:
 *  - `borosMatchRatio`  — LONG-fixed vs SHORT-fixed Boros notional (> 0.9);
 *  - `perpMatchRatio`   — LONG vs SHORT perp notional (> 0.9);
 *  - `borosVsPerpRatio` — gross Boros vs gross perp notional (> 0.8).
 * `fullyHedged` is false whenever the perp side is not visible at all
 * (perpSource null): an unverifiable hedge is not a hedge. This is distinct
 * from `hedge`, the per-venue floating-cancellation band — that one asks "do
 * the venue rates cancel", this one asks "is the whole book actually built".
 */
export interface HedgeChecks {
  borosMatchRatio: number;
  perpMatchRatio: number;
  borosVsPerpRatio: number;
  fullyHedged: boolean;
}

export const BOROS_LEG_MATCH_MIN = 0.9;
export const PERP_LEG_MATCH_MIN = 0.9;
export const BOROS_VS_PERP_MATCH_MIN = 0.8;

/** What anchors the realized-APR annualization clock. Default: the strategy
 * starts when its Boros legs lock the spread — the perp pair may have existed
 * long before as a plain funding arb. */
export type ClockBasis = 'boros-open' | 'perp-open' | 'custom';

export interface StrategyRollup {
  base: string;
  /** Unix seconds (the Boros cohort's maturity). */
  maturity: number;
  legs: StrategyLeg[];
  hedge: HedgeStatus;
  /** Sizing gate for the headline numbers — see HedgeChecks. */
  hedgeChecks: HedgeChecks;
  capitalUsd: number;
  /** capitalUsd's two components: the perp legs' initial margin on CrossEx +
   * the Boros margin-group balance apportioned to this strategy. Sums to
   * capitalUsd by construction. */
  capitalSplit: { perpUsd: number; borosUsd: number };
  realizedPnlUsd: number;
  /** Annualized realized return on capital; null when too early / unknowable. */
  realizedApr: number | null;
  /** Locked fixed spread across the Boros legs (≈ rate_A − rate_B). */
  spread: number;
  lockedAprOnCapital: number;
  /** Full-life projection of the locked spread on the Boros notional:
   * (grossBorosNotional/2) × spread × (maturity − clockStart)/YEAR. Assumes the
   * spread was locked on the full notional since the strategy start — the UI
   * shows that assumption. Null when the clock start is unknown. */
  spreadReturnUsd: number | null;
  /** Vu's formula: spreadReturnUsd − feesUsd.paid.totalUsd −
   * feesUsd.future.borosSettlementUsd. The perp exit parts (fees + slippage)
   * are NOT included — the client folds each in via its own checkbox. Null
   * exactly when spreadReturnUsd is null. */
  expectedPnlToMaturityUsd: number | null;
  elapsedSeconds: number | null;
  clockBasis: ClockBasis | null;
  /** The clock's start instant (unix seconds) — lets the UI show the DATE the
   * spread-lock assumption runs from. Null when unknown. */
  clockStartSec: number | null;
  secondsToMaturity: number;
  /** Σ per-venue |residual floating notional| — 0 when perfectly hedged. */
  notionalMismatchUsd: number;
  feesUsd: StrategyFees;
  /** The PAID perp entry cost, itemised so the client can let a user drop the
   * executions that belong to an earlier strategy. Sums to
   * feesUsd.paid.perpTradingUsd + (feesUsd.paid.perpEntrySlippageUsd ?? 0). */
  perpEntryCostParts: PerpEntryCostPart[];
  /** Plain-language sentences, ready to render. */
  warnings: string[];
}

export interface StrategyReturns {
  address: string;
  /** null when Gate isn't configured — Boros-only view. */
  perpSource: 'connected-gate-account' | null;
  strategies: StrategyRollup[];
  totals: {
    capitalUsd: number;
    realizedPnlUsd: number;
    realizedApr: number | null;
    /** Σ non-null strategy projections. */
    expectedPnlToMaturityUsd: number;
    /** Σ paid fees (future costs are not "fees paid" — see per-strategy split). */
    feesTotalUsd: number;
    /** Σ future.perpExitFeesUsd; null if any strategy's schedule is unknown. */
    perpExitFeesTotalUsd: number | null;
    /** Σ future.perpExitSlippageUsd; null if any strategy's is unknown. */
    perpExitSlippageTotalUsd: number | null;
  };
  warnings: string[];
}

const fin = (v: string | number | undefined | null): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Boros platformName / CrossEx exchange → one venue key space. */
export function normalizeVenue(venue: string): string {
  return venue.trim().toUpperCase();
}

// ---------------------------------------------------------------------------
// Leg builders
// ---------------------------------------------------------------------------

/** Per-market digest of the txn history: exact fees + open time of the CURRENT
 * position (the latest open-from-flat event; everything after it belongs to
 * this position). Values stay in collateral-token units here. */
interface TxnDigest {
  openedAt: number | null;
  feesSinceOpen: number;
  tradePnlSinceOpen: number;
  sawAnyTxn: boolean;
}

function digestTxns(txns: BorosTxn[], marketId: number): TxnDigest {
  const forMarket = txns.filter((t) => t.marketId === marketId).sort((a, b) => a.time - b.time);
  if (!forMarket.length) {
    return { openedAt: null, feesSinceOpen: 0, tradePnlSinceOpen: 0, sawAnyTxn: false };
  }
  let openIdx = 0;
  for (let i = forMarket.length - 1; i >= 0; i -= 1) {
    if (fin(forMarket[i].prevPositionS) === 0 && fin(forMarket[i].postPositionS) !== 0) {
      openIdx = i;
      break;
    }
  }
  const current = forMarket.slice(openIdx);
  return {
    openedAt: current[0].time || null,
    feesSinceOpen: current.reduce((s, t) => s + Math.abs(norm18(t.fee)), 0),
    tradePnlSinceOpen: current.reduce((s, t) => s + norm18(t.pnl), 0),
    sawAnyTxn: true,
  };
}

interface BorosLegBuild {
  leg: StrategyLeg;
  /** Stable identity of the margin group this position sits in. */
  groupKey: string;
  /** For capital apportionment (all USD). */
  groupNetBalanceUsd: number;
  groupInitialMarginUsd: number;
  positionInitialMarginUsd: number;
  settleFeeApr: number;
  paymentPeriod: number;
}

interface PerpLegBuild {
  leg: StrategyLeg;
  /** Gate initialMargin — the capital this leg consumes. */
  imUsd: number;
  /** Full CrossEx symbol — needed to resolve the venue's exit fee rates. */
  symbol: string;
  /** Average entry price + absolute qty — feed the entry-slippage estimate. */
  entryPrice: number;
  qty: number;
  /** Gate position id — joins the account-book funding ledger. */
  positionId: string;
  /** Gate's position-lifetime cumulative funding (the since-open counter). */
  cumulativeFundingUsd: number;
}

function buildBorosLeg(
  p: BorosMarketPosition,
  px: number,
  markets: Map<number, BorosMarket>,
  txns: BorosTxn[],
  group: { key: string; collateral: string; netBalanceUsd: number; initialMarginUsd: number },
): BorosLegBuild {
  const market = markets.get(p.marketId);
  const legWarnings: string[] = [];
  if (!market) {
    legWarnings.push(
      `Boros market #${p.marketId} is missing from /markets — using position-level rates; settlement-fee estimate skipped.`,
    );
  }
  const digest = digestTxns(txns, p.marketId);
  if (!digest.sawAnyTxn) {
    legWarnings.push(
      `No trade history found for ${market?.name ?? `market #${p.marketId}`} — trade fees may be understated and the open time is unknown.`,
    );
  }

  const signed = norm18(p.notionalSize);
  const side: 'LONG' | 'SHORT' = signed >= 0 ? 'LONG' : 'SHORT';
  const cashFlowUsd = norm18(p.pnl.rateSettlementPnl) * px;
  const mtmUsd = norm18(p.pnl.unrealisedPnl) * px;
  const tradePnlUsd = digest.tradePnlSinceOpen * px;

  return {
    leg: {
      kind: 'boros',
      venue: normalizeVenue(market?.venue ?? ''),
      base: (market?.base ?? '').toUpperCase(),
      side,
      notionalUsd: Math.abs(signed) * px,
      collateral: group.collateral,
      notionalToken: Math.abs(signed),
      entryApr: p.fixedApr,
      markApr: p.markApr || market?.markApr,
      floatingApr: market?.floatingApr,
      cashFlowUsd,
      mtmUsd,
      // tradePnlUsd is NET of fees (txn.pnl includes −fee); netUsd must not
      // subtract fees again. feesUsd is the display breakdown of that cost.
      tradePnlUsd,
      feesUsd: digest.feesSinceOpen * px,
      netUsd: cashFlowUsd + mtmUsd + tradePnlUsd,
      openedAt: digest.openedAt,
      maturity: market?.maturity,
      warnings: legWarnings,
    },
    groupKey: group.key,
    groupNetBalanceUsd: group.netBalanceUsd,
    groupInitialMarginUsd: group.initialMarginUsd,
    positionInitialMarginUsd: norm18(p.positionInitialMargin ?? p.initialMargin) * px,
    settleFeeApr: market?.settleFeeApr ?? 0,
    paymentPeriod: market?.paymentPeriod ?? 0,
  };
}

function buildBorosLegs(
  zones: BorosCollateralZone[],
  markets: Map<number, BorosMarket>,
  txnsByToken: Map<number, BorosTxn[]>,
  pricesUsd: Map<number, number | null>,
  warnings: string[],
): BorosLegBuild[] {
  const out: BorosLegBuild[] = [];
  for (const zone of zones) {
    const groups = [...(zone.cross ? [zone.cross] : []), ...zone.isolated];
    const hasPositions = groups.some((g) => g.marketPositions.some((p) => fin(p.notionalSize) !== 0));
    if (!hasPositions) continue;

    const sym = BOROS_TOKEN_SYMBOLS[zone.tokenId] ?? `token#${zone.tokenId}`;
    const px = pricesUsd.get(zone.tokenId) ?? null;
    if (px === null) {
      warnings.push(
        `Can't price the ${sym} collateral zone in USD (no reference market) — its positions are excluded.`,
      );
      continue;
    }

    const txns = txnsByToken.get(zone.tokenId) ?? [];
    groups.forEach((group, gi) => {
      const groupCtx = {
        key: `${zone.tokenId}:${group.isCross ? 'cross' : `iso${gi}`}`,
        collateral: sym,
        netBalanceUsd: norm18(group.netBalance) * px,
        initialMarginUsd: group.marketPositions.reduce(
          (s, p) => s + norm18(p.positionInitialMargin ?? p.initialMargin) * px,
          0,
        ),
      };
      for (const p of group.marketPositions) {
        if (norm18(p.notionalSize) === 0) continue;
        out.push(buildBorosLeg(p, px, markets, txns, groupCtx));
      }
    });
  }
  return out;
}

function buildPerpLeg(pos: PerpPositionLike): PerpLegBuild {
  const { exchange, base } = parseSymbol(pos.symbol ?? '');
  const qty = fin(pos.positionQty);
  const side: 'LONG' | 'SHORT' =
    (pos.positionSide ?? '').toUpperCase() === 'SHORT' || qty < 0 ? 'SHORT' : 'LONG';
  const cashFlowUsd = fin(pos.fundingFee);
  const mtmUsd = fin(pos.upnl);
  // Gate reports `fee` as the position's cumulative trading fees; its sign is
  // not documented — treat it as a cost either way.
  const feesUsd = Math.abs(fin(pos.fee));
  const openedAtRaw = fin(pos.createTime);
  return {
    leg: {
      kind: 'perp',
      venue: normalizeVenue(exchange),
      base: base.toUpperCase(),
      side,
      notionalUsd: Math.abs(fin(pos.positionValue)),
      notionalToken: Math.abs(qty),
      cashFlowUsd,
      // Display-only for perps: the delta-neutral pair's price MtM nets to
      // entry-gap noise, which the strategy accounts as entry slippage.
      mtmUsd,
      tradePnlUsd: 0,
      feesUsd,
      // Perp net EXCLUDES price MtM: funding − fees. The funding may still be
      // re-based to the strategy clock in assembleStrategy (ledger permitting).
      netUsd: cashFlowUsd - feesUsd,
      // createTime may be seconds or milliseconds — normalize to seconds.
      openedAt:
        openedAtRaw > 0 ? (openedAtRaw < 1e12 ? openedAtRaw : Math.floor(openedAtRaw / 1000)) : null,
      symbol: pos.symbol,
      warnings: [],
    },
    imUsd: Math.abs(fin(pos.initialMargin)),
    symbol: pos.symbol ?? '',
    entryPrice: fin(pos.entryPrice),
    qty: Math.abs(qty),
    positionId: pos.positionId ?? '',
    cumulativeFundingUsd: cashFlowUsd,
  };
}

// ---------------------------------------------------------------------------
// Strategy assembly
// ---------------------------------------------------------------------------

const signedNotional = (leg: StrategyLeg): number =>
  leg.side === 'LONG' ? leg.notionalUsd : -leg.notionalUsd;

/** Floating-rate exposure sign: a Boros LONG receives floating (+), a perp
 * LONG pays funding (−); shorts are the opposite. Per venue these should net
 * to ~0 when the 4-leg hedge is on. */
const floatingExposure = (leg: StrategyLeg): number =>
  leg.kind === 'boros' ? signedNotional(leg) : -signedNotional(leg);

/** Boros fixed-rate cash direction: SHORT receives fixed (+), LONG pays (−). */
const fixedSign = (leg: StrategyLeg): number => (leg.side === 'SHORT' ? 1 : -1);

/** |net|/gross band under which a venue's floating counts as cancelled —
 * matches computeExposure's delta-neutrality band. */
const HEDGE_BAND = 0.02;

/** Longest standard perp funding interval (Binance et al. settle every 8h).
 * Within this window of the strategy start, a pre-existing position with an
 * empty funding ledger is normal — the first settlement boundary since the
 * lock may simply not have passed yet. Beyond it, absence is suspicious. */
const FUNDING_LEDGER_GRACE_SEC = 8 * 3600;

/** Widest open-time gap at which the two live entry averages still count as
 * contemporaneous. A position's createTime stamps at its FIRST fill and the
 * engine hedges each fill within seconds, so even a long-resting maker opens
 * both positions moments apart once filling starts; 3× the 5-minute convert
 * deadline tolerates re-pegs and slow partial starts. Beyond it the entry gap
 * absorbs market drift and stops being slippage. */
const PERP_ENTRY_SYNC_MAX_SEC = 15 * 60;

/** How far before the earliest live position's open the deal chain may reach:
 * a deal row's created_at precedes the position's first fill by however long
 * the maker rested, so the window must cover intent-to-first-fill lag. */
const DEAL_CHAIN_LOOKBACK_SEC = 48 * 3600;

/** Relative tolerance for the chain's qty reconciliation — absorbs lot
 * rounding and dust-sized unhedged remainders (mirrors HEDGE_BAND). */
const DEAL_CHAIN_QTY_BAND = 0.02;

/** True entry slippage of a book built across several executions: the sum of
 * each journal deal's own contemporaneous fill gap. Valid only when the deals
 * fully explain the live book — the signed filled quantities must net to the
 * live legs' sizes (and to ~zero on every intermediate venue), else some of
 * the book was built off-journal and a sum would silently be wrong: null,
 * never a guess. Venue is deliberately NOT matched per deal — a migration
 * chain flows through venues the live book no longer holds. */
export function chainPerpEntrySlippageUsd(
  deals: DealFillRecord[],
  pair: {
    base: string;
    longSymbol: string;
    longQty: number;
    shortSymbol: string;
    shortQty: number;
    earliestOpenSec: number | null;
  },
): { usd: number; deals: number; parts: PerpEntryCostPart[] } | null {
  const sinceSec = (pair.earliestOpenSec ?? 0) - DEAL_CHAIN_LOOKBACK_SEC;
  const netQtyBySymbol = new Map<string, number>();
  const parts: PerpEntryCostPart[] = [];
  let gapUsd = 0;
  let used = 0;
  for (const d of deals) {
    if (d.createdAtSec < sinceSec) continue;
    if (parseSymbol(d.aContract).base !== pair.base || parseSymbol(d.bContract).base !== pair.base)
      continue;
    if (d.aSide === d.bSide) return null; // not an opposing pair — journal corruption
    const matched = Math.min(d.aFilled, d.bFilled);
    if (!(matched > 0) || !(d.aAvgFill > 0) || !(d.bAvgFill > 0)) return null;
    const longFill = d.aSide === 'BUY' ? d.aAvgFill : d.bAvgFill;
    const shortFill = d.aSide === 'BUY' ? d.bAvgFill : d.aAvgFill;
    const dealGapUsd = (longFill - shortFill) * matched;
    gapUsd += dealGapUsd;
    // Same arithmetic, kept per deal: the caller lists these so a user can
    // drop the executions that belong to an EARLIER strategy.
    parts.push({
      id: `slip:deal:${d.dealId}`,
      kind: 'slippage',
      usd: dealGapUsd,
      atSec: d.createdAtSec,
      venues: [parseSymbol(d.aContract).exchange, parseSymbol(d.bContract).exchange].map(
        normalizeVenue,
      ),
      side: null,
      qty: matched,
    });
    netQtyBySymbol.set(
      d.aContract,
      (netQtyBySymbol.get(d.aContract) ?? 0) + (d.aSide === 'BUY' ? d.aFilled : -d.aFilled),
    );
    netQtyBySymbol.set(
      d.bContract,
      (netQtyBySymbol.get(d.bContract) ?? 0) + (d.bSide === 'BUY' ? d.bFilled : -d.bFilled),
    );
    used++;
  }
  if (used === 0) return null;
  const band = DEAL_CHAIN_QTY_BAND * Math.max(pair.longQty, pair.shortQty);
  const expected = (symbol: string): number =>
    symbol === pair.longSymbol ? pair.longQty : symbol === pair.shortSymbol ? -pair.shortQty : 0;
  const symbols = new Set([...netQtyBySymbol.keys(), pair.longSymbol, pair.shortSymbol]);
  for (const s of symbols) {
    if (Math.abs((netQtyBySymbol.get(s) ?? 0) - expected(s)) > band) return null;
  }
  return { usd: gapUsd, deals: used, parts };
}

function assembleStrategy(
  base: string,
  maturity: number,
  borosBuilds: BorosLegBuild[],
  perpBuilds: PerpLegBuild[],
  perpAvailable: boolean,
  nowSec: number,
  clockStartOverrideSec?: number,
  venueFees?: VenueFeeRow[] | null,
  fundingLedger?: PerpFundingLedger | null,
  dealFills?: DealFillRecord[] | null,
): StrategyRollup {
  const warnings: string[] = [];
  const borosLegs = borosBuilds.map((b) => b.leg);
  const perpLegs = perpBuilds.map((b) => b.leg);
  const legs = [
    ...perpLegs.slice().sort((a, b) => a.venue.localeCompare(b.venue)),
    ...borosLegs.slice().sort((a, b) => a.venue.localeCompare(b.venue)),
  ];
  for (const leg of legs) warnings.push(...leg.warnings);

  // --- Hedge health: per-venue floating cancellation ------------------------
  const venues = [...new Set(legs.map((l) => l.venue))];
  let notionalMismatchUsd = 0;
  let anyVenueOutOfBand = false;
  for (const venue of venues) {
    const atVenue = legs.filter((l) => l.venue === venue);
    const net = atVenue.reduce((s, l) => s + floatingExposure(l), 0);
    const gross = atVenue.reduce((s, l) => s + l.notionalUsd, 0);
    notionalMismatchUsd += Math.abs(net);
    if (gross > 0 && Math.abs(net) / gross > HEDGE_BAND) {
      anyVenueOutOfBand = true;
      const hasBoros = atVenue.some((l) => l.kind === 'boros');
      const hasPerp = atVenue.some((l) => l.kind === 'perp');
      if (perpAvailable && hasBoros && !hasPerp) {
        warnings.push(
          `No ${venue} perp found for ${base} in the connected Gate account — that side's floating rate is unhedged.`,
        );
      } else if (hasBoros && hasPerp) {
        warnings.push(
          `${venue} legs are imbalanced by $${Math.round(Math.abs(net)).toLocaleString('en-US')} of notional — the locked rate only covers the matched part.`,
        );
      }
    }
  }
  let hedge: HedgeStatus;
  if (!perpAvailable) {
    hedge = 'partial'; // can't see the perp side — don't assert either way
  } else if (!perpLegs.length) {
    hedge = 'unhedged';
    warnings.push(
      `No matching perp legs for ${base} in the connected Gate account — the floating side is unhedged (or hedged elsewhere).`,
    );
  } else {
    hedge = anyVenueOutOfBand ? 'partial' : 'hedged';
  }

  // --- Sizing gate for the headline numbers ---------------------------------
  // APR-on-capital, capital and PnL-by-maturity all assume the spread is
  // locked on a BUILT book. While the position is still being entered (one
  // Boros leg filled, hedge lagging, perps sized differently), those numbers
  // are confidently wrong — e.g. the full-life spread projection on half the
  // notional. The ratios are matched/larger per check; the perp side counts 0
  // when invisible, because an unverifiable hedge is not a hedge.
  const sideSum = (ls: StrategyLeg[], side: StrategyLeg['side']): number =>
    ls.filter((l) => l.side === side).reduce((s, l) => s + l.notionalUsd, 0);
  const matchRatio = (a: number, b: number): number => {
    const hi = Math.max(a, b);
    return hi > 0 ? Math.min(a, b) / hi : 0;
  };
  const grossBoros = borosLegs.reduce((s, l) => s + l.notionalUsd, 0);
  const grossPerp = perpAvailable ? perpLegs.reduce((s, l) => s + l.notionalUsd, 0) : 0;
  const hedgeChecks: HedgeChecks = {
    borosMatchRatio: matchRatio(sideSum(borosLegs, 'LONG'), sideSum(borosLegs, 'SHORT')),
    perpMatchRatio: perpAvailable ? matchRatio(sideSum(perpLegs, 'LONG'), sideSum(perpLegs, 'SHORT')) : 0,
    borosVsPerpRatio: matchRatio(grossBoros, grossPerp),
    fullyHedged: false, // set below from the three ratios
  };
  hedgeChecks.fullyHedged =
    hedgeChecks.borosMatchRatio > BOROS_LEG_MATCH_MIN &&
    hedgeChecks.perpMatchRatio > PERP_LEG_MATCH_MIN &&
    hedgeChecks.borosVsPerpRatio > BOROS_VS_PERP_MATCH_MIN;

  // --- Capital ---------------------------------------------------------------
  // Perp side: initial margin of the matched legs (positions sit on shared
  // CrossEx collateral; IM is what the pair actually consumes). Boros side:
  // apportion each margin group's netBalance (cash actually posted) across
  // its positions by initial-margin share — a group can back several
  // strategies, so never count its full balance more than once.
  const perpCapitalUsd = perpBuilds.reduce((s, b) => s + b.imUsd, 0);
  const byGroup = new Map<string, { balance: number; groupIm: number; strategyIm: number }>();
  for (const b of borosBuilds) {
    const entry = byGroup.get(b.groupKey) ?? {
      balance: b.groupNetBalanceUsd,
      groupIm: b.groupInitialMarginUsd,
      strategyIm: 0,
    };
    entry.strategyIm += b.positionInitialMarginUsd;
    byGroup.set(b.groupKey, entry);
  }
  let borosCapitalUsd = 0;
  for (const g of byGroup.values()) {
    borosCapitalUsd += g.groupIm > 0 ? g.balance * (g.strategyIm / g.groupIm) : g.balance;
  }
  const capitalUsd = perpCapitalUsd + borosCapitalUsd;

  // --- Strategy clock -----------------------------------------------------------
  // The strategy starts when its BOROS legs lock the spread (default). Perp
  // opens are only a fallback when the Boros open time is unknown; a
  // user-supplied override wins over both. The clock anchors BOTH the realized
  // window and the perp funding measurement below.
  const isOpen = (t: number | null): t is number => t !== null && t > 0;
  const borosOpens = borosLegs.map((l) => l.openedAt).filter(isOpen);
  const perpOpens = perpLegs.map((l) => l.openedAt).filter(isOpen);
  let clockStart: number | null = null;
  let clockBasis: ClockBasis | null = null;
  if (clockStartOverrideSec !== undefined) {
    clockStart = clockStartOverrideSec;
    clockBasis = 'custom';
  } else if (borosOpens.length) {
    clockStart = Math.min(...borosOpens);
    clockBasis = 'boros-open';
  } else if (perpOpens.length) {
    clockStart = Math.min(...perpOpens);
    clockBasis = 'perp-open';
    warnings.push(
      `The ${base} Boros open time is unknown (no trade history) — the APR clock falls back to the earliest perp open.`,
    );
  }
  const elapsedSeconds = clockStart !== null ? Math.max(1, nowSec - clockStart) : null;

  // --- Perp funding re-based to the clock -----------------------------------------
  // A position opened at/after the clock start already reports the right
  // number (Gate's cumulative counter starts at the open). A position that
  // PREDATES the clock includes pre-lock funding — re-sum it from the
  // account-book ledger; if the ledger can't cover the window, keep the
  // counter and say so.
  for (const b of perpBuilds) {
    if (clockStart === null || b.leg.openedAt === null || b.leg.openedAt >= clockStart) continue;
    // The ledger must actually CARRY this position before we re-base against it.
    // `?? []` here would sum to 0 and overwrite the venue's cumulative counter
    // with $0 — and because the outer condition already passed, the warning
    // below would never fire. An empty map entry is indistinguishable from a
    // ledger query that came back unusable (a `from` the API read differently, a
    // statementType label change, a businessId that isn't `{positionId}_{ts}`),
    // so a missing position means "cannot re-base", never "earned nothing".
    // Funding is the single largest P&L component of a funding-rate arb; showing
    // a confident $0 is far worse than showing the counter and saying why.
    const ledgerRows = b.positionId ? fundingLedger?.byPosition.get(b.positionId) : undefined;
    if (fundingLedger && fundingLedger.coversFromSec <= clockStart && ledgerRows) {
      const sinceStart = ledgerRows
        .filter((e) => e.timeSec >= clockStart)
        .reduce((s, e) => s + e.changeUsd, 0);
      b.leg.cashFlowUsd = sinceStart;
      b.leg.netUsd = sinceStart - b.leg.feesUsd;
    } else if (fundingLedger && fundingLedger.coversFromSec <= clockStart && !ledgerRows) {
      if (nowSec - clockStart < FUNDING_LEDGER_GRACE_SEC) {
        // A young strategy may simply not have crossed a funding-settlement
        // boundary yet (venues settle at up to 8h intervals), so a
        // shortly-pre-existing position with no ledger rows is the EXPECTED
        // truth, not an unusable read: funding since the lock really is $0.
        // Re-base to 0 with no warning — the cumulative counter would
        // over-attribute pre-lock accrual, and a "returned no rows" notice
        // here reads as an error where nothing is wrong.
        b.leg.cashFlowUsd = 0;
        b.leg.netUsd = -b.leg.feesUsd;
      } else {
        warnings.push(
          `The ${b.leg.venue} ${base} perp predates the strategy start and the CrossEx funding ledger returned no rows for it — its funding number is the venue's cumulative counter and includes pre-lock accrual.`,
        );
      }
    } else {
      warnings.push(
        `The ${b.leg.venue} ${base} perp predates the strategy start — its funding number includes pre-lock accrual (the CrossEx funding ledger doesn't cover that window).`,
      );
    }
  }

  // --- Entry slippage (the perp pair's crossing cost) ---------------------------
  // Computable only for a simple pair — exactly one long + one short perp leg
  // with known entry prices — and from LIVE entries only when the two opens are
  // contemporaneous: the gap between entry averages is crossing cost only if no
  // market time passed between them. A book rebuilt leg-by-leg (venue
  // migration) instead sums each journal deal's own contemporaneous gap, so
  // drift between the opens never masquerades as slippage. Signed: paying up
  // for the long relative to the short is a cost; negative means a favorable
  // gap. No perp legs at all ⇒ structurally 0 (nothing was crossed), never
  // null — a null here would poison the account totals for every OTHER
  // strategy.
  const longPerps = perpBuilds.filter((b) => b.leg.side === 'LONG');
  const shortPerps = perpBuilds.filter((b) => b.leg.side === 'SHORT');
  let perpEntrySlippageUsd: number | null = perpBuilds.length === 0 ? 0 : null;
  let slippageCauseWarned = false;
  // The tickable decomposition of the entry cost. Slippage parts are appended
  // by whichever branch below produces a number; the per-leg fee parts follow.
  // These MUST sum to perpTradingUsd + (perpEntrySlippageUsd ?? 0).
  const perpEntryCostParts: PerpEntryCostPart[] = [];
  if (perpBuilds.length === 2 && longPerps.length === 1 && shortPerps.length === 1) {
    const [lo] = longPerps;
    const [sh] = shortPerps;
    if (lo.entryPrice > 0 && sh.entryPrice > 0) {
      const loOpen = lo.leg.openedAt;
      const shOpen = sh.leg.openedAt;
      const synced =
        loOpen !== null && shOpen !== null && Math.abs(loOpen - shOpen) <= PERP_ENTRY_SYNC_MAX_SEC;
      if (synced) {
        const matched = Math.min(lo.qty, sh.qty);
        perpEntrySlippageUsd = (lo.entryPrice - sh.entryPrice) * matched;
        // Both legs opened together, so the whole book is ONE execution — there
        // is nothing finer to tick, but it still lists alongside the fees.
        perpEntryCostParts.push({
          id: 'slip:live',
          kind: 'slippage',
          usd: perpEntrySlippageUsd,
          atSec: Math.min(loOpen, shOpen),
          venues: [lo.leg.venue, sh.leg.venue],
          side: null,
          qty: matched,
        });
      } else {
        const opens = [loOpen, shOpen].filter((t): t is number => t !== null && t > 0);
        const chained = dealFills?.length
          ? chainPerpEntrySlippageUsd(dealFills, {
              base,
              longSymbol: lo.symbol,
              longQty: lo.qty,
              shortSymbol: sh.symbol,
              shortQty: sh.qty,
              earliestOpenSec: opens.length ? Math.min(...opens) : null,
            })
          : null;
        const cause =
          loOpen === null || shOpen === null
            ? "a perp leg's open time is unknown, so the entries cannot be confirmed contemporaneous"
            : 'the perp legs were opened at different times, so the live entry gap would include market drift';
        if (chained !== null) {
          perpEntrySlippageUsd = chained.usd;
          perpEntryCostParts.push(...chained.parts);
          warnings.push(
            `Entry slippage for ${base} is summed from ${chained.deals} deal${chained.deals === 1 ? '' : 's'} in this terminal's journal (${cause}).`,
          );
        } else {
          slippageCauseWarned = true;
          warnings.push(
            `Entry slippage for ${base} is unknown (${cause}, and the local deal journal cannot reconstruct the original fills) — it is excluded from the cost totals.`,
          );
        }
      }
    }
  }
  if (perpEntrySlippageUsd === null && perpBuilds.length > 0 && !slippageCauseWarned) {
    warnings.push(
      `Entry slippage for ${base} is unknown (not a simple 1-long/1-short perp pair with known entries) — it is excluded from the cost totals.`,
    );
  }
  // One fee part per LIVE perp leg. Gate reports each position's `fee` as a
  // single cumulative scalar covering the position's whole life, so this is as
  // fine as the data honestly goes — and a leg migrated away from has no live
  // position, so it never appears here (nor in perpTradingUsd).
  for (const b of perpBuilds) {
    if (b.leg.feesUsd === 0) continue;
    perpEntryCostParts.push({
      id: `fees:${b.symbol}`,
      kind: 'fees',
      usd: b.leg.feesUsd,
      atSec: null,
      venues: [b.leg.venue],
      side: b.leg.side,
      qty: null,
    });
  }

  // --- Realized ----------------------------------------------------------------
  // Σ leg nets (perp = funding − fees; boros = settlements + mtm + tradePnl)
  // minus the pair's entry slippage — the realized cost of crossing both books,
  // which replaced the perps' price MtM in the leg nets.
  const realizedPnlUsd =
    legs.reduce((s, l) => s + l.netUsd, 0) - (perpEntrySlippageUsd ?? 0);
  const maxPaymentPeriod = Math.max(0, ...borosBuilds.map((b) => b.paymentPeriod));
  let realizedApr: number | null = null;
  if (elapsedSeconds !== null && capitalUsd > 0 && elapsedSeconds >= maxPaymentPeriod) {
    realizedApr = (realizedPnlUsd / capitalUsd) * (SECONDS_IN_YEAR / elapsedSeconds);
  }

  // --- Locked spread ----------------------------------------------------------
  const netFixedPerYearUsd = borosLegs.reduce(
    (s, l) => s + fixedSign(l) * (l.entryApr ?? 0) * l.notionalUsd,
    0,
  );
  const grossBorosNotional = borosLegs.reduce((s, l) => s + l.notionalUsd, 0);
  // For the canonical 2-leg book (equal notional N): netFixed = (rateA−rateB)·N
  // and gross = 2N, so netFixed / (gross/2) recovers the spread exactly.
  const spread = grossBorosNotional > 0 ? netFixedPerYearUsd / (grossBorosNotional / 2) : 0;
  const lockedAprOnCapital = capitalUsd > 0 ? netFixedPerYearUsd / capitalUsd : 0;

  // Full-life spread return: the locked net fixed rate accrued from the
  // strategy start to maturity. netFixedPerYearUsd ≡ (gross/2) × spread, so
  // this is N × spread × duration for the canonical book, and stays exact for
  // unequal notionals. Assumes the spread was locked on the full notional
  // since the start — the UI surfaces that assumption verbatim.
  const spreadReturnUsd =
    clockStart !== null
      ? netFixedPerYearUsd * (Math.max(0, maturity - clockStart) / SECONDS_IN_YEAR)
      : null;

  // --- Perp exit cost (maker+hedge close) ---------------------------------------
  // For a 2-leg pair: maker order on one venue + taker hedge on the other —
  // price the CHEAPER maker assignment. Any other shape: taker on every leg.
  const perpRatePairs = perpBuilds.map((b) => ({
    notionalUsd: b.leg.notionalUsd,
    rates: venueFees ? resolveFeeRates(venueFees, b.symbol) : null,
  }));
  let perpExitFeesUsd: number | null;
  if (perpRatePairs.some((r) => r.rates === null)) {
    perpExitFeesUsd = null; // perps exist but the schedule is unknown — say so
  } else if (perpRatePairs.length === 2) {
    const [a, b] = perpRatePairs;
    perpExitFeesUsd = Math.min(
      a.notionalUsd * a.rates!.makerRate + b.notionalUsd * b.rates!.takerRate,
      a.notionalUsd * a.rates!.takerRate + b.notionalUsd * b.rates!.makerRate,
    );
  } else {
    perpExitFeesUsd = perpRatePairs.reduce((s, r) => s + r.notionalUsd * r.rates!.takerRate, 0);
  }
  // Exit crossing cost assumed symmetric to entry.
  const perpExitSlippageUsd = perpEntrySlippageUsd;

  // --- Fees: paid vs future ------------------------------------------------------
  const perpTradingUsd = perpLegs.reduce((s, l) => s + l.feesUsd, 0);
  const borosTradeUsd = borosLegs.reduce((s, l) => s + l.feesUsd, 0);
  let borosSettlementPaidUsd = 0;
  let borosSettlementFutureUsd = 0;
  for (const b of borosBuilds) {
    if (b.settleFeeApr <= 0) continue;
    const legMaturity = b.leg.maturity ?? maturity;
    if (b.leg.openedAt !== null) {
      const settledElapsed = Math.max(0, Math.min(nowSec, legMaturity) - b.leg.openedAt);
      borosSettlementPaidUsd +=
        b.leg.notionalUsd * b.settleFeeApr * (settledElapsed / SECONDS_IN_YEAR);
    }
    // No openedAt condition here: the fee runs to maturity for every open leg
    // whether or not its open time is known.
    borosSettlementFutureUsd +=
      b.leg.notionalUsd * b.settleFeeApr * (Math.max(0, legMaturity - nowSec) / SECONDS_IN_YEAR);
  }
  const paidTotalUsd =
    perpTradingUsd + (perpEntrySlippageUsd ?? 0) + borosTradeUsd + borosSettlementPaidUsd;
  const futureTotalUsd =
    perpExitFeesUsd === null || perpExitSlippageUsd === null
      ? null
      : perpExitFeesUsd + perpExitSlippageUsd + borosSettlementFutureUsd;

  // --- Profit by maturity --------------------------------------------------------
  // spread return − paid costs − future Boros settlement fees. The perp exit
  // parts are deliberately left out: the client folds each in via its own
  // checkbox (the server never bakes exit costs into the headline).
  const expectedPnlToMaturityUsd =
    spreadReturnUsd === null ? null : spreadReturnUsd - paidTotalUsd - borosSettlementFutureUsd;

  return {
    base,
    maturity,
    legs,
    hedge,
    hedgeChecks,
    capitalUsd,
    capitalSplit: { perpUsd: perpCapitalUsd, borosUsd: borosCapitalUsd },
    realizedPnlUsd,
    realizedApr,
    spread,
    lockedAprOnCapital,
    spreadReturnUsd,
    expectedPnlToMaturityUsd,
    elapsedSeconds,
    clockBasis,
    clockStartSec: clockStart,
    secondsToMaturity: Math.max(0, maturity - nowSec),
    notionalMismatchUsd,
    perpEntryCostParts,
    feesUsd: {
      paid: {
        perpTradingUsd,
        perpEntrySlippageUsd,
        borosTradeUsd,
        borosSettlementUsd: borosSettlementPaidUsd,
        totalUsd: paidTotalUsd,
      },
      future: {
        perpExitFeesUsd,
        perpExitSlippageUsd,
        borosSettlementUsd: borosSettlementFutureUsd,
        totalUsd: futureTotalUsd,
      },
    },
    warnings: [...new Set(warnings)],
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface BuildStrategiesInput {
  address: string;
  zones: BorosCollateralZone[];
  markets: BorosMarket[];
  /** Full txn history per collateral tokenId (for exact fees + open times). */
  txnsByToken: Map<number, BorosTxn[]>;
  pricesUsd: Map<number, number | null>;
  /** null ⇒ the perp side is unavailable (Boros-only view). */
  perpPositions: PerpPositionLike[] | null;
  /** Why perps are unavailable — replaces the default "not configured" sentence
   * so a transient Gate failure is never misreported as missing credentials. */
  perpsUnavailableWarning?: string;
  /** User-chosen APR clock start (unix seconds) — overrides the Boros-open default. */
  clockStartOverrideSec?: number;
  /** /crossex/fee rows for exit-cost estimation; null/absent = schedule unknown. */
  venueFees?: VenueFeeRow[] | null;
  /** CrossEx account-book funding ledger — re-bases perp funding to the clock
   * start when a position predates it; null/absent = ledger unavailable. */
  perpFunding?: PerpFundingLedger | null;
  /** Finished deals from the local engine journal — chains true entry slippage
   * across leg migrations when the live entries are not contemporaneous;
   * null/absent = journal unavailable (public mode, tests). */
  dealFills?: DealFillRecord[] | null;
  nowSec: number;
}

export function buildStrategies(input: BuildStrategiesInput): StrategyReturns {
  const globalWarnings: string[] = [];
  const marketById = new Map(input.markets.map((m) => [m.marketId, m]));

  const borosBuilds = buildBorosLegs(
    input.zones,
    marketById,
    input.txnsByToken,
    input.pricesUsd,
    globalWarnings,
  );

  const perpAvailable = input.perpPositions !== null;
  if (!perpAvailable) {
    globalWarnings.push(
      input.perpsUnavailableWarning ??
        'Gate credentials are not configured — showing the Boros legs only (connect Gate keys to overlay perp legs 1–2).',
    );
  }
  const perpBuildsAll = (input.perpPositions ?? [])
    .filter((p) => fin(p.positionQty) !== 0 || fin(p.positionValue) !== 0)
    .map(buildPerpLeg);

  // --- Group Boros legs into strategies by (base, maturity) ------------------
  const cohorts = new Map<string, { base: string; maturity: number; builds: BorosLegBuild[] }>();
  for (const b of borosBuilds) {
    const base = b.leg.base || '?';
    const maturity = b.leg.maturity ?? 0;
    const key = `${base}@${maturity}`;
    const cohort = cohorts.get(key) ?? { base, maturity, builds: [] };
    cohort.builds.push(b);
    cohorts.set(key, cohort);
  }
  const cohortList = [...cohorts.values()];

  // --- Attach perp legs to cohorts by (venue, base) ---------------------------
  // Perps are perpetual (no maturity): when a coin has several Boros maturity
  // cohorts, attach each perp to the cohort with the largest Boros notional at
  // its venue and note the ambiguity. Perps whose base has no Boros cohort at
  // all are NOT part of any 4-leg strategy — the Positions panel owns those.
  const attachedByCohort = new Map<(typeof cohortList)[number], PerpLegBuild[]>();
  for (const perp of perpBuildsAll) {
    const sameBase = cohortList.filter((c) => c.base === perp.leg.base);
    if (!sameBase.length) continue;
    const ranked = sameBase
      .map((c) => ({
        cohort: c,
        venueNotional: c.builds
          .filter((b) => b.leg.venue === perp.leg.venue)
          .reduce((s, b) => s + b.leg.notionalUsd, 0),
      }))
      .sort((a, b) => b.venueNotional - a.venueNotional);
    const winner = ranked[0].venueNotional > 0 ? ranked[0].cohort : sameBase[0];
    if (sameBase.length > 1) {
      perp.leg.warnings.push(
        `${perp.leg.base} has ${sameBase.length} Boros maturities — this ${perp.leg.venue} perp was attached to the largest cohort on its venue.`,
      );
    }
    attachedByCohort.set(winner, [...(attachedByCohort.get(winner) ?? []), perp]);
  }

  const strategies = cohortList.map((cohort) =>
    assembleStrategy(
      cohort.base,
      cohort.maturity,
      cohort.builds,
      attachedByCohort.get(cohort) ?? [],
      perpAvailable,
      input.nowSec,
      input.clockStartOverrideSec,
      input.venueFees,
      input.perpFunding,
      input.dealFills,
    ),
  );
  strategies.sort(
    (a, b) =>
      b.legs.reduce((s, l) => s + l.notionalUsd, 0) - a.legs.reduce((s, l) => s + l.notionalUsd, 0),
  );

  // --- Totals ------------------------------------------------------------------
  const capitalUsd = strategies.reduce((s, x) => s + x.capitalUsd, 0);
  const realizedPnlUsd = strategies.reduce((s, x) => s + x.realizedPnlUsd, 0);
  const expectedPnlToMaturityUsd = strategies.reduce(
    (s, x) => s + (x.expectedPnlToMaturityUsd ?? 0),
    0,
  );
  const feesTotalUsd = strategies.reduce((s, x) => s + x.feesUsd.paid.totalUsd, 0);
  const perpExitFeesTotalUsd = strategies.some((x) => x.feesUsd.future.perpExitFeesUsd === null)
    ? null
    : strategies.reduce((s, x) => s + (x.feesUsd.future.perpExitFeesUsd ?? 0), 0);
  const perpExitSlippageTotalUsd = strategies.some(
    (x) => x.feesUsd.future.perpExitSlippageUsd === null,
  )
    ? null
    : strategies.reduce((s, x) => s + (x.feesUsd.future.perpExitSlippageUsd ?? 0), 0);
  // Blend the annualization over capital-weighted elapsed time; null if any
  // strategy can't be annualized (a partial blend would mislead).
  let realizedApr: number | null = null;
  if (
    strategies.length > 0 &&
    capitalUsd > 0 &&
    strategies.every((s) => s.realizedApr !== null && s.capitalUsd > 0)
  ) {
    const weightedElapsed =
      strategies.reduce((s, x) => s + x.capitalUsd * (x.elapsedSeconds ?? 0), 0) / capitalUsd;
    if (weightedElapsed > 0) {
      realizedApr = (realizedPnlUsd / capitalUsd) * (SECONDS_IN_YEAR / weightedElapsed);
    }
  }

  return {
    address: input.address,
    perpSource: perpAvailable ? 'connected-gate-account' : null,
    strategies,
    totals: {
      capitalUsd,
      realizedPnlUsd,
      realizedApr,
      expectedPnlToMaturityUsd,
      feesTotalUsd,
      perpExitFeesTotalUsd,
      perpExitSlippageTotalUsd,
    },
    warnings: [...new Set(globalWarnings)],
  };
}
