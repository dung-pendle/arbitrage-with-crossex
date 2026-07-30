/** PositionsHome: the 4-leg box home. Ports the old StrategyPanel cases
 * (address entry → persistence → live card; degraded states; clock control)
 * and adds the box-taxonomy behaviors: perp-only boxes with cues, zero
 * strategy calls without an address, and the legacy-flag migration. */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import type { PositionsResponse, StrategyReturns } from '../api/types';
import {
  makeExposureGroup,
  makeStrategyReturns,
  makeStrategyRollup,
  versionHandler,
} from '../test/fixtures';
import { env, server } from '../test/server';
import { renderWithClient } from '../test/utils';
import { STRATEGY_STORAGE_KEY } from './HomeControls';
import { PositionsHome } from './PositionsHome';
import { SettingsDrawer } from './SettingsDrawer';
import { TrackedAddressProvider } from './trackedAddress';

const ADDR = '0xB2684Cd15b0CF17050531C51d581A9dDc365f1ef';

const mockPositions = (body: Partial<PositionsResponse> = {}) =>
  server.use(
    http.get('/api/positions', () =>
      HttpResponse.json(env<PositionsResponse>({ positions: [], exposure: [], ...body })),
    ),
  );

const mockStrategy = (body: StrategyReturns, requested?: string[]) =>
  server.use(
    http.get('/api/strategy/:address', ({ params }) => {
      requested?.push(String(params.address));
      return HttpResponse.json(env(body));
    }),
  );

describe('PositionsHome — address tracking (ported from StrategyPanel)', () => {
  it('starts with the tracking empty state and rejects a malformed address inline', async () => {
    mockPositions();
    renderWithClient(<PositionsHome />);
    expect(await screen.findByText('Track your 4-leg strategy')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('EVM address'), 'not-an-address');
    await userEvent.click(screen.getByRole('button', { name: 'Track' }));
    expect(screen.getByText(/doesn't look like an EVM address/)).toBeInTheDocument();
    expect(localStorage.getItem(STRATEGY_STORAGE_KEY)).toBeNull();
  });

  it('tracks a valid address: fetches, renders the box, and persists the new shape', async () => {
    const requested: string[] = [];
    mockPositions();
    mockStrategy(makeStrategyReturns(), requested);
    renderWithClient(<PositionsHome />);

    await userEvent.type(await screen.findByLabelText('EVM address'), ADDR);
    await userEvent.click(screen.getByRole('button', { name: 'Track' }));

    expect(await screen.findByText('hedged ✓')).toBeInTheDocument();
    expect(requested).toEqual([ADDR]);
    expect(JSON.parse(localStorage.getItem(STRATEGY_STORAGE_KEY)!)).toEqual({
      address: ADDR,
      since: null,
    });
    // The input collapsed into the watch header.
    expect(screen.getByRole('button', { name: /0xB268…f1ef/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('EVM address')).not.toBeInTheDocument();
  });

  it('auto-fetches on mount from the persisted address', async () => {
    localStorage.setItem(STRATEGY_STORAGE_KEY, JSON.stringify({ address: ADDR }));
    mockPositions();
    mockStrategy(makeStrategyReturns());
    renderWithClient(<PositionsHome />);
    expect(await screen.findByText('hedged ✓')).toBeInTheDocument();
  });

  it('the address chip opens Settings — there is no inline editor any more', async () => {
    localStorage.setItem(STRATEGY_STORAGE_KEY, JSON.stringify({ address: ADDR }));
    mockPositions();
    mockStrategy(makeStrategyReturns());
    const onOpenSettings = vi.fn();
    renderWithClient(
      <TrackedAddressProvider onOpenSettings={onOpenSettings}>
        <PositionsHome />
      </TrackedAddressProvider>,
    );
    await screen.findByText('hedged ✓');

    await userEvent.click(screen.getByRole('button', { name: /0xB268…f1ef/ }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    // The chip no longer swaps the boxes out for a form.
    expect(screen.queryByLabelText('EVM address')).not.toBeInTheDocument();
    expect(screen.getByText('hedged ✓')).toBeInTheDocument();
  });

  it('never shows the previous address’s data after switching to a new address', async () => {
    localStorage.setItem(STRATEGY_STORAGE_KEY, JSON.stringify({ address: ADDR }));
    const OTHER = '0x' + 'cd'.repeat(20);
    mockPositions();
    server.use(
      http.get('/api/credentials', () =>
        HttpResponse.json(env({ configured: true, keyMasked: 'gk_****abcd' })),
      ),
      versionHandler(), // the drawer's About section reads /api/version
      http.get('/api/strategy/:address', async ({ params }) => {
        if (String(params.address) === ADDR)
          return HttpResponse.json(env(makeStrategyReturns()));
        await new Promise((r) => setTimeout(r, 150));
        return HttpResponse.json(env(makeStrategyReturns({ strategies: [] })));
      }),
    );
    // Switching the address is a Settings action now — drive the real surface,
    // sharing one tracked-address store with the boxes.
    renderWithClient(
      <>
        <SettingsDrawer open onClose={() => {}} />
        <PositionsHome />
      </>,
    );
    expect(await screen.findByText('hedged ✓')).toBeInTheDocument();

    const input = screen.getByLabelText('EVM address');
    await userEvent.clear(input);
    await userEvent.type(input, OTHER);
    await userEvent.click(screen.getByRole('button', { name: 'Update' }));

    // While the new address loads, the OLD box must NOT be attributed to it.
    expect(screen.queryByText('hedged ✓')).not.toBeInTheDocument();
    expect(await screen.findByText('No positions')).toBeInTheDocument();
  });
});

describe('PositionsHome — degraded states', () => {
  it('shows the no-positions empty state and surfaces global warnings', async () => {
    localStorage.setItem(STRATEGY_STORAGE_KEY, JSON.stringify({ address: ADDR }));
    mockPositions();
    mockStrategy(
      makeStrategyReturns({
        strategies: [],
        warnings: ['Gate credentials are not configured — showing the Boros legs only (connect Gate keys to overlay perp legs 1–2).'],
      }),
    );
    renderWithClient(<PositionsHome />);
    expect(await screen.findByText('No positions')).toBeInTheDocument();
    expect(screen.getByText(/Gate credentials are not configured/)).toBeInTheDocument();
  });

  it('surfaces a strategy load error with retry; perp boxes still render, never the Boros cue', async () => {
    localStorage.setItem(STRATEGY_STORAGE_KEY, JSON.stringify({ address: ADDR }));
    mockPositions({ exposure: [makeExposureGroup({ base: 'ETH' })] });
    let fail = true;
    server.use(
      http.get('/api/strategy/:address', () => {
        if (fail) {
          return HttpResponse.json(
            { ok: false, error: { category: 'network', message: 'Boros API unreachable', retryable: true } },
            { status: 502 },
          );
        }
        return HttpResponse.json(env(makeStrategyReturns()));
      }),
    );
    renderWithClient(<PositionsHome />);
    expect(await screen.findByText("Couldn't load Boros strategy data")).toBeInTheDocument();
    // The ETH pair still shows as a box — with a neutral note, NOT the
    // "execute the fixed legs on Boros" claim (the feed never settled).
    expect(screen.getByText('ETH')).toBeInTheDocument();
    expect(screen.getByText(/matching Boros legs…/)).toBeInTheDocument();
    expect(screen.queryByText(/Execute the fixed legs on Boros/)).not.toBeInTheDocument();

    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('hedged ✓')).toBeInTheDocument());
  });

  it('keeps showing the last good box when a background poll fails (stale, not blanked)', async () => {
    localStorage.setItem(STRATEGY_STORAGE_KEY, JSON.stringify({ address: ADDR }));
    mockPositions();
    let fail = false;
    server.use(
      http.get('/api/strategy/:address', () =>
        fail
          ? HttpResponse.json(
              { ok: false, error: { category: 'network', message: 'blip', retryable: true } },
              { status: 502 },
            )
          : HttpResponse.json(env(makeStrategyReturns())),
      ),
    );
    renderWithClient(<PositionsHome />);
    expect(await screen.findByText('hedged ✓')).toBeInTheDocument();

    fail = true;
    await userEvent.click(screen.getByRole('button', { name: /⟳/ })); // manual refetch
    await waitFor(() => expect(screen.getByText(/stale .* retrying/)).toBeInTheDocument());
    expect(screen.getByText('hedged ✓')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load Boros strategy data")).not.toBeInTheDocument();
  });
});

describe('PositionsHome — box taxonomy & cues', () => {
  it('without an address: perp pairs render as boxes with the add-address cue and ZERO strategy calls', async () => {
    const requested: string[] = [];
    mockPositions({
      exposure: [
        makeExposureGroup({ base: 'ETH' }),
        makeExposureGroup({
          base: 'SOL',
          singleLeg: true,
          neutral: false,
          legs: [{ symbol: 'BINANCE_FUTURE_SOL_USDT', exchange: 'BINANCE', quote: 'USDT', side: 'LONG', qty: 2, value: 300 }],
        }),
      ],
    });
    mockStrategy(makeStrategyReturns(), requested);
    renderWithClient(<PositionsHome />);

    expect(await screen.findByText('ETH')).toBeInTheDocument();
    // Pair box: neutral badge + add-address cue; stray box: unpaired-leg chip.
    expect(screen.getByText('neutral ✓')).toBeInTheDocument();
    expect(screen.getByText('unpaired leg')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add Boros address' }).length).toBeGreaterThan(0);
    expect(requested).toHaveLength(0);
  });

  it('the add-address cue opens the form lazily and tracking from it stores the address', async () => {
    mockPositions({ exposure: [makeExposureGroup({ base: 'ETH' })] });
    mockStrategy(makeStrategyReturns({ strategies: [] }));
    renderWithClient(<PositionsHome />);
    await screen.findByText('ETH');

    expect(screen.queryByLabelText('EVM address')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add Boros address' }));
    await userEvent.type(screen.getByLabelText('EVM address'), ADDR);
    await userEvent.click(screen.getByRole('button', { name: 'Track' }));
    expect(JSON.parse(localStorage.getItem(STRATEGY_STORAGE_KEY)!).address).toBe(ADDR);
  });

  it('with a settled feed: a perp-only box carries the execute-on-Boros link-out', async () => {
    localStorage.setItem(STRATEGY_STORAGE_KEY, JSON.stringify({ address: ADDR }));
    mockPositions({ exposure: [makeExposureGroup({ base: 'ETH' })] });
    mockStrategy(makeStrategyReturns()); // HYPE strategy — ETH stays perp-only
    renderWithClient(<PositionsHome />);

    expect(await screen.findByText('hedged ✓')).toBeInTheDocument();
    expect(screen.getByText(/No Boros position found for ETH/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Execute the fixed legs on Boros/ });
    expect(link).toHaveAttribute('href', 'https://boros.finance');
  });

  it('a rollup base consumes its exposure group (no duplicate perp-only box)', async () => {
    localStorage.setItem(STRATEGY_STORAGE_KEY, JSON.stringify({ address: ADDR }));
    mockPositions({
      exposure: [
        makeExposureGroup({
          base: 'HYPE',
          legs: [
            { symbol: 'BYBIT_FUTURE_HYPE_USDT', exchange: 'BYBIT', quote: 'USDT', side: 'LONG', qty: 1, value: 100 },
            { symbol: 'HYPERLIQUID_FUTURE_HYPE_USDC', exchange: 'HYPERLIQUID', quote: 'USDC', side: 'SHORT', qty: 1, value: 100 },
          ],
        }),
      ],
    });
    mockStrategy(makeStrategyReturns());
    renderWithClient(<PositionsHome />);
    expect(await screen.findByText('hedged ✓')).toBeInTheDocument();
    // No perp-only cue for HYPE — it lives inside the strategy box.
    expect(screen.queryByText(/No Boros position found for HYPE/)).not.toBeInTheDocument();
  });

  it('ports the exposure chips: signed venue chips with quote sub-labels + Close both', async () => {
    mockPositions({
      exposure: [
        makeExposureGroup({
          base: 'BTC',
          legs: [
            { symbol: 'KRAKEN_FUTURE_BTC_USD', exchange: 'KRAKEN', quote: 'USD', side: 'LONG', qty: 0.1, value: 9387 },
            { symbol: 'HYPERLIQUID_FUTURE_BTC_USDC', exchange: 'HYPERLIQUID', quote: 'USDC', side: 'SHORT', qty: 0.1, value: 9389 },
          ],
          longValue: 9387,
          shortValue: 9389,
          netValue: -2,
          grossValue: 18776,
        }),
      ],
    });
    renderWithClient(<PositionsHome />);
    expect(await screen.findByText(/\+KRAKEN \$9,387/)).toBeInTheDocument();
    expect(screen.getByText(/−HYPERLIQUID \$9,389/)).toBeInTheDocument();
    expect(screen.getByText('neutral ✓')).toBeInTheDocument();
    // renderWithClient mounts TradeFlowProvider → the hold-button renders.
    expect(screen.getByRole('button', { name: 'Close both' })).toBeInTheDocument();
  });
});

describe('PositionsHome — clock & exit flags', () => {
  it('lets the user edit the strategy start from the timeline (sent as ?since=) and reset it', async () => {
    localStorage.setItem(STRATEGY_STORAGE_KEY, JSON.stringify({ address: ADDR }));
    mockPositions();
    const sinceSeen: Array<string | null> = [];
    server.use(
      http.get('/api/strategy/:address', ({ request }) => {
        sinceSeen.push(new URL(request.url).searchParams.get('since'));
        return HttpResponse.json(env(makeStrategyReturns()));
      }),
    );
    renderWithClient(<PositionsHome />);
    await screen.findByText('hedged ✓');
    expect(sinceSeen).toEqual([null]); // default: no override

    // The timeline labels the start as the Boros open, with an edit affordance.
    expect(screen.getByText('Boros position open')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Edit the strategy start' }));
    const dt = screen.getByLabelText('APR clock start');
    fireEvent.change(dt, { target: { value: '2026-07-01T10:30' } });
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    const expected = String(Math.floor(new Date('2026-07-01T10:30').getTime() / 1000));
    await waitFor(() => expect(sinceSeen.at(-1)).toBe(expected));
    expect(JSON.parse(localStorage.getItem(STRATEGY_STORAGE_KEY)!)).toEqual({
      address: ADDR,
      since: Number(expected),
    });
    // With an override the timeline label flips to "custom start".
    expect(await screen.findByText('custom start')).toBeInTheDocument();

    // Default restores the Boros-open anchor.
    await userEvent.click(screen.getByRole('button', { name: 'Edit the strategy start' }));
    await userEvent.click(screen.getByRole('button', { name: 'Default' }));
    await waitFor(() => expect(sinceSeen.at(-1)).toBeNull());
  });



  it('shows the totals strip only when more than one strategy is running', async () => {
    localStorage.setItem(STRATEGY_STORAGE_KEY, JSON.stringify({ address: ADDR }));
    mockPositions();
    mockStrategy(
      makeStrategyReturns({
        strategies: [makeStrategyRollup(), makeStrategyRollup({ base: 'BTC' })],
      }),
    );
    renderWithClient(<PositionsHome />);
    expect(await screen.findByText(/Boros-tracked totals/)).toBeInTheDocument();
  });
});
