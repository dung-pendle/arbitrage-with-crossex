/** The Tier-2 visual: TWO waterfalls on one shared $ axis.
 *
 *  LEFT  — profit by maturity: the full-life spread return stepped down
 *          through every cost to the profit target.
 *  RIGHT — current net (now): how the "now" number is built — the four
 *          entry/settle costs first, then perp funding settled, Boros funding
 *          settlements (gross) and the Boros rate MtM build back up to the
 *          current net.
 *
 * The dashed cyan "now" line is drawn on the right plot and lands exactly on
 * its end bar. Hand-rolled divs (house precedent — no chart lib). Paid
 * decrements are solid amber; future decrements are low-alpha amber with a
 * dashed outline (pattern, not colour alone); favorable (negative) costs step
 * UP in emerald; settled income is cyan, unrealized Boros MtM dashed cyan.
 * Every component carries its amount as a label. The left builder mirrors
 * strategyMath.applyExitCost's gates EXACTLY and the right builder sums the
 * legs the server summed, so each chart's running level lands on its
 * authoritative total by construction. The whole block collapses behind the
 * card's "Profit by maturity" box (chartsOpen).
 */
import type { StrategyFees, StrategyLeg } from '../api/types';
import {
  applyValueLabels,
  computeWaterfallScale,
  costText,
  dashedAmber as dashed,
  dashedCyan,
  dashedEmerald as dashedUp,
  WaterfallPlot as Plot,
  type WaterfallStep as Step,
} from '../components/Waterfall';
import { fmtUsd } from '../lib/fmt';
import type { ExitFlags } from './strategyMath';

const TITLES: Record<string, string> = {
  'paid-perp-fees': 'Perp trading fees paid',
  'paid-entry-slippage': 'Perp entry slippage paid',
  'paid-boros-trade': 'Boros trading fees paid',
  'paid-boros-settle': 'Boros settlement fees paid (est.)',
  'future-boros-settle': 'Boros settlement fees to maturity (est.)',
  'future-exit-fees': 'Perp exit fees (maker+hedge, est.)',
  'future-exit-slippage': 'Perp exit slippage (assumed = entry, est.)',
};

export function ProfitBars({
  spreadReturnUsd,
  profitUsd,
  mtmUsd,
  legs,
  fees,
  flags,
  chartsOpen = true,
}: {
  /** Gross full-life spread return (null = clock unknown → nothing renders). */
  spreadReturnUsd: number | null;
  /** Profit by maturity net of the CHECKED exit parts (applyExitCost). */
  profitUsd: number | null;
  /** The CURRENT NET P&L (Σ leg nets − entry slippage = realizedPnlUsd) — the
   * exit checkboxes never touch this line; they are future costs and only
   * shape the profit-by-maturity target. */
  mtmUsd: number;
  /** The strategy legs — source of the "now" waterfall's component sums. */
  legs: StrategyLeg[];
  fees: StrategyFees;
  /** Gates the exit columns (the header checkboxes own the state). */
  flags: ExitFlags;
  /** Collapse toggle (the card's "Profit by maturity" box drives it). */
  chartsOpen?: boolean;
}) {
  const { paid, future } = fees;

  // --- LEFT: profit-by-maturity steps -------------------------------------------
  // Signed cost rows in decrement order. The gates mirror applyExitCost: exit
  // FEES only when checked and > 0; exit SLIPPAGE when checked and non-null
  // (signed — a favorable value steps UP). Zero/null rows are skipped.
  const costRows: Array<[string, number | null, string, string]> = [
    ['paid-perp-fees', paid.perpTradingUsd, 'bg-amber-500', 'Perp entry fees'],
    ['paid-entry-slippage', paid.perpEntrySlippageUsd, 'bg-amber-500/75', 'Entry slip'],
    ['paid-boros-trade', paid.borosTradeUsd, 'bg-amber-500/55', 'Boros trade fees'],
    ['paid-boros-settle', paid.borosSettlementUsd, 'bg-amber-500/40', 'Settlement fees paid'],
    ['future-boros-settle', future.borosSettlementUsd, dashed, 'Settlement fees →mat'],
    [
      'future-exit-fees',
      flags.inclExitFees && future.perpExitFeesUsd !== null && future.perpExitFeesUsd > 0
        ? future.perpExitFeesUsd
        : null,
      dashed,
      'Perp exit',
    ],
    [
      'future-exit-slippage',
      flags.inclExitSlippage ? future.perpExitSlippageUsd : null,
      dashed,
      'Exit slip',
    ],
  ];

  const steps: Step[] = [];
  const showChart = spreadReturnUsd !== null && profitUsd !== null;
  if (showChart) {
    steps.push({
      key: 'spread',
      kind: 'total',
      dir: 'up',
      from: 0,
      to: spreadReturnUsd,
      className: 'bg-emerald-500',
      title: `Spread return (locked) ${fmtUsd(spreadReturnUsd)}`,
      axisLabel: 'Spread locked',
    });
    let level = spreadReturnUsd;
    for (const [key, usd, cls, axisLabel] of costRows) {
      if (usd === null || usd === 0) continue;
      const from = level;
      level -= usd; // signed: a negative cost raises the level
      const isFuture = key.startsWith('future');
      steps.push({
        key,
        kind: isFuture ? 'cost-future' : 'cost-paid',
        dir: usd > 0 ? 'down' : 'up',
        from,
        to: level,
        className: usd > 0 ? cls : isFuture ? dashedUp : 'bg-emerald-500/80',
        title: `${TITLES[key]} ${costText(usd, isFuture || key === 'paid-boros-settle')}`,
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
      title: `Net PnL by maturity ${fmtUsd(profitUsd)}`,
      axisLabel: 'PnL',
    });
    // The end total is drawn at the authoritative profitUsd; the running level
    // must land there by construction — warn (dev only) on any drift.
    if (import.meta.env.DEV && Math.abs(level - profitUsd) > 0.01) {
      // eslint-disable-next-line no-console
      console.warn('waterfall identity drift (profit)', { level, profitUsd });
    }
  }

  // --- RIGHT: current-net ("now") steps -------------------------------------------
  // Component sums come from the LEGS — the exact inputs the server summed
  // into realizedPnlUsd — so the running level lands on `now` by construction.
  // Boros settlements are shown GROSS with the settle fees paid as their own
  // step (gross − fees = the net the server uses; nothing double-counts).
  const perpLegs = legs.filter((l) => l.kind === 'perp');
  const borosLegs = legs.filter((l) => l.kind === 'boros');
  const perpFrUsd = perpLegs.reduce((s, l) => s + l.cashFlowUsd, 0);
  const perpFeesUsd = perpLegs.reduce((s, l) => s + l.feesUsd, 0);
  const borosFrNetUsd = borosLegs.reduce((s, l) => s + l.cashFlowUsd, 0);
  const borosMtmUsd = borosLegs.reduce((s, l) => s + l.mtmUsd, 0);
  const borosEntryUsd = borosLegs.reduce((s, l) => s + l.tradePnlUsd, 0);
  const settlePaidUsd = paid.borosSettlementUsd;

  // [key, DELTA (signed, + = gain), className(s) for up/down, title, axisLabel]
  // Order: the four entry/settle COSTS first, then the funding income and the
  // Boros MtM build back up to the current net.
  const nowRows: Array<[string, number, string, string, string, string]> = [
    [
      'now-perp-entry',
      -perpFeesUsd,
      'bg-emerald-500/80',
      'bg-amber-500',
      'Perp trading fees paid',
      'Perp entry fees',
    ],
    [
      'now-entry-slip',
      -(paid.perpEntrySlippageUsd ?? 0),
      'bg-emerald-500/80',
      'bg-amber-500/75',
      'Perp entry slippage paid',
      'Entry slip',
    ],
    [
      'now-boros-entry',
      borosEntryUsd,
      'bg-emerald-500/80',
      'bg-amber-500/55',
      'Boros trade fees — trade P&L net of trade fees',
      'Boros trade fees',
    ],
    [
      'now-settle-paid',
      -settlePaidUsd,
      'bg-emerald-500/80',
      'bg-amber-500/40',
      'Boros settlement fees paid (est.)',
      'Settlement fees paid',
    ],
    [
      'now-perp-fr',
      perpFrUsd,
      'bg-cyan-400/80',
      'bg-cyan-400/80',
      'Perp funding settled since the strategy start',
      'Perp FR',
    ],
    [
      'now-boros-fr',
      borosFrNetUsd + settlePaidUsd,
      'bg-cyan-400/50',
      'bg-cyan-400/50',
      'Boros funding settlements (gross, before settle fees, est.)',
      'Boros FR',
    ],
    [
      'now-boros-mtm',
      borosMtmUsd,
      dashedCyan,
      dashedCyan,
      'Boros rate MtM — mark value of the remaining stream (decays to 0 at maturity)',
      'Boros MTM',
    ],
  ];

  const nowSteps: Step[] = [];
  if (showChart && legs.length > 0) {
    let level = 0;
    for (const [key, delta, upCls, downCls, title, axisLabel] of nowRows) {
      if (delta === 0) continue;
      const from = level;
      level += delta;
      nowSteps.push({
        key,
        kind: key === 'now-boros-mtm' || key.endsWith('-fr') ? 'income' : 'cost-paid',
        dir: delta >= 0 ? 'up' : 'down',
        from,
        to: level,
        className: delta >= 0 ? upCls : downCls,
        title: `${title} ${delta >= 0 ? `+${fmtUsd(delta)}` : `−${fmtUsd(Math.abs(delta))}`}`,
        axisLabel,
      });
    }
    nowSteps.push({
      key: 'now-total',
      kind: 'total',
      dir: mtmUsd >= 0 ? 'up' : 'down',
      from: 0,
      to: mtmUsd,
      className: 'bg-cyan-400',
      title: `Current PnL ${fmtUsd(mtmUsd)}`,
      axisLabel: 'Now',
    });
    if (import.meta.env.DEV && Math.abs(level - mtmUsd) > 0.02) {
      // eslint-disable-next-line no-console
      console.warn('waterfall identity drift (now)', { level, mtmUsd });
    }
  }

  // --- Shared scale across BOTH plots ---------------------------------------------
  // Both charts read against ONE axis: the now line is directly comparable to
  // the profit target it is heading for.
  const { y, span, domainMin } = computeWaterfallScale([steps, nowSteps], [mtmUsd]);
  const render = showChart && span > 0;

  applyValueLabels(steps);
  applyValueLabels(nowSteps);

  if (!render || !chartsOpen) return null;

  return (
    <div
      data-waterfall
      role="img"
      aria-label={`Waterfalls: spread return ${fmtUsd(spreadReturnUsd ?? 0, 0)} minus costs → PnL ${fmtUsd(profitUsd ?? 0, 0)}; current net ${fmtUsd(mtmUsd, 0)} built from entry costs, funding, settlements and Boros MtM`}
      className="relative mt-2 pt-3"
    >
      <div className="flex items-stretch gap-6">
        <Plot
          steps={steps}
          y={y}
          span={span}
          domainMin={domainMin}
          caption="PnL by maturity"
          mtmUsd={mtmUsd}
          mtmChip={false}
        />
        {nowSteps.length > 0 && (
          <Plot
            steps={nowSteps}
            y={y}
            span={span}
            domainMin={domainMin}
            caption="current PnL (now)"
            mtmUsd={mtmUsd}
            mtmChip
          />
        )}
      </div>
    </div>
  );
}
