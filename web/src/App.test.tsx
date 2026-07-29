/** Left-pane shell: one scrollable section column + sticky section nav.
 * Positions is always visible; Balances/Open Orders/Trades/Fees collapse,
 * stay mounted while hidden, and persist their state to localStorage. */
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import type { OpenOrder, TradesResponse, VenueFees } from './api/types';
import { SECTIONS_STORAGE_KEY } from './components/CollapsibleSection';
import {
  baseHandlers,
  makeOpportunitiesResult,
  makeOpportunityGroup,
  makeOpportunityLeg,
  makeOpportunityPair,
  opportunitiesHandler,
} from './test/fixtures';
import { MockIntersectionObserver } from './test/intersectionObserver';
import { env, server } from './test/server';
import { renderWithClient } from './test/utils';

function order(id: string): OpenOrder {
  return {
    orderId: id,
    text: `web_${id}`,
    state: 'OPEN',
    symbol: 'GATE_FUTURE_ETH_USDT',
    side: 'BUY',
    type: 'LIMIT',
    timeInForce: 'GTC',
    qty: '1',
    price: '2500',
    executedQty: '0',
    executedAvgPrice: '',
    reduceOnly: false,
    createTime: 1_751_500_000,
  };
}

/** Everything a configured App shell fetches on mount. */
function mockApp({ orders = [] as OpenOrder[] } = {}) {
  server.use(
    http.get('/api/credentials', () =>
      HttpResponse.json(env({ configured: true, keyMasked: 'gk_****abcd' })),
    ),
    ...baseHandlers(),
    opportunitiesHandler(makeOpportunitiesResult()),
    http.get('/api/orders/open', () => HttpResponse.json(env(orders))),
    http.get('/api/trades', () =>
      HttpResponse.json(env<TradesResponse>({ trades: [], page: 1, limit: 100, hasMore: false })),
    ),
    http.get('/api/fees', () => HttpResponse.json(env<VenueFees[]>([]))),
    http.get('/api/baskets', () => HttpResponse.json(env([]))),
  );
}

/** The section HEADER button for a title (the nav has same-named buttons). */
function sectionButton(name: RegExp): HTMLElement {
  const nav = screen.getByRole('navigation', { name: 'Sections' });
  const btn = screen.getAllByRole('button', { name }).find((b) => !nav.contains(b));
  expect(btn).toBeDefined();
  return btn!;
}

async function renderApp() {
  const result = renderWithClient(<App />);
  await screen.findByRole('navigation', { name: 'Sections' });
  return result;
}

afterEach(() => vi.restoreAllMocks());

describe('App section shell', () => {
  it('defaults: Balances expanded; Open Orders/Trades/Fees collapsed but mounted', async () => {
    mockApp();
    await renderApp();

    // The 4-leg home base is the Positions section itself; with no tracked
    // address (and no positions) it shows the address empty state and makes NO
    // /api/strategy request.
    expect(screen.getByText('Track your 4-leg strategy')).toBeInTheDocument();

    expect(sectionButton(/^Balances/)).toHaveAttribute('aria-expanded', 'true');
    expect(sectionButton(/^Open Orders/)).toHaveAttribute('aria-expanded', 'false');
    expect(sectionButton(/^Trades/)).toHaveAttribute('aria-expanded', 'false');
    expect(sectionButton(/^Fees/)).toHaveAttribute('aria-expanded', 'false');

    // Collapsed content is mounted (data loads) yet hidden.
    const feesHeading = await screen.findByText(/Your CrossEx fee rates/);
    expect(feesHeading).not.toBeVisible();

    // Positions is the non-collapsible home base — heading, no toggle button.
    expect(screen.getByRole('heading', { name: 'Positions' })).toBeVisible();
  });

  it('leads with Opportunities — first in the nav and expanded above Positions', async () => {
    mockApp();
    await renderApp();
    const nav = screen.getByRole('navigation', { name: 'Sections' });

    expect(within(nav).getAllByRole('button')[0]).toHaveAccessibleName(/^Opportunities/);
    expect(sectionButton(/^Opportunities/)).toHaveAttribute('aria-expanded', 'true');
    // The panel itself renders inside the section (its cards land once the
    // /api/opportunities fixture resolves).
    const content = document.getElementById('opportunities-content')!;
    expect(
      await within(content).findByRole('button', { name: 'Execute it' }),
    ).toBeInTheDocument();
  });

  it('persists toggles across unmount + remount via localStorage', async () => {
    mockApp();
    const first = await renderApp();

    // Collapse the default-open section and expand a default-collapsed one.
    await userEvent.click(sectionButton(/^Balances/));
    await userEvent.click(sectionButton(/^Trades/));
    expect(sectionButton(/^Balances/)).toHaveAttribute('aria-expanded', 'false');
    expect(sectionButton(/^Trades/)).toHaveAttribute('aria-expanded', 'true');
    expect(JSON.parse(localStorage.getItem(SECTIONS_STORAGE_KEY)!)).toMatchObject({
      balances: false,
      trades: true,
    });
    first.unmount();

    await renderApp();
    expect(sectionButton(/^Balances/)).toHaveAttribute('aria-expanded', 'false');
    expect(sectionButton(/^Trades/)).toHaveAttribute('aria-expanded', 'true');
    expect(sectionButton(/^Fees/)).toHaveAttribute('aria-expanded', 'false'); // untouched default
  });

  it('nav click on a collapsed section expands it and smooth-scrolls to it', async () => {
    mockApp();
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView');
    await renderApp();
    const nav = screen.getByRole('navigation', { name: 'Sections' });

    expect(sectionButton(/^Fees/)).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(within(nav).getByRole('button', { name: /^Fees/ }));

    expect(sectionButton(/^Fees/)).toHaveAttribute('aria-expanded', 'true');
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect((scrollSpy.mock.contexts[0] as Element).id).toBe('fees');
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('shows the live order count in nav AND header while Open Orders is collapsed', async () => {
    localStorage.setItem(SECTIONS_STORAGE_KEY, JSON.stringify({ orders: false }));
    mockApp({ orders: [order('1'), order('2')] });
    await renderApp();
    const nav = screen.getByRole('navigation', { name: 'Sections' });

    const headerBtn = sectionButton(/^Open Orders/);
    expect(headerBtn).toHaveAttribute('aria-expanded', 'false');

    // Badge lands in both places once the (still-mounted) query resolves.
    await waitFor(() =>
      expect(
        within(within(nav).getByRole('button', { name: /Open Orders/ })).getByText('2'),
      ).toBeInTheDocument(),
    );
    expect(within(headerBtn).getByText('2')).toBeInTheDocument();

    // The panel itself is mounted while hidden — its rows exist in the DOM.
    const content = document.getElementById('orders-content')!;
    expect(await within(content).findAllByText('Cancel')).toHaveLength(2);
  });

  it('highlights the topmost visible section via IntersectionObserver', async () => {
    mockApp();
    await renderApp();
    const nav = screen.getByRole('navigation', { name: 'Sections' });

    const io = MockIntersectionObserver.instances.at(-1)!;
    expect(io.elements.size).toBe(6); // observing all six section anchors

    act(() =>
      io.trigger([
        { target: document.getElementById('positions')!, isIntersecting: false },
        { target: document.getElementById('trades')!, isIntersecting: true },
        { target: document.getElementById('fees')!, isIntersecting: true },
      ]),
    );

    // Trades and Fees intersect — the topmost (Trades) wins.
    expect(within(nav).getByRole('button', { name: /^Trades/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(within(nav).getByRole('button', { name: /^Positions/ })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('falls back to the first-run view (not the trading panels) when /credentials errors', async () => {
    // A persistent /credentials failure must NOT leak the live trading UI —
    // `data` is undefined, so we cannot confirm the account is configured.
    server.use(
      http.get('/api/credentials', () =>
        HttpResponse.json(
          { ok: false, error: { category: 'unknown', message: 'credentials service down', retryable: true } },
          { status: 503 },
        ),
      ),
      ...baseHandlers(),
      opportunitiesHandler(makeOpportunitiesResult()),
      http.get('/api/orders/open', () => HttpResponse.json(env<OpenOrder[]>([]))),
    );
    renderWithClient(<App />);

    expect(await screen.findByRole('complementary', { name: 'Setup guide' })).toBeInTheDocument();
    // Neither the section nav nor the Positions home base is rendered.
    expect(screen.queryByRole('navigation', { name: 'Sections' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Positions' })).not.toBeInTheDocument();
  });

  it('replaces the trading shell (nav included) with opportunities + guide when unconfigured', async () => {
    server.use(
      http.get('/api/credentials', () =>
        HttpResponse.json(env({ configured: false, keyMasked: null })),
      ),
      ...baseHandlers(),
      opportunitiesHandler(makeOpportunitiesResult()),
      http.get('/api/orders/open', () => HttpResponse.json(env<OpenOrder[]>([]))),
    );
    renderWithClient(<App />);

    expect(await screen.findByRole('complementary', { name: 'Setup guide' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Live fixed rates, up for grabs' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Sections' })).not.toBeInTheDocument();
    // The order ticket only exists once credentials do.
    expect(screen.queryByRole('complementary', { name: 'Order ticket' })).not.toBeInTheDocument();
  });

  it('unconfigured: shows degraded live opportunities and Execute nudges the API-key form', async () => {
    // The unconfigured wire shape: legs without CrossEx symbols (no keys → no
    // mapping) but APRs still priced via the simulated VIP tier, the server's
    // fee-simulation warning on top. (A group with NO priced APR would be
    // filtered out of the list entirely.)
    const degraded = makeOpportunitiesResult({
      groups: [
        makeOpportunityGroup({
          pairs: [
            makeOpportunityPair({
              shortLeg: makeOpportunityLeg({ crossexSymbol: '' }),
              longLeg: makeOpportunityLeg({
                marketId: 102,
                venue: 'BINANCE',
                crossexVenue: 'BINANCE',
                crossexSymbol: '',
                midApr: 0.045,
                execApr: 0.0455,
              }),
            }),
          ],
        }),
      ],
      warnings: [
        'Perp fees assume the VIP 0 Gate CrossEx schedule — everything else here is live. Your real rates follow your Gate VIP tier; connect Gate keys to price from them.',
      ],
    });
    server.use(
      http.get('/api/credentials', () =>
        HttpResponse.json(env({ configured: false, keyMasked: null })),
      ),
      ...baseHandlers(),
      opportunitiesHandler(degraded),
      http.get('/api/orders/open', () => HttpResponse.json(env<OpenOrder[]>([]))),
    );
    renderWithClient(<App />);

    expect(await screen.findByText(/Perp fees assume the VIP 0 Gate CrossEx schedule/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fund Gate' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Execute' })).toBeInTheDocument();

    // The VIP simulator only exists while unconfigured — and the knobs now live
    // behind the collapsed assumptions strip, so open it first.
    await userEvent.click(screen.getByRole('button', { name: /with these assumptions/ }));
    expect(screen.getByLabelText('Gate VIP tier')).toBeInTheDocument();

    // Symbols are expectedly absent — the button stays enabled as the guide's nudge.
    const execute = screen.getByRole('button', { name: 'Execute it' });
    expect(execute).toBeEnabled();
    await userEvent.click(execute);
    await waitFor(() => expect(screen.getByLabelText('API key')).toHaveFocus());
    // The guide flashes the key form's ring on the same nonce bump.
    expect(document.querySelector('.flash-ring')).not.toBeNull();
  });
});
