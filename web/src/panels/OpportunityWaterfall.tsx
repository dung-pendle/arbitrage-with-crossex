/** The opportunity card's Tier-2 visual: TWO waterfalls, on INDEPENDENT axes.
 *
 *  LEFT  — profit by maturity: the gross spread return stepped down through the
 *          Boros book impact and every cost to the estimated profit.
 *  RIGHT — capital (modelled min): the four initial-margin components stacked
 *          up to the capital the trade must post.
 *
 * The two carry unrelated magnitudes (capital is routinely 10-100x the profit),
 * so each gets its own scale — unlike the strategy card's pair, which share one
 * axis because the "now" line is heading for the profit target.
 *
 * Both identities close by construction. Profit, with
 * NT = notional x secondsToMaturity/(365 x 86400) matching the server's
 * `notionalYears`: gross x NT − impact x NT − Σcosts = estProfitUsd. Capital:
 * the four margins sum to capitalUsd. A dev-only warning fires on any drift.
 */
import type { OpportunityPair } from '../api/types';
import {
  applyValueLabels,
  computeWaterfallScale,
  costText,
  dashedAmber,
  dashedEmerald,
  WaterfallPlot,
  type WaterfallStep,
} from '../components/Waterfall';
import { fmtPct, fmtUsd } from '../lib/fmt';

const SECONDS_IN_YEAR = 365 * 86_400;

/** The profit chart needs the whole chain from the gross spread to the profit;
 * any missing link leaves the text ledger to explain itself. */
export function canChartProfit(pair: OpportunityPair): boolean {
  return (
    pair.estProfitUsd !== null && pair.borosImpactApr !== null && pair.costs.totalUsd !== null
  );
}

/** `> 0` doubles as the span guard: every capital level sits in [0, capitalUsd]. */
export function canChartCapital(pair: OpportunityPair): boolean {
  return pair.capitalUsd !== null && pair.capitalUsd > 0;
}

/** [key, usd, className, axisLabel, title] — the profit chart's decrements, in
 * the order they are incurred. At-entry costs are solid amber; costs paid over
 * the life or at maturity are dashed amber (pattern, not colour alone). */
function costRows(
  pair: OpportunityPair,
  impactUsd: number,
): Array<[string, number | null, string, string, string]> {
  const c = pair.costs;
  return [
    [
      'opp-boros-impact',
      impactUsd,
      'bg-amber-500',
      'Boros impact',
      // Mode-agnostic: under `market` this is the book walk, under `mark` it is
      // mark-vs-mid. Either way it is the gap between the mid spread and what
      // the pair actually locks.
      `Boros price impact ${costText(impactUsd)} — the pair locks ${fmtPct(pair.execSpreadApr ?? 0)} rather than the ${fmtPct(pair.grossSpreadApr)} mid spread`,
    ],
    [
      'opp-boros-taker',
      c.borosTakerFeeUsd,
      'bg-amber-500/75',
      'Boros taker fee',
      `Boros taker fees, both legs ${costText(c.borosTakerFeeUsd)}`,
    ],
    [
      'opp-boros-settle',
      c.borosSettleFeeUsd,
      dashedAmber,
      'Boros settlement',
      `Boros settlement fees accrued to maturity ${costText(c.borosSettleFeeUsd, true)}`,
    ],
    [
      'opp-perp-entry-fees',
      c.perpEntryFeesUsd,
      'bg-amber-500/55',
      'Perp entry fees',
      `Perp entry fees, both legs ${costText(c.perpEntryFeesUsd ?? 0)}`,
    ],
    [
      'opp-entry-slip',
      c.perpEntrySlippageUsd,
      'bg-amber-500/40',
      'Entry slip',
      `Perp entry slippage ${costText(c.perpEntrySlippageUsd ?? 0)}`,
    ],
    [
      'opp-exit-fees',
      c.perpExitFeesUsd,
      dashedAmber,
      'Perp exit fees',
      `Perp exit fees at maturity ${costText(c.perpExitFeesUsd ?? 0, true)}`,
    ],
    [
      'opp-exit-slip',
      c.perpExitSlippageUsd,
      dashedAmber,
      'Exit slip',
      // NOT "assumed = entry" — that is the strategy view's estimate. Here the
      // server crosses back out of today's books to price it.
      `Perp exit slippage, crossing back out of both books at maturity ${costText(c.perpExitSlippageUsd ?? 0, true)}`,
    ],
  ];
}

function buildProfitSteps(pair: OpportunityPair, notionalUsd: number): WaterfallStep[] {
  const nt = (notionalUsd * pair.secondsToMaturity) / SECONDS_IN_YEAR;
  const grossUsd = pair.grossSpreadApr * nt;
  const impactUsd = (pair.borosImpactApr ?? 0) * nt;
  const profitUsd = pair.estProfitUsd as number;

  const steps: WaterfallStep[] = [
    {
      // Keyed `spread` so the plot withholds data-tone from the opening total,
      // exactly as it does on the strategy card.
      key: 'spread',
      kind: 'total',
      // Pairs are ordered by markApr under `borosEntry: 'mark'` while the gross
      // spread is mid-based, so the two can disagree in sign — a negative gross
      // must not read as an upward emerald gain.
      dir: grossUsd >= 0 ? 'up' : 'down',
      from: 0,
      to: grossUsd,
      className: grossUsd >= 0 ? 'bg-emerald-500' : 'bg-rose-500',
      title: `Gross spread return ${fmtUsd(grossUsd)} — ${fmtPct(pair.grossSpreadApr)} on the notional to maturity`,
      axisLabel: 'Gross spread',
    },
  ];

  let level = grossUsd;
  for (const [key, usd, cls, axisLabel, title] of costRows(pair, impactUsd)) {
    // Zero is skipped, not drawn: under `roll` the server sends 0 exit costs,
    // which is what removes those columns (never the exitMode prop — data and
    // mode disagree mid-refetch, and the identity must always close).
    if (usd === null || usd === 0) continue;
    const from = level;
    level -= usd; // signed: a favorable (negative) cost raises the level
    const isFuture = cls === dashedAmber;
    steps.push({
      key,
      kind: isFuture ? 'cost-future' : 'cost-paid',
      dir: usd > 0 ? 'down' : 'up',
      from,
      to: level,
      className: usd > 0 ? cls : isFuture ? dashedEmerald : 'bg-emerald-500/80',
      title,
      axisLabel,
    });
  }

  steps.push({
    key: 'profit',
    kind: 'total',
    dir: profitUsd >= 0 ? 'up' : 'down',
    from: 0,
    to: profitUsd,
    className: profitUsd >= 0 ? 'bg-emerald-500' : 'bg-rose-500',
    title: `Estimated profit by maturity ${fmtUsd(profitUsd)} — the locked spread minus every cost`,
    axisLabel: 'Est. profit',
  });
  if (import.meta.env.DEV && Math.abs(level - profitUsd) > 0.01) {
    // eslint-disable-next-line no-console
    console.warn('waterfall identity drift (opportunity profit)', { level, profitUsd });
  }
  return steps;
}

function buildCapitalSteps(pair: OpportunityPair): WaterfallStep[] {
  const cap = pair.capital;
  const total = pair.capitalUsd as number;
  const lev = (max: number | null) =>
    max === null || !Number.isFinite(max) ? '' : ` @ ${max}x`;

  // Capital is neither income nor cost — cyan, the house's informational
  // register, on an alpha ramp in stacking order.
  const rows: Array<[string, number | null, string, string, string]> = [
    [
      'cap-boros-short',
      cap.borosShortImUsd,
      'bg-cyan-400/80',
      'Boros short IM',
      `Boros initial margin · ${pair.shortLeg.venue} (short) +${fmtUsd(cap.borosShortImUsd ?? 0)}`,
    ],
    [
      'cap-boros-long',
      cap.borosLongImUsd,
      'bg-cyan-400/60',
      'Boros long IM',
      `Boros initial margin · ${pair.longLeg.venue} (long) +${fmtUsd(cap.borosLongImUsd ?? 0)}`,
    ],
    [
      'cap-perp-short',
      cap.perpShortImUsd,
      'bg-cyan-400/45',
      `Perp short IM${lev(cap.shortLeverageMax)}`,
      `Perp initial margin · ${pair.shortLeg.venue} (short) — notional over the venue's max leverage${lev(cap.shortLeverageMax)} +${fmtUsd(cap.perpShortImUsd ?? 0)}`,
    ],
    [
      'cap-perp-long',
      cap.perpLongImUsd,
      'bg-cyan-400/30',
      `Perp long IM${lev(cap.longLeverageMax)}`,
      `Perp initial margin · ${pair.longLeg.venue} (long) — notional over the venue's max leverage${lev(cap.longLeverageMax)} +${fmtUsd(cap.perpLongImUsd ?? 0)}`,
    ],
  ];

  const steps: WaterfallStep[] = [];
  let level = 0;
  for (const [key, usd, className, axisLabel, title] of rows) {
    if (usd === null || usd === 0) continue;
    const from = level;
    level += usd;
    steps.push({ key, kind: 'capital', dir: 'up', from, to: level, className, axisLabel, title });
  }
  steps.push({
    key: 'cap-total',
    kind: 'total',
    dir: 'up',
    from: 0,
    to: total,
    className: 'bg-cyan-400',
    title: `Modelled minimum capital ${fmtUsd(total)} across the four legs`,
    axisLabel: 'Total capital',
  });
  if (import.meta.env.DEV && Math.abs(level - total) > 0.01) {
    // eslint-disable-next-line no-console
    console.warn('waterfall identity drift (opportunity capital)', { level, total });
  }
  return steps;
}

/** Spells out the profit chart's amber convention: solid = cost already locked
 * in, dashed = cost still to be incurred (pattern, not colour alone). */
const profitLegend = (
  <>
    <span aria-hidden className="flex items-center gap-1.5 text-[9.5px] text-ink-400">
      <span className="h-2 w-2.5 shrink-0 rounded-sm bg-amber-500/85" />
      locked in
    </span>
    <span aria-hidden className="flex items-center gap-1.5 text-[9.5px] text-ink-400">
      <span className="box-border h-2 w-2.5 shrink-0 rounded-sm border border-dashed border-amber-500/70 bg-amber-500/10" />
      future
    </span>
  </>
);

export function OpportunityWaterfall({
  pair,
  notionalUsd,
}: {
  pair: OpportunityPair;
  /** The notional the RESPONSE priced — meta.notionalUsd, not the live control,
   * so the USD conversion matches the costs it is charted against. */
  notionalUsd: number;
}) {
  // Read the roll off the DATA, like the bars: the live exitMode control moves
  // before the refetch lands, and a note that contradicts the columns beside it
  // is worse than one that arrives a beat late.
  const rolling = pair.costs.perpExitFeesUsd === 0 && pair.costs.perpExitSlippageUsd === 0;
  const profitSteps = canChartProfit(pair) ? buildProfitSteps(pair, notionalUsd) : null;
  const capitalSteps = canChartCapital(pair) ? buildCapitalSteps(pair) : null;

  const left = computeWaterfallScale(profitSteps ? [profitSteps] : []);
  const right = computeWaterfallScale(capitalSteps ? [capitalSteps] : []);
  const showProfit = profitSteps !== null && left.span > 0;
  const showCapital = capitalSteps !== null && right.span > 0;
  if (!showProfit && !showCapital) return null;
  if (profitSteps) applyValueLabels(profitSteps);
  if (capitalSteps) applyValueLabels(capitalSteps);

  const label = [
    showProfit
      ? `gross spread return ${fmtUsd(profitSteps![0].to, 0)} minus Boros impact and costs to an estimated profit of ${fmtUsd(pair.estProfitUsd ?? 0, 0)}`
      : null,
    showCapital
      ? `modelled minimum capital ${fmtUsd(pair.capitalUsd ?? 0, 0)} built from the Boros and perp initial margins`
      : null,
  ]
    .filter(Boolean)
    .join('; ');

  return (
    <div>
      <div data-waterfall role="img" aria-label={`Waterfalls: ${label}`} className="relative pt-3">
        <div className="flex items-stretch gap-6">
          {showProfit && (
            <WaterfallPlot
              steps={profitSteps!}
              y={left.y}
              span={left.span}
              domainMin={left.domainMin}
              caption="profit by maturity"
              legend={profitLegend}
            />
          )}
          {showCapital && (
            <WaterfallPlot
              steps={capitalSteps!}
              y={right.y}
              span={right.span}
              domainMin={right.domainMin}
              caption="capital (modelled min)"
            />
          )}
        </div>
      </div>

      {/* Outside the role="img" element — its children are presentational to
          assistive tech, and this prose has to stay readable. */}
      <div className="mt-2 flex flex-col gap-0.5 leading-relaxed text-ink-500">
        {showProfit && rolling && <div>rolling — no exit cost</div>}
        {showProfit && pair.makerLeg && (
          <div>
            Maker leg <span className="text-ink-200">{pair.makerLeg}</span>
          </div>
        )}
        {showCapital &&
          pair.effectiveLeverage !== null &&
          Number.isFinite(pair.effectiveLeverage) && (
            <div>
              <span className="num">{pair.effectiveLeverage.toFixed(1)}x</span> effective leverage —
              the notional over the modelled capital
            </div>
          )}
        {showCapital && (
          <div>
            The Positions view divides by the Boros collateral you have actually POSTED, so a live
            position that is over-collateralized reads a lower APR than this estimate for the very
            same trade.
          </div>
        )}
      </div>
    </div>
  );
}
