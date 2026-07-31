/**
 * 4-leg strategy returns math (src/core/boros/returns.ts): sign conventions,
 * 18-dec + collateral-price scaling, the (venue, base) join, hedge states,
 * APR annualization/suppression, fee accounting, and the degraded modes.
 */
import { describe, expect, it } from 'vitest';
import type { BorosCollateralZone, BorosMarket, BorosTxn } from '../../src/core/boros/client';
import { resolveCollateralPricesUsd } from '../../src/core/boros/client';
import {
  buildStrategies,
  chainPerpEntrySlippageUsd,
  SECONDS_IN_YEAR,
  type BuildStrategiesInput,
  type DealFillRecord,
  type PerpPositionLike,
} from '../../src/core/boros/returns';
import { imInputs, raw } from '../helpers/boros-fixtures';

const NOW = 1_752_000_000;
const DAY = 86_400;
const OPENED = NOW - 12 * DAY;
const MATURITY = NOW + 15 * DAY;

const hlMarket: BorosMarket = {
  marketId: 155,
  tokenId: 3,
  name: 'Hyperliquid ETH 31 Jul 2026',
  venue: 'Hyperliquid',
  base: 'ETH',
  maturity: MATURITY,
  paymentPeriod: 3_600,
  settleFeeApr: 0.001,
  markApr: 0.076,
  floatingApr: 0.075,
  midApr: 0.076,
  notionalOi: 5_000_000,
  takerFeeRate: 0.0005,
  state: 'Normal',
  assetMarkPriceUsd: 1_880,
  ...imInputs,
};
const okxMarket: BorosMarket = {
  ...hlMarket,
  marketId: 158,
  name: 'OKX ETHUSDT 31 Jul 2026',
  venue: 'OKX',
  paymentPeriod: 28_800,
  markApr: 0.032,
  floatingApr: 0.031,
  midApr: 0.032,
};

/** Canonical 4-leg book (domain shape) — numbers documented in
 * tests/helpers/boros-fixtures.ts; keep the seams in lockstep. */
function ethZones(): BorosCollateralZone[] {
  return [
    {
      tokenId: 3,
      cross: {
        isCross: true,
        netBalance: raw(20_000),
        marketPositions: [
          {
            marketId: 155,
            side: 1,
            notionalSize: raw(-1_000_000),
            fixedApr: 0.08,
            markApr: 0.076,
            pnl: { rateSettlementPnl: raw(3_205), unrealisedPnl: raw(820) },
            positionInitialMargin: raw(5_000),
          },
          {
            marketId: 158,
            side: 0,
            notionalSize: raw(1_000_000),
            fixedApr: 0.03,
            markApr: 0.032,
            pnl: { rateSettlementPnl: raw(1_120), unrealisedPnl: raw(-300) },
            positionInitialMargin: raw(5_000),
          },
        ],
      },
      isolated: [],
    },
  ];
}

function ethTxns(): BorosTxn[] {
  return [
    { marketId: 155, time: OPENED, fee: raw(390), pnl: raw(-390), prevPositionS: '0', postPositionS: raw(-1_000_000) },
    { marketId: 158, time: OPENED, fee: raw(300), pnl: raw(-300), prevPositionS: '0', postPositionS: raw(1_000_000) },
  ];
}

/** Matching perp overlay: SHORT HL / LONG OKX, $1M each (Gate `fee` negative).
 * Entry gap: long 1883.4 − short 1883.0 = 0.4 × 531 = $212.40 entry slippage. */
const ENTRY_SLIPPAGE = (1883.4 - 1883.0) * 531;
function ethPerps(): PerpPositionLike[] {
  return [
    {
      symbol: 'HYPERLIQUID_FUTURE_ETH_USDC',
      positionSide: 'SHORT',
      positionQty: '-531',
      positionValue: '1000000',
      entryPrice: '1883.0',
      upnl: '50',
      fundingFee: '3120',
      fee: '-210',
      initialMargin: '12500',
      createTime: String(OPENED * 1000), // Gate reports ms
    },
    {
      symbol: 'OKX_FUTURE_ETH_USDT',
      positionSide: 'LONG',
      positionQty: '531',
      positionValue: '1000000',
      entryPrice: '1883.4',
      upnl: '-45',
      fundingFee: '-1940',
      fee: '-202',
      initialMargin: '12500',
      createTime: String(OPENED * 1000),
    },
  ];
}

function input(over: Partial<BuildStrategiesInput> = {}): BuildStrategiesInput {
  return {
    address: '0x' + 'ab'.repeat(20),
    zones: ethZones(),
    markets: [hlMarket, okxMarket],
    txnsByToken: new Map([[3, ethTxns()]]),
    pricesUsd: new Map([[3, 1]]),
    perpPositions: ethPerps(),
    nowSec: NOW,
    ...over,
  };
}

describe('buildStrategies — canonical 4-leg book', () => {
  it('computes per-leg nets, realized total, spread, and locked APR', () => {
    const out = buildStrategies(input());
    expect(out.strategies).toHaveLength(1);
    const s = out.strategies[0];
    expect(s.base).toBe('ETH');
    expect(s.maturity).toBe(MATURITY);
    expect(s.legs).toHaveLength(4);

    // Perp legs first (sorted by venue), then Boros legs.
    expect(s.legs.map((l) => `${l.kind}:${l.venue}`)).toEqual([
      'perp:HYPERLIQUID',
      'perp:OKX',
      'boros:HYPERLIQUID',
      'boros:OKX',
    ]);

    // Per-leg nets: perp = funding − |fee| (price MtM EXCLUDED — the pair's
    // uPnLs cancel to entry-gap noise, accounted once as entry slippage);
    // boros = settlement + mtm + tradePnl(net).
    const [perpHl, perpOkx, borosHl, borosOkx] = s.legs;
    expect(perpHl.netUsd).toBeCloseTo(3120 - 210, 6);
    expect(perpOkx.netUsd).toBeCloseTo(-1940 - 202, 6);
    expect(perpHl.mtmUsd).toBeCloseTo(50, 6); // display-only, not in net
    expect(borosHl.netUsd).toBeCloseTo(3205 + 820 - 390, 6);
    expect(borosOkx.netUsd).toBeCloseTo(1120 - 300 - 300, 6);
    // Realized = Σ leg nets − entry slippage (subtracted once, pair-level).
    expect(s.realizedPnlUsd).toBeCloseTo(2910 - 2142 + 3635 + 520 - ENTRY_SLIPPAGE, 6);

    // Boros leg carries entry → mark rates + the live floating APR.
    expect(borosHl.side).toBe('SHORT');
    expect(borosHl.entryApr).toBeCloseTo(0.08);
    expect(borosHl.floatingApr).toBeCloseTo(0.075);
    expect(borosOkx.side).toBe('LONG');

    // Locked: SHORT receives 8%, LONG pays 3% on $1M each → $50k/yr fixed.
    // spread = 50_000 / (2M/2) = 5%; capital = perp IM 25k + boros balance 20k.
    expect(s.spread).toBeCloseTo(0.05, 10);
    expect(s.capitalUsd).toBeCloseTo(45_000, 6);
    expect(s.lockedAprOnCapital).toBeCloseTo(50_000 / 45_000, 10);

    // Realized APR annualizes over the 12d since the earliest open.
    const elapsed = 12 * DAY;
    expect(s.elapsedSeconds).toBe(elapsed);
    expect(s.realizedApr).toBeCloseTo((s.realizedPnlUsd / 45_000) * (SECONDS_IN_YEAR / elapsed), 10);

    // Both venues cancel exactly → hedged, no mismatch.
    expect(s.hedge).toBe('hedged');
    expect(s.notionalMismatchUsd).toBeCloseTo(0, 6);
    expect(out.perpSource).toBe('connected-gate-account');
  });

  it('accounts fees: paid (exact perp + slippage + Boros trade + settle accrual) vs future', () => {
    const s = buildStrategies(input()).strategies[0];
    expect(s.feesUsd.paid.perpTradingUsd).toBeCloseTo(412, 6);
    // Entry crossing cost: (long entry − short entry) × matched qty.
    expect(s.feesUsd.paid.perpEntrySlippageUsd).toBeCloseTo(ENTRY_SLIPPAGE, 6);
    expect(s.feesUsd.paid.borosTradeUsd).toBeCloseTo(690, 6);
    // 2 legs × $1M × 0.1% APR × 12d/365d — display-only accrual estimate.
    const paidSettle = 2 * 1_000_000 * 0.001 * ((12 * DAY) / SECONDS_IN_YEAR);
    expect(s.feesUsd.paid.borosSettlementUsd).toBeCloseTo(paidSettle, 6);
    expect(s.feesUsd.paid.totalUsd).toBeCloseTo(412 + ENTRY_SLIPPAGE + 690 + paidSettle, 6);
    // Future: settle runs to maturity; exit slippage mirrors entry; exit fees
    // need a fee schedule (none supplied here) → null, and the total propagates.
    const futureSettle = 2 * 1_000_000 * 0.001 * ((15 * DAY) / SECONDS_IN_YEAR);
    expect(s.feesUsd.future.borosSettlementUsd).toBeCloseTo(futureSettle, 6);
    expect(s.feesUsd.future.perpExitSlippageUsd).toBeCloseTo(ENTRY_SLIPPAGE, 6);
    expect(s.feesUsd.future.perpExitFeesUsd).toBeNull();
    expect(s.feesUsd.future.totalUsd).toBeNull();
  });

  it('projects to maturity: spread return (full life) − paid costs − future settle fees', () => {
    const s = buildStrategies(input()).strategies[0];
    // Clock starts at the Boros open → the spread accrues over the FULL life.
    const lifeYears = (27 * DAY) / SECONDS_IN_YEAR; // 12d elapsed + 15d remaining
    const spreadReturn = (0.08 - 0.03) * 1_000_000 * lifeYears;
    expect(s.clockStartSec).toBe(OPENED);
    expect(s.spreadReturnUsd).toBeCloseTo(spreadReturn, 6);
    const futureSettle = 2 * 1_000_000 * 0.001 * ((15 * DAY) / SECONDS_IN_YEAR);
    expect(s.expectedPnlToMaturityUsd).toBeCloseTo(
      spreadReturn - s.feesUsd.paid.totalUsd - futureSettle,
      6,
    );
    expect(s.secondsToMaturity).toBe(15 * DAY);
  });
});

describe('buildStrategies — scaling', () => {
  it('converts token-margined zones to USD via the collateral price', () => {
    const btcMarket: BorosMarket = {
      ...hlMarket,
      marketId: 157,
      name: 'Hyperliquid BTC 31 Jul 2026',
      tokenId: 1,
      base: 'BTC',
      notionalOi: 40, // BTC-collateral units, not USD
      assetMarkPriceUsd: 118_000,
    };
    const zones: BorosCollateralZone[] = [
      {
        tokenId: 1,
        cross: {
          isCross: true,
          netBalance: raw(0.5),
          marketPositions: [
            {
              marketId: 157,
              side: 0,
              notionalSize: raw(40),
              fixedApr: 0.037,
              markApr: 0.08,
              pnl: { rateSettlementPnl: raw(0.12), unrealisedPnl: raw(0.067) },
              positionInitialMargin: raw(0.06),
            },
          ],
        },
        isolated: [],
      },
    ];
    const out = buildStrategies(
      input({
        zones,
        markets: [btcMarket],
        txnsByToken: new Map(),
        pricesUsd: resolveCollateralPricesUsd([btcMarket]),
        perpPositions: [],
      }),
    );
    const leg = out.strategies[0].legs[0];
    expect(leg.notionalUsd).toBeCloseTo(40 * 118_000, 3);
    expect(leg.cashFlowUsd).toBeCloseTo(0.12 * 118_000, 3);
    expect(leg.mtmUsd).toBeCloseTo(0.067 * 118_000, 3);
    expect(out.strategies[0].capitalUsd).toBeCloseTo(0.5 * 118_000, 3);
  });

  it('excludes zones whose collateral token has no USD reference, with a warning', () => {
    const zones = ethZones();
    zones[0].tokenId = 4; // BNB — no BNB market in the fixture set
    const out = buildStrategies(input({ zones, pricesUsd: new Map([[4, null]]) }));
    expect(out.strategies).toHaveLength(0);
    expect(out.warnings.join(' ')).toMatch(/BNB collateral zone/);
  });
});

describe('buildStrategies — hedge states & degraded modes', () => {
  it('Boros-only (Gate unconfigured): partial hedge, locked spread still computed', () => {
    const out = buildStrategies(input({ perpPositions: null }));
    expect(out.perpSource).toBeNull();
    expect(out.warnings.join(' ')).toMatch(/Gate credentials are not configured/);
    const s = out.strategies[0];
    expect(s.hedge).toBe('partial');
    expect(s.spread).toBeCloseTo(0.05, 10);
    expect(s.legs).toHaveLength(2);
    // Capital is the Boros balance only.
    expect(s.capitalUsd).toBeCloseTo(20_000, 6);
  });

  it('Gate connected but no matching perps: unhedged, with a plain-language warning', () => {
    const out = buildStrategies(input({ perpPositions: [] }));
    const s = out.strategies[0];
    expect(s.hedge).toBe('unhedged');
    expect(s.warnings.join(' ')).toMatch(/No matching perp legs for ETH/);
  });

  it('perp legs whose base has no Boros cohort are ignored (not a 4-leg strategy)', () => {
    const stray: PerpPositionLike = {
      symbol: 'BINANCE_FUTURE_SOL_USDT',
      positionSide: 'LONG',
      positionQty: '10',
      positionValue: '2000',
      upnl: '1',
      fundingFee: '2',
      fee: '-1',
      initialMargin: '400',
    };
    const out = buildStrategies(input({ perpPositions: [...ethPerps(), stray] }));
    expect(out.strategies).toHaveLength(1);
    expect(out.strategies[0].legs.filter((l) => l.base === 'SOL')).toHaveLength(0);
  });

  it('flags a notional mismatch beyond the 2% band as a partial hedge', () => {
    const perps = ethPerps();
    perps[0].positionValue = '600000'; // HL perp only covers 60% of the Boros leg
    const out = buildStrategies(input({ perpPositions: perps }));
    const s = out.strategies[0];
    expect(s.hedge).toBe('partial');
    expect(s.notionalMismatchUsd).toBeCloseTo(400_000, 6);
    expect(s.warnings.join(' ')).toMatch(/HYPERLIQUID legs are imbalanced/);
  });

  it('a Boros leg with no perp on its venue warns venue-specifically', () => {
    const out = buildStrategies(input({ perpPositions: [ethPerps()[0]] })); // HL perp only
    const s = out.strategies[0];
    expect(s.hedge).toBe('partial');
    expect(s.warnings.join(' ')).toMatch(/No OKX perp found for ETH/);
  });
});

describe('buildStrategies — time & APR edge cases', () => {
  it('suppresses realized APR before one full settlement period', () => {
    const zones = ethZones();
    const txns = ethTxns().map((t) => ({ ...t, time: NOW - 1_800 })); // opened 30min ago
    const perps = ethPerps().map((p) => ({ ...p, createTime: String((NOW - 1_800) * 1000) }));
    // OKX pays every 8h → elapsed 30min < 28_800s.
    const out = buildStrategies(input({ zones, txnsByToken: new Map([[3, txns]]), perpPositions: perps }));
    expect(out.strategies[0].realizedApr).toBeNull();
    expect(out.totals.realizedApr).toBeNull();
  });

  it('handles matured cohorts: spread stops at maturity, zero future settle fees', () => {
    const past = NOW - DAY;
    const markets = [
      { ...hlMarket, maturity: past },
      { ...okxMarket, maturity: past },
    ];
    const out = buildStrategies(input({ markets }));
    const s = out.strategies[0];
    expect(s.secondsToMaturity).toBe(0);
    // Spread accrued only over the 11d the position lived (open → maturity).
    const lifeYears = (11 * DAY) / SECONDS_IN_YEAR;
    expect(s.spreadReturnUsd).toBeCloseTo((0.08 - 0.03) * 1_000_000 * lifeYears, 6);
    expect(s.feesUsd.future.borosSettlementUsd).toBe(0);
    // Paid settle accrual is also capped at maturity.
    expect(s.feesUsd.paid.borosSettlementUsd).toBeCloseTo(2 * 1_000_000 * 0.001 * lifeYears, 6);
    expect(s.expectedPnlToMaturityUsd).toBeCloseTo(
      s.spreadReturnUsd! - s.feesUsd.paid.totalUsd,
      6,
    );
  });

  it('measures fees/open-time from the LATEST open-from-flat event only', () => {
    const txns: BorosTxn[] = [
      // A previous round-trip whose fees must NOT count.
      { marketId: 155, time: OPENED - 30 * DAY, fee: raw(999), pnl: raw(-999), prevPositionS: '0', postPositionS: raw(-500_000) },
      { marketId: 155, time: OPENED - 20 * DAY, fee: raw(999), pnl: raw(1_500), prevPositionS: raw(-500_000), postPositionS: '0' },
      ...ethTxns(),
    ];
    const s = buildStrategies(input({ txnsByToken: new Map([[3, txns]]) })).strategies[0];
    expect(s.feesUsd.paid.borosTradeUsd).toBeCloseTo(690, 6);
    expect(s.elapsedSeconds).toBe(12 * DAY);
  });

  it('missing txn history: warns, keeps computing, and leans on perp open times', () => {
    const out = buildStrategies(input({ txnsByToken: new Map() }));
    const s = out.strategies[0];
    expect(s.warnings.join(' ')).toMatch(/No trade history found/);
    expect(s.feesUsd.paid.borosTradeUsd).toBe(0);
    // Perp createTime still anchors the annualization window.
    expect(s.elapsedSeconds).toBe(12 * DAY);
    expect(s.realizedApr).not.toBeNull();
  });

  it('a market missing from /markets degrades with a warning, never crashes', () => {
    const out = buildStrategies(input({ markets: [okxMarket] })); // HL market absent
    const s = out.strategies.find((x) => x.legs.some((l) => l.warnings.length));
    expect(out.strategies.length).toBeGreaterThan(0);
    expect(s ?? out.strategies[0]).toBeTruthy();
    const all = out.strategies.flatMap((x) => x.warnings).join(' ');
    expect(all).toMatch(/missing from \/markets/);
  });
});

describe('buildStrategies — margin groups & capital', () => {
  it('includes ISOLATED margin groups (positions + their own capital)', () => {
    const zones: BorosCollateralZone[] = [
      {
        tokenId: 3,
        cross: { isCross: true, netBalance: raw(20_000), marketPositions: [ethZones()[0].cross!.marketPositions[0]] },
        isolated: [
          {
            isCross: false,
            netBalance: raw(7_000),
            marketPositions: [ethZones()[0].cross!.marketPositions[1]],
          },
        ],
      },
    ];
    const out = buildStrategies(input({ zones }));
    const s = out.strategies[0];
    // Both legs present (one from cross, one from the isolated group)…
    expect(s.legs.filter((l) => l.kind === 'boros')).toHaveLength(2);
    // …and capital = perp IM 25k + cross balance 20k + isolated balance 7k.
    expect(s.capitalUsd).toBeCloseTo(25_000 + 20_000 + 7_000, 6);
  });

  it('apportions a shared margin group across cohorts by IM share (never double-counts)', () => {
    const laterMaturity = MATURITY + 56 * DAY;
    const hlSep: BorosMarket = { ...hlMarket, marketId: 169, maturity: laterMaturity };
    const zones = ethZones();
    // Same cross group backs a second cohort with 3x the IM of each first-cohort leg.
    zones[0].cross!.marketPositions.push({
      marketId: 169,
      side: 1,
      notionalSize: raw(-3_000_000),
      fixedApr: 0.06,
      markApr: 0.058,
      pnl: { rateSettlementPnl: raw(0), unrealisedPnl: raw(0) },
      positionInitialMargin: raw(30_000),
    });
    const out = buildStrategies(
      input({ zones, markets: [hlMarket, okxMarket, hlSep], perpPositions: [] }),
    );
    // Group IM = 5k + 5k + 30k; balance 20k splits 25%/75% across the cohorts.
    const first = out.strategies.find((s) => s.maturity === MATURITY)!;
    const second = out.strategies.find((s) => s.maturity === laterMaturity)!;
    expect(first.capitalUsd).toBeCloseTo(20_000 * (10_000 / 40_000), 6);
    expect(second.capitalUsd).toBeCloseTo(20_000 * (30_000 / 40_000), 6);
    expect(first.capitalUsd + second.capitalUsd).toBeCloseTo(20_000, 6);
  });
});

describe('buildStrategies — perp field robustness', () => {
  it('derives perp side from the qty sign when positionSide is missing', () => {
    const perps = ethPerps().map(({ positionSide, ...rest }) => rest as PerpPositionLike);
    // HL leg has qty '-531' → SHORT; OKX '531' → LONG — hedge stays intact.
    const out = buildStrategies(input({ perpPositions: perps }));
    const s = out.strategies[0];
    const perpLegs = s.legs.filter((l) => l.kind === 'perp');
    expect(perpLegs.find((l) => l.venue === 'HYPERLIQUID')?.side).toBe('SHORT');
    expect(perpLegs.find((l) => l.venue === 'OKX')?.side).toBe('LONG');
    expect(s.hedge).toBe('hedged');
  });

  it('accepts Gate createTime in SECONDS as well as milliseconds', () => {
    const perps = ethPerps().map((p) => ({ ...p, createTime: String(OPENED) })); // seconds
    const out = buildStrategies(input({ txnsByToken: new Map(), perpPositions: perps }));
    // Annualization window anchors on the perp opens (Boros open unknown here).
    expect(out.strategies[0].elapsedSeconds).toBe(12 * DAY);
  });

  it('reports a transient perp failure with the caller-supplied warning, not "not configured"', () => {
    const out = buildStrategies(
      input({
        perpPositions: null,
        perpsUnavailableWarning: "Couldn't load Gate positions right now (rate-limited) — retrying.",
      }),
    );
    expect(out.warnings.join(' ')).toMatch(/rate-limited/);
    expect(out.warnings.join(' ')).not.toMatch(/credentials are not configured/);
    expect(out.strategies[0].hedge).toBe('partial');
  });
});

describe('buildStrategies — perp funding re-based to the strategy clock', () => {
  /** Perps opened 10d BEFORE the Boros lock (a pre-existing arb, later locked). */
  const olderPerps = () =>
    ethPerps().map((p, i) => ({
      ...p,
      positionId: `pos-${i}`,
      createTime: String((OPENED - 10 * DAY) * 1000),
    }));

  it('re-sums funding from the account-book ledger when a position predates the clock', () => {
    // Ledger: pos-0 received 100/day; only the 12 days SINCE the Boros open count.
    const entries = (positionId: string, perDay: number) =>
      Array.from({ length: 22 }, (_, d) => ({
        positionId,
        timeSec: OPENED - 10 * DAY + d * DAY + 60,
        changeUsd: perDay,
      }));
    const out = buildStrategies(
      input({
        perpPositions: olderPerps(),
        perpFunding: {
          coversFromSec: 0,
          byPosition: new Map([
            ['pos-0', entries('pos-0', 100)],
            ['pos-1', entries('pos-1', -50)],
          ]),
        },
      }),
    );
    const s = out.strategies[0];
    const hl = s.legs.find((l) => l.kind === 'perp' && l.venue === 'HYPERLIQUID')!;
    const okx = s.legs.find((l) => l.kind === 'perp' && l.venue === 'OKX')!;
    // 12 daily settlements fall inside [clockStart, now): d = 10..21.
    expect(hl.cashFlowUsd).toBeCloseTo(12 * 100, 6);
    expect(okx.cashFlowUsd).toBeCloseTo(12 * -50, 6);
    expect(hl.netUsd).toBeCloseTo(1200 - 210, 6);
    expect(s.warnings.join(' ')).not.toMatch(/pre-lock accrual/);
  });

  it('keeps the cumulative counter (with a warning) when the ledger cannot cover the window', () => {
    const out = buildStrategies(
      input({
        perpPositions: olderPerps(),
        // Ledger only covers from AFTER the clock start — insufficient.
        perpFunding: { coversFromSec: OPENED + DAY, byPosition: new Map() },
      }),
    );
    const s = out.strategies[0];
    const hl = s.legs.find((l) => l.kind === 'perp' && l.venue === 'HYPERLIQUID')!;
    expect(hl.cashFlowUsd).toBeCloseTo(3120, 6); // unchanged since-open counter
    expect(s.warnings.join(' ')).toMatch(/pre-lock accrual/);
  });

  it('trusts an empty ledger within 8h of the lock — a young strategy has no settlements yet', () => {
    // Perp opened shortly before the Boros legs, strategy locked 4h ago: no
    // funding boundary has passed since the lock (venues settle at up to 8h
    // intervals), so zero ledger rows IS the truth. Funding since start is a
    // genuine $0 — re-based silently, no confusing "returned no rows" notice.
    const out = buildStrategies(
      input({
        nowSec: OPENED + 4 * 3600,
        perpPositions: olderPerps(),
        perpFunding: { coversFromSec: 0, byPosition: new Map() },
      }),
    );
    const s = out.strategies[0];
    const hl = s.legs.find((l) => l.kind === 'perp' && l.venue === 'HYPERLIQUID')!;
    expect(hl.cashFlowUsd).toBe(0); // re-based: nothing settled since the lock
    expect(hl.netUsd).toBe(-hl.feesUsd);
    expect(s.warnings.join(' ')).not.toMatch(/returned no rows/);
  });

  it('past the 8h grace an empty ledger is suspicious again — counter kept, warning shown', () => {
    const out = buildStrategies(
      input({
        nowSec: OPENED + 8 * 3600 + 60,
        perpPositions: olderPerps(),
        perpFunding: { coversFromSec: 0, byPosition: new Map() },
      }),
    );
    const s = out.strategies[0];
    const hl = s.legs.find((l) => l.kind === 'perp' && l.venue === 'HYPERLIQUID')!;
    expect(hl.cashFlowUsd).toBeCloseTo(3120, 6); // counter kept, NOT zeroed
    expect(s.warnings.join(' ')).toMatch(/returned no rows/);
  });

  it('keeps the counter (with a warning) when the ledger covers the window but has no rows for the position', () => {
    // The regression: coversFromSec 0 means "uncapped fetch", which is ALSO what
    // an empty/unusable ledger response produces. Summing `?? []` here yielded 0
    // and confidently overwrote the venue's cumulative funding with $0 — the
    // largest P&L component of a funding-rate arb — while the else-branch warning
    // could never fire, so the number looked earned rather than missing.
    const out = buildStrategies(
      input({
        perpPositions: olderPerps(),
        perpFunding: { coversFromSec: 0, byPosition: new Map() },
      }),
    );
    const s = out.strategies[0];
    const hl = s.legs.find((l) => l.kind === 'perp' && l.venue === 'HYPERLIQUID')!;
    expect(hl.cashFlowUsd).toBeCloseTo(3120, 6); // counter kept, NOT zeroed
    expect(s.warnings.join(' ')).toMatch(/returned no rows/);
  });

  it('re-bases only the positions the ledger actually carries', () => {
    // pos-0 is present, pos-1 is missing: one leg re-bases, the other keeps its
    // counter and says so. A blanket `?? []` would silently zero pos-1.
    const out = buildStrategies(
      input({
        perpPositions: olderPerps(),
        perpFunding: {
          coversFromSec: 0,
          byPosition: new Map([
            [
              'pos-0',
              Array.from({ length: 22 }, (_, d) => ({
                positionId: 'pos-0',
                timeSec: OPENED - 10 * DAY + d * DAY + 60,
                changeUsd: 100,
              })),
            ],
          ]),
        },
      }),
    );
    const s = out.strategies[0];
    const hl = s.legs.find((l) => l.kind === 'perp' && l.venue === 'HYPERLIQUID')!;
    const okx = s.legs.find((l) => l.kind === 'perp' && l.venue === 'OKX')!;
    expect(hl.cashFlowUsd).toBeCloseTo(12 * 100, 6); // re-based from the ledger
    expect(okx.cashFlowUsd).not.toBeCloseTo(0, 6); // counter kept, not zeroed
    expect(s.warnings.join(' ')).toMatch(/returned no rows/);
  });

  it('leaves positions opened at/after the clock alone (counter already equals since-start)', () => {
    const out = buildStrategies(
      input({
        perpPositions: ethPerps().map((p, i) => ({ ...p, positionId: `pos-${i}` })),
        perpFunding: { coversFromSec: 0, byPosition: new Map() }, // empty ledger — must not matter
      }),
    );
    const hl = out.strategies[0].legs.find((l) => l.kind === 'perp' && l.venue === 'HYPERLIQUID')!;
    expect(hl.cashFlowUsd).toBeCloseTo(3120, 6);
    expect(out.strategies[0].warnings.join(' ')).not.toMatch(/pre-lock accrual/);
  });
});

describe('buildStrategies — APR clock basis', () => {
  it('defaults the clock to the earliest BOROS open even when the perps are older', () => {
    // Perp pair has existed 10 days longer than the Boros legs.
    const perps = ethPerps().map((p) => ({ ...p, createTime: String((OPENED - 10 * DAY) * 1000) }));
    const s = buildStrategies(input({ perpPositions: perps })).strategies[0];
    expect(s.clockBasis).toBe('boros-open');
    expect(s.clockStartSec).toBe(OPENED);
    expect(s.elapsedSeconds).toBe(12 * DAY); // NOT 22d — the spread lock starts the clock
    expect(s.realizedApr).toBeCloseTo(
      (s.realizedPnlUsd / s.capitalUsd) * (SECONDS_IN_YEAR / (12 * DAY)),
      10,
    );
  });

  it('falls back to the perp open (with a warning) when the Boros open time is unknown', () => {
    const s = buildStrategies(input({ txnsByToken: new Map() })).strategies[0];
    expect(s.clockBasis).toBe('perp-open');
    expect(s.elapsedSeconds).toBe(12 * DAY);
    expect(s.warnings.join(' ')).toMatch(/APR clock falls back to the earliest perp open/);
  });

  it('a custom override wins over both and re-annualizes accordingly', () => {
    const s = buildStrategies(input({ clockStartOverrideSec: NOW - 6 * DAY })).strategies[0];
    expect(s.clockBasis).toBe('custom');
    expect(s.clockStartSec).toBe(NOW - 6 * DAY);
    // The spread-return window follows the same clock: 6d elapsed + 15d left.
    expect(s.spreadReturnUsd).toBeCloseTo(
      (0.08 - 0.03) * 1_000_000 * ((21 * DAY) / SECONDS_IN_YEAR),
      6,
    );
    expect(s.elapsedSeconds).toBe(6 * DAY);
    expect(s.realizedApr).toBeCloseTo(
      (s.realizedPnlUsd / s.capitalUsd) * (SECONDS_IN_YEAR / (6 * DAY)),
      10,
    );
  });

  it('the suppression rule applies to the override window too', () => {
    // 30-minute custom window < OKX's 8h settlement period → APR suppressed.
    const s = buildStrategies(input({ clockStartOverrideSec: NOW - 1_800 })).strategies[0];
    expect(s.realizedApr).toBeNull();
  });
});

describe('buildStrategies — perp exit cost (maker+hedge)', () => {
  const feeRows = [
    { exchangeType: 'HYPERLIQUID', futureMakerFee: '0.0002', futureTakerFee: '0.00048' },
    { exchangeType: 'OKX', futureMakerFee: '0.0002', futureTakerFee: '0.00048' },
  ];

  it('prices the pair exit as maker on one leg + taker on the other', () => {
    const s = buildStrategies(input({ venueFees: feeRows })).strategies[0];
    // Symmetric rates: either assignment costs $1M × (2 + 4.8) bps.
    expect(s.feesUsd.future.perpExitFeesUsd).toBeCloseTo(
      1_000_000 * 0.0002 + 1_000_000 * 0.00048,
      6,
    );
    // Exit slippage mirrors the entry crossing cost, so the future total closes.
    expect(s.feesUsd.future.perpExitSlippageUsd).toBeCloseTo(ENTRY_SLIPPAGE, 6);
    const futureSettle = 2 * 1_000_000 * 0.001 * ((15 * DAY) / SECONDS_IN_YEAR);
    expect(s.feesUsd.future.totalUsd).toBeCloseTo(
      s.feesUsd.future.perpExitFeesUsd! + ENTRY_SLIPPAGE + futureSettle,
      6,
    );
  });

  it('picks the CHEAPER maker assignment when venue rates differ', () => {
    const rows = [
      {
        exchangeType: 'HYPERLIQUID',
        futureMakerFee: '0.0002',
        futureTakerFee: '0.00048',
        specialFeeList: [
          { symbol: 'HYPERLIQUID_FUTURE_ETH_USDC', makerFeeRate: '0', takerFeeRate: '0.0002' },
        ],
      },
      { exchangeType: 'OKX', futureMakerFee: '0.0002', futureTakerFee: '0.00048' },
    ];
    const s = buildStrategies(input({ venueFees: rows })).strategies[0];
    // HL maker + OKX taker = 0 + 480; HL taker + OKX maker = 200 + 200 → $400.
    expect(s.feesUsd.future.perpExitFeesUsd).toBeCloseTo(400, 6);
  });

  it('falls back to taker-per-leg when the strategy is not a 2-leg pair', () => {
    const s = buildStrategies(
      input({ perpPositions: [ethPerps()[0]], venueFees: feeRows }),
    ).strategies[0];
    expect(s.feesUsd.future.perpExitFeesUsd).toBeCloseTo(1_000_000 * 0.00048, 6);
  });

  it('reports null (never a guess) when perps exist but the schedule is unknown', () => {
    const out = buildStrategies(input()); // no venueFees supplied
    const s = out.strategies[0];
    expect(s.feesUsd.future.perpExitFeesUsd).toBeNull();
    expect(out.totals.perpExitFeesTotalUsd).toBeNull();
    // Slippage doesn't need the schedule — it stays known.
    expect(out.totals.perpExitSlippageTotalUsd).toBeCloseTo(ENTRY_SLIPPAGE, 6);
  });

  it('is zero fees AND zero slippage for a Boros-only strategy (nothing to exit on Gate)', () => {
    // Structurally 0, never null: a null would poison the account totals for
    // every other strategy whose slippage IS known.
    const out = buildStrategies(input({ perpPositions: [], venueFees: feeRows }));
    expect(out.strategies[0].feesUsd.future.perpExitFeesUsd).toBe(0);
    expect(out.strategies[0].feesUsd.future.perpExitSlippageUsd).toBe(0);
    expect(out.strategies[0].feesUsd.paid.perpEntrySlippageUsd).toBe(0);
    expect(out.strategies[0].feesUsd.future.totalUsd).not.toBeNull();
    expect(out.totals.perpExitFeesTotalUsd).toBe(0);
    expect(out.totals.perpExitSlippageTotalUsd).toBe(0);
  });
});

describe('buildStrategies — entry slippage', () => {
  it('is signed: a favorable entry gap becomes a negative (gain) cost', () => {
    const perps = ethPerps();
    perps[1].entryPrice = '1882.5'; // long entered BELOW the short → favorable
    const s = buildStrategies(input({ perpPositions: perps })).strategies[0];
    expect(s.feesUsd.paid.perpEntrySlippageUsd).toBeCloseTo((1882.5 - 1883.0) * 531, 6);
  });

  it('is null with a warning when an entry price is missing', () => {
    const perps = ethPerps();
    delete perps[0].entryPrice;
    const s = buildStrategies(input({ perpPositions: perps })).strategies[0];
    expect(s.feesUsd.paid.perpEntrySlippageUsd).toBeNull();
    expect(s.feesUsd.future.perpExitSlippageUsd).toBeNull();
    expect(s.warnings.join(' ')).toMatch(/Entry slippage for ETH is unknown/);
    // A null slippage counts as 0 in the paid total (never a guess).
    const paidSettle = 2 * 1_000_000 * 0.001 * ((12 * DAY) / SECONDS_IN_YEAR);
    expect(s.feesUsd.paid.totalUsd).toBeCloseTo(412 + 690 + paidSettle, 6);
  });

  it('is null with a warning when the perp side is not a simple 1-long/1-short pair', () => {
    const s = buildStrategies(input({ perpPositions: [ethPerps()[0]] })).strategies[0];
    expect(s.feesUsd.paid.perpEntrySlippageUsd).toBeNull();
    expect(s.warnings.join(' ')).toMatch(/Entry slippage for ETH is unknown/);
  });

  it('uses the matched (smaller) qty when the legs are unevenly sized', () => {
    const perps = ethPerps();
    perps[1].positionQty = '400';
    const s = buildStrategies(input({ perpPositions: perps })).strategies[0];
    expect(s.feesUsd.paid.perpEntrySlippageUsd).toBeCloseTo((1883.4 - 1883.0) * 400, 6);
  });
});

describe('buildStrategies — migrated perp pair (entry slippage chaining)', () => {
  /** The HL short's ORIGINAL entry, 10 days before the OKX long existed. The
   * live entry gap (1883.4 − 1900.0) × 531 = −$8,814.60 is almost entirely
   * market drift over those 10 days — the number the fix must never show. */
  const H0 = 1900.0;
  const PHANTOM = (1883.4 - H0) * 531;
  function migratedPerps(): PerpPositionLike[] {
    const perps = ethPerps();
    perps[0].entryPrice = String(H0);
    perps[0].createTime = String((OPENED - 10 * DAY) * 1000);
    return perps;
  }
  /** The chain that actually built the book: Short HL / Long GATE at t−10d,
   * then the migration Short GATE (reduce) / Long OKX at t. Each deal's own
   * contemporaneous gap is $212.40; the drift lives between deals. */
  function migrationDeals(): DealFillRecord[] {
    return [
      {
        aContract: 'HYPERLIQUID_FUTURE_ETH_USDC',
        aSide: 'SELL',
        bContract: 'GATE_FUTURE_ETH_USDT',
        bSide: 'BUY',
        aFilled: 531,
        bFilled: 531,
        aAvgFill: 1900.0,
        bAvgFill: 1900.4,
        createdAtSec: OPENED - 10 * DAY,
      },
      {
        aContract: 'GATE_FUTURE_ETH_USDT',
        aSide: 'SELL',
        bContract: 'OKX_FUTURE_ETH_USDT',
        bSide: 'BUY',
        aFilled: 531,
        bFilled: 531,
        aAvgFill: 1883.0,
        bAvgFill: 1883.4,
        createdAtSec: OPENED,
      },
    ];
  }
  const CHAINED = 2 * ENTRY_SLIPPAGE; // $212.40 + $212.40

  it('refuses the live entry gap without the journal: null + warning, exit null too', () => {
    const s = buildStrategies(input({ perpPositions: migratedPerps() })).strategies[0];
    expect(s.feesUsd.paid.perpEntrySlippageUsd).toBeNull();
    expect(s.feesUsd.future.perpExitSlippageUsd).toBeNull();
    expect(s.warnings.join(' ')).toMatch(/opened at different times.*market drift/);
    // Null counts as 0 in the paid total — excluded, never guessed.
    const paidSettle = 2 * 1_000_000 * 0.001 * ((12 * DAY) / SECONDS_IN_YEAR);
    expect(s.feesUsd.paid.totalUsd).toBeCloseTo(412 + 690 + paidSettle, 6);
  });

  it('sums the journal chain: both deals’ gaps, never the drift-sized live gap', () => {
    const s = buildStrategies(
      input({ perpPositions: migratedPerps(), dealFills: migrationDeals() }),
    ).strategies[0];
    expect(s.feesUsd.paid.perpEntrySlippageUsd).toBeCloseTo(CHAINED, 6);
    expect(s.feesUsd.paid.perpEntrySlippageUsd).not.toBeCloseTo(PHANTOM, 0);
    expect(s.feesUsd.future.perpExitSlippageUsd).toBeCloseTo(CHAINED, 6); // exit mirrors the chain
    expect(s.warnings.join(' ')).toMatch(/summed from 2 deals in this terminal's journal/);
    const paidSettle = 2 * 1_000_000 * 0.001 * ((12 * DAY) / SECONDS_IN_YEAR);
    expect(s.feesUsd.paid.totalUsd).toBeCloseTo(412 + CHAINED + 690 + paidSettle, 6);
  });

  it.each([
    { deltaSec: 15 * 60, viaLiveEntries: true }, // at the sync limit — contemporaneous
    { deltaSec: 15 * 60 + 1, viaLiveEntries: false }, // one second past — not attributable
  ])('open-time gap of $deltaSec s → live entries: $viaLiveEntries', ({ deltaSec, viaLiveEntries }) => {
    const perps = ethPerps(); // entries 1883.0/1883.4 — real gap, no drift
    perps[0].createTime = String((OPENED - deltaSec) * 1000);
    const s = buildStrategies(input({ perpPositions: perps })).strategies[0];
    if (viaLiveEntries) expect(s.feesUsd.paid.perpEntrySlippageUsd).toBeCloseTo(ENTRY_SLIPPAGE, 6);
    else expect(s.feesUsd.paid.perpEntrySlippageUsd).toBeNull();
  });

  it('treats a missing open time as not-contemporaneous, with its own warning', () => {
    const perps = ethPerps();
    delete perps[0].createTime;
    const s = buildStrategies(input({ perpPositions: perps })).strategies[0];
    expect(s.feesUsd.paid.perpEntrySlippageUsd).toBeNull();
    expect(s.warnings.join(' ')).toMatch(/open time is unknown/);
  });

  it('a same-time book keeps the live formula even when the journal is present', () => {
    const s = buildStrategies(
      input({ perpPositions: ethPerps(), dealFills: migrationDeals() }),
    ).strategies[0];
    // Precedence pin: positions API stays the source of truth for synced books.
    expect(s.feesUsd.paid.perpEntrySlippageUsd).toBeCloseTo(ENTRY_SLIPPAGE, 6);
    expect(s.warnings.join(' ')).not.toMatch(/journal/);
  });

  it('chains a DCA top-up as a third gap', () => {
    const perps = migratedPerps();
    perps[0].positionQty = '-581';
    perps[1].positionQty = '581';
    const deals = [
      ...migrationDeals(),
      {
        aContract: 'HYPERLIQUID_FUTURE_ETH_USDC',
        aSide: 'SELL' as const,
        bContract: 'OKX_FUTURE_ETH_USDT',
        bSide: 'BUY' as const,
        aFilled: 50,
        bFilled: 50,
        aAvgFill: 1901.0,
        bAvgFill: 1901.2,
        createdAtSec: OPENED + 3600,
      },
    ];
    const s = buildStrategies(input({ perpPositions: perps, dealFills: deals })).strategies[0];
    expect(s.feesUsd.paid.perpEntrySlippageUsd).toBeCloseTo(CHAINED + (1901.2 - 1901.0) * 50, 6);
    expect(s.warnings.join(' ')).toMatch(/summed from 3 deals/);
  });

  it('falls back to null when the chain does not reconcile with the live book', () => {
    const perps = migratedPerps();
    perps[0].positionQty = '-400'; // 131 contracts were closed off-journal
    perps[1].positionQty = '400';
    const s = buildStrategies(
      input({ perpPositions: perps, dealFills: migrationDeals() }),
    ).strategies[0];
    expect(s.feesUsd.paid.perpEntrySlippageUsd).toBeNull();
    expect(s.warnings.join(' ')).toMatch(/journal cannot reconstruct/);
  });
});

describe('chainPerpEntrySlippageUsd (reducer)', () => {
  const PAIR = {
    base: 'ETH',
    longSymbol: 'OKX_FUTURE_ETH_USDT',
    longQty: 531,
    shortSymbol: 'HYPERLIQUID_FUTURE_ETH_USDC',
    shortQty: 531,
    earliestOpenSec: OPENED - 10 * DAY,
  };
  const deal = (over: Partial<DealFillRecord> = {}): DealFillRecord => ({
    aContract: 'HYPERLIQUID_FUTURE_ETH_USDC',
    aSide: 'SELL',
    bContract: 'OKX_FUTURE_ETH_USDT',
    bSide: 'BUY',
    aFilled: 531,
    bFilled: 531,
    aAvgFill: 1883.0,
    bAvgFill: 1883.4,
    createdAtSec: OPENED,
    ...over,
  });

  it('returns null on no matching deals', () => {
    expect(chainPerpEntrySlippageUsd([], PAIR)).toBeNull();
    expect(
      chainPerpEntrySlippageUsd([deal({ aContract: 'BYBIT_FUTURE_BTC_USDT', bContract: 'GATE_FUTURE_BTC_USDT' })], PAIR),
    ).toBeNull();
  });

  it('poisons the whole chain on an unusable fill, never skip-and-miscount', () => {
    expect(chainPerpEntrySlippageUsd([deal(), deal({ aAvgFill: 0 })], PAIR)).toBeNull();
    expect(chainPerpEntrySlippageUsd([deal(), deal({ aSide: 'BUY' })], PAIR)).toBeNull();
  });

  it('drops deals older than the lookback, which then fails reconciliation', () => {
    const old = deal({ createdAtSec: PAIR.earliestOpenSec - 49 * 3600 });
    expect(chainPerpEntrySlippageUsd([old], PAIR)).toBeNull();
  });

  it('ignores other-base deals while reconciling the target base', () => {
    const btc = deal({
      aContract: 'BYBIT_FUTURE_BTC_USDT',
      bContract: 'GATE_FUTURE_BTC_USDT',
      aFilled: 3,
      bFilled: 3,
      aAvgFill: 64_000,
      bAvgFill: 64_010,
    });
    const r = chainPerpEntrySlippageUsd([deal(), btc], PAIR);
    expect(r).not.toBeNull();
    expect(r!.usd).toBeCloseTo(ENTRY_SLIPPAGE, 6);
    expect(r!.deals).toBe(1);
  });
});

describe('buildStrategies — hedge band boundary', () => {
  it.each([
    { mismatchPct: 0.019, hedge: 'hedged' }, // just inside the 2% band
    { mismatchPct: 0.03, hedge: 'partial' }, // just outside
  ])('classifies a $mismatchPct venue mismatch as $hedge', ({ mismatchPct, hedge }) => {
    const perps = ethPerps();
    // Per venue: boros notional 1M vs perp x. Solve |1M − x| / (1M + x) = p
    // → x = 1M(1−p)/(1+p) puts the venue exactly at mismatch ratio p.
    const x = (1_000_000 * (1 - mismatchPct)) / (1 + mismatchPct);
    perps[0].positionValue = String(x);
    perps[1].positionValue = String(x);
    const out = buildStrategies(input({ perpPositions: perps }));
    expect(out.strategies[0].hedge).toBe(hedge);
  });
});

describe('buildStrategies — multiple cohorts', () => {
  it('splits maturities into separate strategies and attaches perps to the largest venue cohort', () => {
    const laterMaturity = MATURITY + 56 * DAY;
    const hlSep: BorosMarket = { ...hlMarket, marketId: 169, maturity: laterMaturity };
    const zones = ethZones();
    // Add a smaller HL leg in the later cohort.
    zones[0].cross!.marketPositions.push({
      marketId: 169,
      side: 1,
      notionalSize: raw(-100_000),
      fixedApr: 0.06,
      markApr: 0.058,
      pnl: { rateSettlementPnl: raw(50), unrealisedPnl: raw(10) },
      positionInitialMargin: raw(500),
    });
    const out = buildStrategies(input({ zones, markets: [hlMarket, okxMarket, hlSep] }));
    expect(out.strategies).toHaveLength(2);
    // Sorted by gross notional: the $1M-per-leg cohort first.
    expect(out.strategies[0].maturity).toBe(MATURITY);
    // The HL perp lands on the bigger HL cohort and carries the ambiguity note.
    const bigCohortPerps = out.strategies[0].legs.filter((l) => l.kind === 'perp');
    expect(bigCohortPerps.map((l) => l.venue)).toContain('HYPERLIQUID');
    expect(out.strategies[1].legs.filter((l) => l.kind === 'perp' && l.venue === 'HYPERLIQUID')).toHaveLength(0);
    expect(bigCohortPerps.flatMap((l) => l.warnings).join(' ')).toMatch(/2 Boros maturities/);
    // Totals sum across cohorts.
    expect(out.totals.realizedPnlUsd).toBeCloseTo(
      out.strategies[0].realizedPnlUsd + out.strategies[1].realizedPnlUsd,
      6,
    );
  });
});

describe('buildStrategies — hedgeChecks sizing gate', () => {
  // The gate behind the UI's headline numbers (APR / capital / PnL by
  // maturity): a book still being built must not show a full-life spread
  // projection computed on the wrong notional.
  it('canonical 4-leg book: fully hedged, every ratio 1', () => {
    const s = buildStrategies(input()).strategies[0];
    expect(s.hedgeChecks).toEqual({
      borosMatchRatio: 1,
      perpMatchRatio: 1,
      borosVsPerpRatio: 1,
      fullyHedged: true,
    });
  });

  it('a missing perp leg zeroes the perp ratio and closes the gate', () => {
    const s = buildStrategies(input({ perpPositions: [ethPerps()[0]] })).strategies[0];
    expect(s.hedgeChecks.perpMatchRatio).toBe(0);
    expect(s.hedgeChecks.fullyHedged).toBe(false);
  });

  it('a one-sided Boros book zeroes the boros ratio and closes the gate', () => {
    const zones = ethZones();
    zones[0].cross!.marketPositions = zones[0].cross!.marketPositions.filter(
      (p) => p.marketId === 155,
    );
    const s = buildStrategies(input({ zones })).strategies[0];
    expect(s.hedgeChecks.borosMatchRatio).toBe(0);
    expect(s.hedgeChecks.fullyHedged).toBe(false);
  });

  it('layers sized apart close the gate at 80%, strictly', () => {
    const sized = (value: string) =>
      ethPerps().map((p) => ({ ...p, positionValue: value }));
    // Matched $700k perps against the $2M Boros book: 1.4/2 = 0.7 → closed.
    const under = buildStrategies(input({ perpPositions: sized('700000') })).strategies[0];
    expect(under.hedgeChecks.perpMatchRatio).toBe(1);
    expect(under.hedgeChecks.borosVsPerpRatio).toBeCloseTo(0.7, 10);
    expect(under.hedgeChecks.fullyHedged).toBe(false);
    // $800k exactly is 0.8 — NOT > 0.8, still closed (strict thresholds).
    const edge = buildStrategies(input({ perpPositions: sized('800000') })).strategies[0];
    expect(edge.hedgeChecks.borosVsPerpRatio).toBeCloseTo(0.8, 10);
    expect(edge.hedgeChecks.fullyHedged).toBe(false);
    // $850k clears it: 1.7/2 = 0.85 → open.
    const ok = buildStrategies(input({ perpPositions: sized('850000') })).strategies[0];
    expect(ok.hedgeChecks.borosVsPerpRatio).toBeCloseTo(0.85, 10);
    expect(ok.hedgeChecks.fullyHedged).toBe(true);
  });

  it('an invisible perp side (Boros-only view) closes the gate — unverifiable is not hedged', () => {
    const s = buildStrategies(input({ perpPositions: null })).strategies[0];
    expect(s.hedgeChecks.perpMatchRatio).toBe(0);
    expect(s.hedgeChecks.borosVsPerpRatio).toBe(0);
    expect(s.hedgeChecks.fullyHedged).toBe(false);
  });
});
