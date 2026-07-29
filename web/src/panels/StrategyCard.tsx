/**
 * One 4-leg fixed-return position box. Hierarchy per the revamp:
 *   Tier 1 — Fixed APR on Capital (hero) · Capital · Profit by maturity
 *   Tier 2 — locked-spread line + the spread-lock assumption caption,
 *            ProfitBars (spread return decomposed vs the MtM "now" row) and
 *            the always-visible paid/future fee legend with per-part exit
 *            checkboxes
 *   Legs   — collapsed rows; a perp row expands to live Entry/Mark/Lev +
 *            [Close]/[Lev] (joined to the 4s positions poll by symbol)
 * Purely prop-driven — PositionsHome owns the queries.
 */
import { useState } from 'react';
import type { CrossexPosition, ExitMode, StrategyLeg, StrategyRollup } from '../api/types';
import { Chip } from '../components/Chip';
import { DataTable, type Column } from '../components/DataTable';
import { Notes } from '../components/Notes';
import { SignedNumber } from '../components/SignedNumber';
import { Stat } from '../components/Stat';
import { SideChip, VenueChip } from '../components/VenueChip';
import {
  fmtAge,
  fmtDateLocal,
  fmtDateUtc,
  fmtPct,
  fmtTime,
  fmtUsd,
  fmtUsdCompact,
  num,
  parseSymbol,
  prettyVenue,
  toDate,
} from '../lib/fmt';
import { SegmentedToggle } from '../components/SegmentedToggle';
import { TimelineClockEdit } from './HomeControls';
import { PerpLegExpanded } from './PerpLegExpanded';
import { ProfitBars } from './ProfitBars';
import { applyExitCost, SECONDS_IN_YEAR, type ExitFlags } from './strategyMath';

function HedgeChip({ s }: { s: StrategyRollup }) {
  if (s.secondsToMaturity === 0) return <Chip sm title="The Boros legs have matured">matured</Chip>;
  if (s.hedge === 'hedged') return <Chip sm tone="green">hedged ✓</Chip>;
  if (s.hedge === 'partial') {
    return (
      <Chip sm tone="amber" title={`Residual floating notional ≈ ${fmtUsd(s.notionalMismatchUsd, 0)}`}>
        partial hedge
      </Chip>
    );
  }
  return <Chip sm tone="red" title="No matching perp legs found in the connected Gate account">unhedged</Chip>;
}

type LegRow = StrategyLeg & { _key: string };

/** Per-venue floating-cancellation summary for a leg's expanded row. */
function VenueCancellation({ legs, venue }: { legs: StrategyLeg[]; venue: string }) {
  const atVenue = legs.filter((l) => l.venue === venue);
  const perp = atVenue.filter((l) => l.kind === 'perp').reduce((s, l) => s + l.cashFlowUsd, 0);
  const boros = atVenue.filter((l) => l.kind === 'boros').reduce((s, l) => s + l.cashFlowUsd, 0);
  const hasBoth = atVenue.some((l) => l.kind === 'perp') && atVenue.some((l) => l.kind === 'boros');
  if (!hasBoth) {
    return (
      <span className="text-xs text-ink-500">
        No opposite leg on {venue} — its floating rate isn't cancelled within this view.
      </span>
    );
  }
  return (
    <span className="num text-xs text-ink-300">
      {venue} floating: perp funding <SignedNumber value={perp} format={(n) => fmtUsd(n)} /> · Boros
      settlements <SignedNumber value={boros} format={(n) => fmtUsd(n)} /> → residual{' '}
      <SignedNumber value={perp + boros} format={(n) => fmtUsd(n)} />
    </span>
  );
}

/** Resolve a perp leg to its live 4s-polled position: exact symbol first, then
 * a best-effort (venue, base) match for payloads without the symbol field. */
function liveFor(
  leg: StrategyLeg,
  livePositions: Map<string, CrossexPosition> | undefined,
): CrossexPosition | null {
  if (!livePositions) return null;
  if (leg.symbol) return livePositions.get(leg.symbol) ?? null;
  for (const p of livePositions.values()) {
    const { exchange, base } = parseSymbol(p.symbol);
    if (exchange === leg.venue && base.toUpperCase() === leg.base) return p;
  }
  return null;
}

export function StrategyCard({
  strategy,
  perpSource,
  since = null,
  onChangeSince,
  livePositions,
  onOpenPerpLegs,
}: {
  /** The custom strategy-start override (global ?since=), editable from the
   * timeline's "Boros position open ✎" label. */
  since?: number | null;
  onChangeSince?: (since: number | null) => void;
  strategy: StrategyRollup;
  perpSource: 'connected-gate-account' | null;
  /** symbol → live CrossexPosition (4s poll) for perp rows and actions. */
  livePositions?: Map<string, CrossexPosition>;
  /** Boros-only cue: prefill the pair ticket with this strategy's perp legs. */
  onOpenPerpLegs?: (s: StrategyRollup) => void;
}) {
  const s = strategy;
  // The two waterfalls sit behind the hero boxes / See-more toggle — collapsed
  // by default; the bordered hero box + its "see more" strip invite the click.
  const [chartsOpen, setChartsOpen] = useState(false);
  // Per-position exit assumption: 'close' folds the estimated exit costs in
  // (maker+hedge fees + assumed slippage); 'roll' keeps the perps — no exit
  // costs charged. The profit formula includes future costs, so close is the
  // default.
  const [exitMode, setExitMode] = useState<ExitMode>('close');
  const flags: ExitFlags =
    exitMode === 'close'
      ? { inclExitFees: true, inclExitSlippage: true }
      : { inclExitFees: false, inclExitSlippage: false };
  // Display-side application of the checked exit parts: the server never
  // bakes them into any number.
  const { expectedUsd } = applyExitCost({
    flags,
    perpExitFeesUsd: s.feesUsd.future.perpExitFeesUsd,
    perpExitSlippageUsd: s.feesUsd.future.perpExitSlippageUsd,
    realizedPnlUsd: s.realizedPnlUsd,
    realizedApr: s.realizedApr,
    expectedPnlToMaturityUsd: s.expectedPnlToMaturityUsd,
    capitalUsd: s.capitalUsd,
    elapsedSeconds: s.elapsedSeconds,
  });
  // Fixed APR on capital: the PnL expected by maturity (already exit-adjusted
  // for the chosen mode) as a return on the capital posted, annualized over the
  // FULL trade life — start → maturity. This is the net, whole-duration basis
  // the opportunity scanner uses (estProfit / (capital × yearsToMaturity)); the
  // difference for a live position is that the clock runs from when it opened.
  // Null when the clock or capital is unknowable (matches "PNL by maturity").
  const lifeSeconds = s.clockStartSec === null ? null : s.maturity - s.clockStartSec;
  const fixedAprOnCapital =
    lifeSeconds !== null && lifeSeconds > 0 && s.capitalUsd > 0 && expectedUsd !== null
      ? expectedUsd / (s.capitalUsd * (lifeSeconds / SECONDS_IN_YEAR))
      : null;

  const perpLegs = s.legs.filter((l) => l.kind === 'perp');
  const borosLegs = s.legs.filter((l) => l.kind === 'boros');
  // Title venues: the perp side wins; Boros sides substitute when the perp leg
  // isn't on yet (perp side = Boros side at the same venue).
  const venueForSide = (side: 'LONG' | 'SHORT'): string | null =>
    perpLegs.find((l) => l.side === side)?.venue ??
    borosLegs.find((l) => l.side === side)?.venue ??
    null;
  const longVenue = venueForSide('LONG');
  const shortVenue = venueForSide('SHORT');
  const borosNotionalPerSide = borosLegs.reduce((sum, l) => sum + l.notionalUsd, 0) / 2;
  const matured = s.secondsToMaturity === 0;
  const borosOnly = perpLegs.length === 0 && perpSource !== null;

  // Content-based row keys: expanded-row state must follow the LEG, not its
  // index (a leg set change between refetches would silently remap indexes).
  // Perp legs include the exact symbol so two same-venue same-side positions
  // (e.g. USDT + USDC quotes) can never swap identities on a feed reorder.
  const keyCounts = new Map<string, number>();
  const rows: LegRow[] = s.legs.map((l) => {
    const base = `${l.kind}:${l.venue}:${l.side}${l.symbol ? `:${l.symbol}` : ''}`;
    const n = keyCounts.get(base) ?? 0;
    keyCounts.set(base, n + 1);
    return { ...l, _key: n === 0 ? base : `${base}:${n}` };
  });

  const isCrossexPerp = (l: StrategyLeg) =>
    l.kind === 'perp' && perpSource === 'connected-gate-account';

  const columns: Column<LegRow>[] = [
    {
      key: 'leg',
      header: 'Leg',
      render: (l) => (
        <span className="inline-flex items-center gap-2">
          <VenueChip exchange={l.venue} crossex={isCrossexPerp(l)} />
          <span
            className="text-[10px] uppercase tracking-wider text-ink-500"
            title={l.kind === 'perp' ? 'Perp position from your connected Gate account' : 'Boros position from the entered address'}
          >
            {l.kind === 'perp' ? 'perp' : 'Boros'}
          </span>
        </span>
      ),
    },
    { key: 'side', header: 'Side', render: (l) => <SideChip side={l.side} /> },
    {
      key: 'notional',
      header: 'Notional',
      align: 'right',
      render: (l) => (
        <span className="num" title={fmtUsd(l.notionalUsd, 0)}>
          {fmtUsdCompact(l.notionalUsd)}
        </span>
      ),
    },
    {
      key: 'rate',
      header: 'Rate',
      align: 'right',
      render: (l) =>
        l.kind === 'boros' && l.entryApr !== undefined ? (
          <span className="num" title="entry fixed APR → current mark APR">
            {fmtPct(l.entryApr)}<span className="text-ink-500">→</span>
            {l.markApr !== undefined ? fmtPct(l.markApr) : '—'}
          </span>
        ) : (
          <span className="text-ink-600">—</span>
        ),
    },
    {
      key: 'cash',
      header: 'Cash flow',
      align: 'right',
      render: (l) => (
        <span title={l.kind === 'perp' ? 'Cumulative funding' : 'Funding settlements (net of settlement fees)'}>
          <SignedNumber value={l.cashFlowUsd} format={(n) => fmtUsd(n)} />
        </span>
      ),
    },
    {
      key: 'mtm',
      header: 'MTM',
      align: 'right',
      render: (l) => {
        // Perp rows: LIVE uPnL (4s feed), DISPLAY-ONLY — excluded from Net.
        // The delta-neutral pair's price MtMs cancel to entry-gap noise, which
        // the strategy accounts once as entry slippage. Boros MtM stays in Net.
        if (l.kind === 'perp') {
          const live = liveFor(l, livePositions);
          const value = live ? Number(live.upnl) : l.mtmUsd;
          return (
            <span
              className="text-ink-500"
              title="Price MtM (display only — excluded from Net; the pair's uPnLs cancel, accounted as entry slippage)"
            >
              <SignedNumber value={value} format={(n) => num(n)} className="!text-ink-500" />
            </span>
          );
        }
        return <SignedNumber value={l.mtmUsd} format={(n) => num(n)} />;
      },
    },
    {
      key: 'fees',
      header: 'Fees',
      align: 'right',
      render: (l) =>
        l.feesUsd > 0 ? (
          <span className="num text-ink-300">−{fmtUsd(l.feesUsd)}</span>
        ) : (
          <span className="text-ink-600">—</span>
        ),
    },
    {
      key: 'net',
      header: 'Net',
      align: 'right',
      render: (l) => (
        <span
          title={
            l.kind === 'perp'
              ? 'Funding (since the strategy start) − trading fees'
              : 'Settlements + rate MtM + trade P&L (net of fees)'
          }
        >
          <SignedNumber value={l.netUsd} format={(n) => fmtUsd(n)} className="font-medium" />
        </span>
      ),
    },
  ];

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-sm font-semibold text-ink-100">{s.base}</span>
          <span className="text-xs text-ink-400">
            {longVenue && (
              <>
                <span className="text-emerald-400">long</span> {prettyVenue(longVenue)}
              </>
            )}
            {longVenue && shortVenue && ' '}
            {shortVenue && (
              <>
                <span className="text-rose-400">short</span> {prettyVenue(shortVenue)}
              </>
            )}
          </span>
          <span
            className="num text-xs text-ink-300"
            title={
              s.spreadReturnUsd !== null
                ? `Assumes ${fmtPct(s.spread)} locked on ${fmtUsdCompact(borosNotionalPerSide)} since the strategy start → spread return ≈${fmtUsd(s.spreadReturnUsd, 0)} by maturity`
                : 'Locked fixed spread across the Boros legs'
            }
          >
            ({fmtPct(s.spread)} spread)
          </span>
        </div>
        <HedgeChip s={s} />
      </div>

      <Notes items={s.warnings} className="mt-2" />

      {/* Cues for incomplete/matured states. */}
      {borosOnly && !matured && onOpenPerpLegs && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary !py-1 !px-3 text-sm" onClick={() => onOpenPerpLegs(s)}>
            Open the perp legs →
          </button>
          <span className="text-xs text-ink-500">
            prefills the pair ticket with the opposite floating exposure
          </span>
        </div>
      )}
      {matured && perpLegs.length > 0 && (
        <div className="mt-2 text-xs leading-relaxed text-amber-400/90">
          The Boros legs have matured — close the perp legs (expand a perp row → Close) to realize
          the locked return.
        </div>
      )}

      {/* Strategy timeline: start → now → maturity, as a full-width bar. */}
      {s.elapsedSeconds !== null && s.elapsedSeconds + s.secondsToMaturity > 0 && (
        <div
          className="relative mt-3 pt-3.5"
          data-progress="maturity"
          title={`${fmtAge(s.elapsedSeconds * 1000)} elapsed · ${matured ? 'matured' : `${fmtAge(s.secondsToMaturity * 1000)} left`}`}
        >
          {(() => {
            const pct = Math.min(
              100,
              (s.elapsedSeconds / (s.elapsedSeconds + s.secondsToMaturity)) * 100,
            );
            return (
              <>
                <div
                  className="absolute top-0 -translate-x-1/2 text-[9px] leading-none text-cyan-300"
                  style={{ left: `${Math.min(96, Math.max(4, pct))}%` }}
                >
                  now
                </div>
                <div className="relative h-1.5 overflow-hidden rounded-full bg-ink-700">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-cyan-400/70"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div
                  aria-hidden
                  className="absolute mt-[-9px] h-3 w-0.5 -translate-x-1/2 rounded bg-cyan-300"
                  style={{ left: `${pct}%` }}
                />
                <div className="mt-0.5 flex justify-between gap-4 text-[9px] text-ink-500">
                  <span className="flex flex-col gap-0.5">
                    <span className="num" title="Strategy start (the clock basis)">
                      {s.clockStartSec !== null ? fmtDateLocal(s.clockStartSec) : 'start'}
                    </span>
                    <TimelineClockEdit since={since} basis={s.clockBasis} onChange={onChangeSince} />
                  </span>
                  <span className="num" title="Boros maturity">
                    {matured
                      ? `matured ${fmtDateUtc(s.maturity)}`
                      : `matures ${fmtDateUtc(s.maturity)} · ${fmtAge(s.secondsToMaturity * 1000)} left`}
                  </span>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* Tier 1 — the hero numbers and (when open) the waterfalls share ONE
          bordered box. The stats surface and the "see more/less" strip both
          toggle; the strip stays the box's bottom edge, so open order is
          stats → waterfalls → "see less". */}
      <div className="mt-3 overflow-hidden rounded-lg border border-cyan-500/40 transition-colors hover:border-cyan-400/70">
        <button
          type="button"
          aria-expanded={chartsOpen}
          title={chartsOpen ? 'Hide the waterfall breakdown' : 'Show the waterfall breakdown'}
          onClick={() => setChartsOpen((v) => !v)}
          className="block w-full text-left"
        >
          <div className="flex flex-wrap items-end gap-x-10 gap-y-3 p-3">
        <Stat label="Fixed APR on capital" hero>
          {fixedAprOnCapital === null ? (
            <span className="num text-ink-400" title="The strategy start or capital is unknown — no APR">
              —
            </span>
          ) : (
            <span title="The PnL expected by maturity as a return on the capital this strategy posts, annualized over the full trade life (start → maturity). Net of every cost, and it follows the Close / Roll assumption below.">
              <SignedNumber value={fixedAprOnCapital} format={(n) => fmtPct(n)} />
            </span>
          )}
        </Stat>
        <Stat label="Capital">
          <span className="num text-ink-100">{fmtUsd(s.capitalUsd, 0)}</span>
        </Stat>
        <Stat label={matured ? 'PNL (realized at maturity)' : 'PNL by maturity'}>
          {expectedUsd === null ? (
            <span className="num text-ink-400" title="The strategy start is unknown — no projection">
              —
            </span>
          ) : (
            <SignedNumber value={expectedUsd} format={(n) => fmtUsd(n, 0)} className="font-medium" />
          )}
        </Stat>
          <Stat label="Current PnL">
            <span title="Funding + Boros settlements & rate MtM − fees − entry slippage — the waterfalls below break it down">
              <SignedNumber value={s.realizedPnlUsd} format={(n) => fmtUsd(n, 0)} className="font-medium" />
            </span>
          </Stat>
          </div>
        </button>

        {/* The waterfalls uncollapse INSIDE the box, between the stats and
            the strip. */}
        {chartsOpen && (
          <div className="px-3 pb-2">
            <ProfitBars
              spreadReturnUsd={s.spreadReturnUsd}
              profitUsd={expectedUsd}
              // "now" is the CURRENT NET (Σ leg nets − entry slippage) — the
              // exit checkboxes only shape the TARGET; they are future costs,
              // not money already made or lost.
              mtmUsd={s.realizedPnlUsd}
              legs={s.legs}
              fees={s.feesUsd}
              flags={flags}
            />
          </div>
        )}

        {/* The inviting strip at the bottom of the box. */}
        <button
          type="button"
          aria-expanded={chartsOpen}
          title={chartsOpen ? 'Hide the waterfall breakdown' : 'Show the waterfall breakdown'}
          onClick={() => setChartsOpen((v) => !v)}
          className="flex w-full items-center justify-center gap-1 border-t border-cyan-500/25 py-1 text-[11px] font-medium text-cyan-300"
        >
          {chartsOpen ? 'see less ▲' : 'see more ▼'}
        </button>
      </div>

      {/* The PER-POSITION exit assumption toggle (the spread now lives in the
          card title). */}
      <div className="mt-2 flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
        <span
          title={
            'Close perp at maturity: folds this position’s estimated exit costs into its profit numbers — assumes a maker+hedge close (maker on one leg, taker hedge on the other, cheapest assignment) and exit slippage equal to the entry slippage. Roll over: the perp legs stay open past maturity — no exit costs are charged.'
          }
        >
          <SegmentedToggle<ExitMode>
            ariaLabel="Perp legs at maturity"
            value={exitMode}
            onChange={setExitMode}
            options={[
              { value: 'close', label: 'Close perp at maturity' },
              { value: 'roll', label: 'Roll over' },
            ]}
          />
        </span>
      </div>

      <div className="mt-3">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(l) => l._key}
          maxHeightClass="max-h-96"
          renderExpanded={(l) => (
            <div className="flex flex-col gap-1.5">
              {l.kind === 'boros' && <VenueCancellation legs={s.legs} venue={l.venue} />}
              {l.kind === 'perp' && <PerpLegExpanded position={liveFor(l, livePositions)} />}
              {l.kind === 'boros' && (
                <span className="num text-xs text-ink-400">
                  Live floating APR {l.floatingApr !== undefined ? fmtPct(l.floatingApr) : '—'} · opened{' '}
                  {fmtTime(toDate(l.openedAt))}
                  {l.tradePnlUsd !== 0 && (
                    <>
                      {' '}
                      · trade P&L (net) <SignedNumber value={l.tradePnlUsd} format={(n) => fmtUsd(n)} />
                    </>
                  )}
                </span>
              )}
              {l.warnings.map((w) => (
                <span key={w} className="text-xs text-amber-400/90">
                  {w}
                </span>
              ))}
            </div>
          )}
        />
      </div>

      {!perpSource && (
        <div className="mt-2 text-[10px] text-ink-500">
          Boros legs from the entered address — connect Gate keys to overlay perp legs 1–2
        </div>
      )}
    </div>
  );
}
