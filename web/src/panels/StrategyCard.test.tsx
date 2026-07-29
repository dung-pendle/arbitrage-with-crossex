/** StrategyCard is prop-driven — no msw/QueryClient needed. The canonical
 * hedged HYPE book lives in test/fixtures (mirrors the live strategy). */
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CrossexPosition } from '../api/types';
import {
  makeCrossexPosition,
  makeStrategyLeg,
  makeStrategyRollup,
} from '../test/fixtures';
import { StrategyCard } from './StrategyCard';

/** Charts default collapsed — open them via the See-more tab below the box. */
const openDetails = () => fireEvent.click(screen.getByRole('button', { name: /see more/ }));

/** The exit toggle defaults to 'Close perp at maturity' — flip a rendered
 * card to Roll over (no exit costs charged). */
const rollOver = () => fireEvent.click(screen.getByRole('radio', { name: 'Roll over' }));

const card = (
  over: Parameters<typeof makeStrategyRollup>[0] = {},
  props: Partial<React.ComponentProps<typeof StrategyCard>> = {},
) => (
  <StrategyCard
    strategy={makeStrategyRollup(over)}
    perpSource="connected-gate-account"
    {...props}
  />
);

describe('StrategyCard — hero tiers', () => {
  it('renders Fixed APR on Capital as the hero, with Capital and Profit by maturity', () => {
    render(card());
    rollOver();
    expect(screen.getByText('Fixed APR on capital')).toBeInTheDocument();
    // Net PnL by maturity 282.22 over capital 41,320, annualized across the
    // 14-day life (start → maturity): 282.22 / (41,320 × 14/365) = 17.81%.
    expect(screen.getByText('+17.81%')).toBeInTheDocument();
    expect(screen.getByText('Capital')).toBeInTheDocument();
    expect(screen.getByText('$41,320')).toBeInTheDocument();
    expect(screen.getByText(/PNL by maturity/)).toBeInTheDocument();
    // 411.81 − 119.53 − 10.06 = 282.22 → "+$282" at 0dp.
    expect(screen.getAllByText('+$282').length).toBeGreaterThan(0);
    // Current net PnL sits right of Profit by maturity: realizedPnlUsd at 0dp.
    expect(screen.getByText('Current PnL')).toBeInTheDocument();
    expect(screen.getByText('-$115')).toBeInTheDocument();
    expect(screen.getByText('hedged ✓')).toBeInTheDocument();
  });

  it('titles the card with sides, venues, and the locked spread (assumption in its tooltip)', () => {
    render(card());
    // "HYPE  long Bybit short Hyperliquid (7.07% spread)"
    expect(screen.getByText('long')).toBeInTheDocument();
    expect(screen.getByText(/Bybit/)).toBeInTheDocument();
    expect(screen.getByText('short')).toBeInTheDocument();
    expect(screen.getByText(/Hyperliquid/)).toBeInTheDocument();
    const spread = screen.getByText('(7.07% spread)');
    expect(spread).toBeInTheDocument();
    // The spread-lock assumption lives in the spread's tooltip.
    expect(
      screen.getByTitle(/Assumes 7\.07% locked on \$158\.8k since the strategy start/),
    ).toBeInTheDocument();
    // The old standalone line is gone.
    expect(screen.queryByText(/Locked spread/)).not.toBeInTheDocument();
  });

  it('folds the checked exit parts into the hero numbers by default', () => {
    render(card()); // defaults to 'Close perp at maturity' → both exit parts on
    // Profit: 282.22 − (80 + 49.16) = 153.06 → "+$153" (hero + target annotation).
    expect(screen.getAllByText('+$153').length).toBeGreaterThan(0);
    expect(screen.queryByText('+$282')).not.toBeInTheDocument();
    // The APR follows that same net PnL: 153.06 / (41,320 × 14/365) = 9.66%,
    // below the 17.81% Roll figure (which never nets the exit cost).
    expect(screen.getByText('+9.66%')).toBeInTheDocument();
    expect(screen.queryByText('+17.81%')).not.toBeInTheDocument();
  });

  it('the "now" total is the CURRENT NET — the exit mode never moves it', () => {
    // Same raw realized net (−$114.91) on Roll over AND Close; only the
    // target (profit by maturity) reacts to the exit mode.
    const off = render(card());
    rollOver();
    openDetails();
    const level = (c: HTMLElement) =>
      Number(c.querySelector('[data-segment="now-total"]')?.getAttribute('data-level'));
    expect(level(off.container)).toBeCloseTo(-114.91, 2);
    off.unmount();
    const on = render(card());
    openDetails();
    expect(level(on.container)).toBeCloseTo(-114.91, 2);
    expect(screen.getAllByTitle(/Current PnL/).length).toBeGreaterThan(0);
  });

  it('the per-position Roll over / Close-at-maturity toggle moves the hero profit', async () => {
    render(card()); // defaults to "Close perp at maturity" → profit +$153
    expect(screen.getByRole('radio', { name: 'Close perp at maturity' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getAllByText('+$153').length).toBeGreaterThan(0);
    // Roll over → no exit costs charged: back to the raw projection +$282.
    await userEvent.click(screen.getByRole('radio', { name: 'Roll over' }));
    expect(screen.getAllByText('+$282').length).toBeGreaterThan(0);
    // The assumptions live in the toggle's tooltip.
    expect(
      screen.getByTitle(/maker\+hedge close .* exit slippage equal to the entry slippage/),
    ).toBeInTheDocument();
    // Back to Close perp at maturity = both exit parts folded in at once:
    // 282.22 − 80 − 49.16 = 153.06 → "+$153".
    await userEvent.click(screen.getByRole('radio', { name: 'Close perp at maturity' }));
    expect(screen.getAllByText('+$153').length).toBeGreaterThan(0);
  });

  it('shows the strategy timeline bar (start → now → maturity) above the hero box', () => {
    const { container } = render(card());
    const bar = container.querySelector('[data-progress="maturity"]') as HTMLElement;
    expect(bar).not.toBeNull();
    // 2d elapsed of a 14d life ≈ 14.3% filled.
    const fill = [...bar.querySelectorAll('div')].find((d) => (d as HTMLElement).style.width) as HTMLElement;
    expect(parseFloat(fill.style.width)).toBeCloseTo((2 / 14) * 100, 0);
    // Start date + now marker + maturity land on the bar…
    expect(within(bar).getByText('now')).toBeInTheDocument();
    expect(within(bar).getByText(/matures \d{4}-\d{2}-\d{2} · \d+d left/)).toBeInTheDocument();
    expect(within(bar).getByTitle('Strategy start (the clock basis)')).toBeInTheDocument();
    // …and the old placements are gone (header text, "Xd in", mini bar).
    expect(screen.queryByText(/\d+d in/)).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-progress="maturity"]')).toHaveLength(1);
  });

  it('the waterfalls default collapsed; the hero stats and the see-more strip both toggle them, inside one border', async () => {
    const { container } = render(card());
    expect(container.querySelector('[data-waterfall]')).toBeNull();
    // The strip is its own button at the box's bottom edge…
    const strip = screen.getByRole('button', { name: /see more/ });
    expect(strip).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(strip);
    const waterfall = container.querySelector('[data-waterfall]');
    expect(waterfall).not.toBeNull();
    // …and the open waterfalls sit INSIDE the bordered box, ABOVE the strip.
    const open = screen.getByRole('button', { name: /see less/ });
    expect(open).toHaveAttribute('aria-expanded', 'true');
    const box = open.parentElement as HTMLElement;
    expect(box.contains(waterfall)).toBe(true);
    expect(waterfall!.compareDocumentPosition(open) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // …while the stats surface stays a click target of its own.
    const stats = screen.getByRole('button', { name: /Fixed APR on capital/ });
    expect(stats).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(stats);
    expect(container.querySelector('[data-waterfall]')).toBeNull();
  });
});

describe('StrategyCard — profit waterfall + legend', () => {
  it('draws the waterfall bars; exit columns appear only when checked', () => {
    const { container, unmount } = render(card());
    rollOver();
    openDetails();
    const segs = [...container.querySelectorAll('[data-segment]')].map((el) =>
      el.getAttribute('data-segment'),
    );
    expect(segs).toContain('spread');
    expect(segs).toContain('profit');
    expect(segs).toContain('paid-perp-fees');
    expect(segs).toContain('paid-entry-slippage');
    expect(segs).toContain('paid-boros-trade');
    expect(segs).toContain('paid-boros-settle');
    expect(segs).toContain('future-boros-settle');
    expect(segs).toContain('mtm');
    expect(segs).not.toContain('future-exit-fees');
    expect(segs).not.toContain('future-exit-slippage');
    unmount();

    const { container: c2 } = render(card());
    openDetails();
    const segs2 = [...c2.querySelectorAll('[data-segment]')].map((el) =>
      el.getAttribute('data-segment'),
    );
    expect(segs2).toContain('future-exit-fees');
    expect(segs2).toContain('future-exit-slippage');
  });

  it('the waterfall identity holds: the last cost lands exactly on the profit total', () => {
    const { container } = render(card()); // Roll over → profit 282.22
    rollOver();
    openDetails();
    const levels = [
      ...container.querySelectorAll('[data-kind^="cost"]:not([data-segment^="now-"])'),
    ].map((el) => Number(el.getAttribute('data-level')));
    expect(levels.at(-1)).toBeCloseTo(282.22, 2);
    const profit = container.querySelector('[data-segment="profit"]');
    expect(Number(profit?.getAttribute('data-level'))).toBeCloseTo(282.22, 2);
    expect(profit?.getAttribute('data-tone')).toBe('pos');
    expect(profit?.className).toContain('emerald');
  });

  it('the NOW waterfall decomposes the current net and lands exactly on it', () => {
    const { container } = render(card());
    rollOver();
    openDetails();
    // All components render from the fixture legs (perp FR, gross Boros FR,
    // settle paid, Boros MTM, perp entry, entry slip, boros entry).
    for (const key of [
      'now-perp-fr',
      'now-boros-fr',
      'now-settle-paid',
      'now-boros-mtm',
      'now-perp-entry',
      'now-entry-slip',
      'now-boros-entry',
      'now-total',
    ]) {
      expect(container.querySelector(`[data-segment="${key}"]`), key).not.toBeNull();
    }
    // Identity: the last component (Boros MtM — costs come first) lands on
    // the current net, and the end bar is the same number, drawn cyan.
    const last = container.querySelector('[data-segment="now-boros-mtm"]');
    expect(Number(last?.getAttribute('data-level'))).toBeCloseTo(-114.91, 2);
    const total = container.querySelector('[data-segment="now-total"]');
    expect(Number(total?.getAttribute('data-level'))).toBeCloseTo(-114.91, 2);
    expect(total?.getAttribute('data-tone')).toBe('neg');
    expect(total?.className).toContain('cyan');
    // Gross-settlements + settle-fee pair: gross = net + fees paid (no double count).
    // Levels after: costs (−65.01 −49.16 −3.77 −1.6 = −119.54) + perp FR 47.78
    // + gross Boros FR (−9.91 + 1.6 = −8.31) → −80.07.
    const grossFr = container.querySelector('[data-segment="now-boros-fr"]');
    expect(Number(grossFr?.getAttribute('data-level'))).toBeCloseTo(-119.54 + 47.78 - 8.31, 2);
  });

  it('a negative profit total renders rose with data-tone neg', () => {
    // Consistent fixture: 50 − paid 119.53 − future settle 10.06 = −79.59.
    const { container } = render(
      card({ spreadReturnUsd: 50, expectedPnlToMaturityUsd: 50 - 119.53 - 10.06 }),
    );
    rollOver();
    openDetails();
    const profit = container.querySelector('[data-segment="profit"]');
    expect(profit?.getAttribute('data-tone')).toBe('neg');
    expect(profit?.className).toContain('rose');
  });

  it('draws the MtM line below the zero axis for a negative current P&L', () => {
    const { container } = render(card()); // realizedPnlUsd −114.91
    rollOver();
    openDetails();
    const mtm = container.querySelector('[data-segment="mtm"]') as HTMLElement;
    expect(mtm.getAttribute('data-sign')).toBe('neg');
    const zero = container.querySelector('[data-axis="zero"]') as HTMLElement;
    expect(zero).not.toBeNull();
    expect(parseFloat(mtm.style.top)).toBeGreaterThan(parseFloat(zero.style.top));
  });

  it('omits the interior zero axis when nothing is negative (left chart alone)', () => {
    // Costs-first ordering means the now chart always dips below zero, so an
    // all-positive plot only exists without legs — which also pins that the
    // left waterfall carries NO now line of its own.
    const { container } = render(card({ legs: [], realizedPnlUsd: 50 }));
    rollOver();
    openDetails();
    expect(container.querySelector('[data-waterfall]')).not.toBeNull();
    expect(container.querySelector('[data-axis="zero"]')).toBeNull();
    expect(container.querySelector('[data-segment="mtm"]')).toBeNull();
    expect(container.querySelector('[data-segment="now-total"]')).toBeNull();
  });

  it('favorable (negative) entry slippage renders as an emerald UP step', () => {
    // Keep the fixture consistent: slippage 49.16 → −12.5 shifts paid.totalUsd
    // and the profit by the 61.66 difference.
    const base = makeStrategyRollup();
    const { container } = render(
      card({
        realizedPnlUsd: -65.75 + 12.5, // keep the now-waterfall identity exact
        expectedPnlToMaturityUsd: base.expectedPnlToMaturityUsd! + (49.16 - -12.5),
        feesUsd: {
          ...base.feesUsd,
          paid: {
            ...base.feesUsd.paid,
            perpEntrySlippageUsd: -12.5,
            totalUsd: base.feesUsd.paid.totalUsd - (49.16 - -12.5),
          },
        },
      }),
    );
    rollOver();
    openDetails();
    const step = container.querySelector('[data-segment="paid-entry-slippage"]');
    // Every component carries its amount as a label (up-steps show +; ≥$10 at 0dp).
    expect(screen.getAllByText('+$13').length).toBeGreaterThan(0);
    expect(step).not.toBeNull();
    expect(step?.getAttribute('data-dir')).toBe('up');
    expect(step?.className).toContain('emerald');
  });

  it('null exit fees never render an exit column, even with the flag on (never a guess)', () => {
    const { container } = render(
      card({
        feesUsd: {
          ...makeStrategyRollup().feesUsd,
          future: { ...makeStrategyRollup().feesUsd.future, perpExitFeesUsd: null, totalUsd: null },
        },
      }),
    );
    openDetails();
    expect(container.querySelector('[data-segment="future-exit-fees"]')).toBeNull();
    // Exit slippage is known — its column still renders.
    expect(container.querySelector('[data-segment="future-exit-slippage"]')).not.toBeNull();
  });
});

describe('StrategyCard — legs', () => {
  it('marks CrossEx perp legs with the ·CX violet chip; Boros legs stay unmarked', () => {
    render(card());
    expect(screen.getAllByTitle('via CrossEx (connected Gate account)')).toHaveLength(2);
    expect(screen.getAllByText('·CX')).toHaveLength(2);
    expect(screen.getAllByText('Boros')).toHaveLength(2);
  });

  it('a collapsed perp row expands to live Entry/Mark/Lev with actions (disabled without TradeFlow)', async () => {
    const live = new Map<string, CrossexPosition>([
      [
        'BYBIT_FUTURE_HYPE_USDT',
        makeCrossexPosition({
          symbol: 'BYBIT_FUTURE_HYPE_USDT',
          entryPrice: '60.4442',
          markPrice: '61.06',
          leverage: '20',
          maxLeverage: '50',
          upnl: '1497.24',
        }),
      ],
    ]);
    render(card({}, { livePositions: live }));
    // Legs order: BYBIT perp first (fixture order) — expand it.
    await userEvent.click(screen.getAllByLabelText('toggle details')[0]);
    expect(screen.getByText('60.4442')).toBeInTheDocument(); // entry
    expect(screen.getByText('61.06')).toBeInTheDocument(); // mark
    expect(screen.getByText('20x')).toBeInTheDocument();
    // Provider-less render → actions disabled, not hidden.
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Lev' })).toBeDisabled();
  });

  it('a perp row whose live position vanished explains itself instead of guessing', async () => {
    render(card({}, { livePositions: new Map() }));
    await userEvent.click(screen.getAllByLabelText('toggle details')[0]);
    expect(screen.getByText(/Live position not found/)).toBeInTheDocument();
  });
});

describe('StrategyCard — states', () => {
  it('matured: chip + relabeled profit + close-the-perps cue', () => {
    render(card({ secondsToMaturity: 0 }));
    expect(screen.getByText('matured')).toBeInTheDocument();
    expect(screen.getByText(/PNL \(realized at maturity\)/)).toBeInTheDocument();
    expect(screen.getByText(/close the perp legs/)).toBeInTheDocument();
  });

  it('boros-only (unhedged): the Open-the-perp-legs CTA fires the prefill handler', async () => {
    const onOpenPerpLegs = vi.fn();
    const borosOnly = makeStrategyRollup({
      hedge: 'unhedged',
      legs: makeStrategyRollup().legs.filter((l) => l.kind === 'boros'),
      realizedPnlUsd: -48.52 - 49.16, // boros legs only — keep the identity exact
    });
    render(
      <StrategyCard
        strategy={borosOnly}
        perpSource="connected-gate-account"
        onOpenPerpLegs={onOpenPerpLegs}
      />,
    );
    expect(screen.getByText('unhedged')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open the perp legs →' }));
    expect(onOpenPerpLegs).toHaveBeenCalledWith(borosOnly);
  });

  it('Boros-only mode (no Gate keys): caption invites connecting Gate keys', () => {
    render(
      <StrategyCard
        strategy={makeStrategyRollup({
          hedge: 'partial',
          legs: makeStrategyRollup().legs.filter((l) => l.kind === 'boros'),
          realizedPnlUsd: -48.52 - 49.16, // boros legs only — keep the identity exact
        })}
        perpSource={null}
      />,
    );
    expect(screen.getByText(/connect Gate keys to overlay perp legs/)).toBeInTheDocument();
  });

  it('never renders NaN for a missing mark APR and compacts sub-$1M notionals', () => {
    render(
      card({
        legs: [makeStrategyLeg({ notionalUsd: 250_000, entryApr: 0.08, markApr: undefined })],
        realizedPnlUsd: -39.24 - 49.16, // single-leg book — keep the identity exact
      }),
    );
    expect(screen.getByText('$250.0k')).toBeInTheDocument();
    const rate = screen.getByTitle('entry fixed APR → current mark APR');
    expect(rate.textContent).toBe('8.00%→—');
    expect(rate.textContent).not.toMatch(/NaN/);
  });

  it('unknown clock: no projection, no assumption caption, hero shows —', () => {
    render(
      card({
        spreadReturnUsd: null,
        expectedPnlToMaturityUsd: null,
        clockStartSec: null,
        elapsedSeconds: null,
        clockBasis: null,
      }),
    );
    expect(screen.getByTitle(/strategy start is unknown/)).toHaveTextContent('—');
    expect(screen.queryByTitle(/Assumes .* locked on/)).not.toBeInTheDocument();
  });
});

describe('StrategyCard — sizing gate', () => {
  // While the 4-leg book is being built, the headline numbers are hidden and
  // replaced by completion cues; Current PnL (real cash + MtM) stays visible.
  const buildingLegs = () => [
    makeStrategyLeg({ kind: 'perp', venue: 'BYBIT', side: 'LONG', notionalUsd: 300_000 }),
    makeStrategyLeg({ kind: 'perp', venue: 'HYPERLIQUID', side: 'SHORT', notionalUsd: 300_000 }),
    makeStrategyLeg({ kind: 'boros', venue: 'HYPERLIQUID', side: 'LONG', notionalUsd: 200_000 }),
    makeStrategyLeg({ kind: 'boros', venue: 'BYBIT', side: 'SHORT', notionalUsd: 500_000 }),
  ];

  it('hides APR / Capital / PNL and cues the Boros gap while the book is being built', () => {
    render(
      card({
        legs: buildingLegs(),
        hedgeChecks: {
          borosMatchRatio: 0.4,
          perpMatchRatio: 1,
          borosVsPerpRatio: 0.857,
          fullyHedged: false,
        },
      }),
    );
    expect(screen.queryByText('$41,320')).toBeNull(); // capital hidden
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText(/Position not fully hedged/)).toBeInTheDocument();
    expect(screen.getByText(/Boros legs 40% matched/)).toBeInTheDocument();
    // The cue names the exact gap, side, and amount — no thresholds in the copy.
    expect(screen.getByText(/add ~\$300,000 to the LONG side/)).toBeInTheDocument();
    expect(screen.getByText('Current PnL')).toBeInTheDocument();
  });

  it('cues a missing perp leg with its venue and size', () => {
    render(
      card({
        legs: [
          makeStrategyLeg({ kind: 'perp', venue: 'BYBIT', side: 'LONG', notionalUsd: 160_000 }),
          makeStrategyLeg({ kind: 'boros', venue: 'HYPERLIQUID', side: 'SHORT', notionalUsd: 160_000 }),
          makeStrategyLeg({ kind: 'boros', venue: 'BYBIT', side: 'LONG', notionalUsd: 160_000 }),
        ],
        hedgeChecks: { borosMatchRatio: 1, perpMatchRatio: 0, borosVsPerpRatio: 0.5, fullyHedged: false },
      }),
    );
    expect(screen.getByText(/Perp SHORT leg is missing — open ~\$160,000 on HYPERLIQUID/)).toBeInTheDocument();
    expect(screen.getByText(/The perp book is 50% of the Boros book — add ~\$160,000 of perp notional/)).toBeInTheDocument();
  });

  it('cues connecting Gate when the perp side is invisible', () => {
    render(
      card(
        { hedgeChecks: { borosMatchRatio: 1, perpMatchRatio: 0, borosVsPerpRatio: 0, fullyHedged: false } },
        { perpSource: null },
      ),
    );
    expect(screen.getByText(/Connect the Gate account to verify the perp side/)).toBeInTheDocument();
  });

  it('hides the title spread too — a half-built Boros book does not price one', () => {
    // A lone Boros leg is the worst case: returns.ts divides by gross/2 for the
    // canonical two-leg book, so one leg reports DOUBLE its own rate as the
    // "spread". Never print that number.
    render(
      card({
        spread: 0.1283,
        legs: [makeStrategyLeg({ kind: 'boros', venue: 'BYBIT', side: 'SHORT', notionalUsd: 160_000 })],
        hedgeChecks: { borosMatchRatio: 0, perpMatchRatio: 0, borosVsPerpRatio: 0, fullyHedged: false },
      }),
    );
    expect(screen.queryByText(/12\.83%/)).toBeNull();
    expect(screen.getByText('(— spread)')).toBeInTheDocument();
    expect(screen.queryByTitle(/Assumes .* locked on/)).toBeNull();
    expect(
      screen.getByTitle(/Hidden until the position is fully hedged — a locked spread needs a matched pair/),
    ).toBeInTheDocument();
  });

  it('shows the numbers and no note when fully hedged (the fixture default)', () => {
    render(card());
    expect(screen.getByText('$41,320')).toBeInTheDocument();
    expect(screen.getByText('(7.07% spread)')).toBeInTheDocument();
    expect(screen.queryByText(/Position not fully hedged/)).toBeNull();
  });
});
