import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { ActionInput } from '../api/types';
import { baseHandlers, makeDealView, previewFor } from '../test/fixtures';
import { env, server } from '../test/server';
import { renderWithClient } from '../test/utils';
import { DealModal } from './DealModal';
import { TradeFlowProvider } from './TradeFlow';

function renderModal(view = makeDealView()) {
  server.use(
    // Specific view FIRST — msw matches in order, and baseHandlers carries a
    // default /api/deals/:id that would otherwise shadow it.
    http.get('/api/deals/:id', () => HttpResponse.json(env(view))),
    ...baseHandlers(),
  );
  return renderWithClient(
    <TradeFlowProvider>
      <DealModal dealId={view.pair.id} onClose={() => {}} />
    </TradeFlowProvider>,
  );
}

describe('DealModal', () => {
  it('OPENING: shows the mode strip and the maker controls', async () => {
    renderModal(
      makeDealView({
        pair: { mode: 'OPENING', deadlineAt: Date.now() + 120_000 },
        projection: { aFilled: '0.02', bFilled: '0.02' },
      }),
    );
    expect(await screen.findByText(/maker resting/)).toBeInTheDocument();
    expect(screen.getByText(/until convert/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Convert now' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Re-peg to touch' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled();
  });

  it('OPENING: draws the live book graph — OUR limit, the hedge market fill, and the leg captions', async () => {
    const previewCalls: ActionInput[][] = [];
    server.use(
      http.get('/api/books/:symbol', ({ params }) =>
        HttpResponse.json(
          env({ symbol: String(params.symbol), bestBid: 2499, bestAsk: 2501, mid: 2500 }),
        ),
      ),
      http.post('/api/preview', async ({ request }) => {
        const { actions } = (await request.json()) as { actions: ActionInput[] };
        previewCalls.push(actions);
        return HttpResponse.json(
          env({
            previews: actions.map((a, i) =>
              previewFor(a, {
                index: i,
                // A SELL fills below the touch — the hedge leg's estimate.
                fillEstimate: {
                  qty: '0.05',
                  avgPrice: 2497.4,
                  worstPrice: 2497,
                  midPrice: 2500,
                  slippagePct: 0.06,
                  source: 'venue-orderbook',
                  confidence: 'high',
                  venue: 'BINANCE',
                },
              }),
            ),
          }),
        );
      }),
    );
    renderModal(
      makeDealView({
        pair: { mode: 'OPENING' },
        projection: {
          makerOrder: {
            pairId: 'd1',
            leg: 'A',
            seq: 1,
            clientId: 'c1',
            kind: 'maker',
            side: 'BUY',
            qty: '0.05',
            price: '2497',
            tif: 'poc',
            state: 'OPEN',
            venueOrderId: 'v1',
            cumQty: '0',
            closeReason: null,
            cancelRequested: 0,
            quarantinedStatus: null,
    venueReason: null,
            createdAt: Date.now(),
            resolvedAt: null,
          },
        },
      }),
    );
    await screen.findByText(/maker resting/);
    // The maker (GATE, BUY → long column) carries the resting limit at the
    // LIVE order's price; the hedge column shows only its book.
    await waitFor(() => expect(document.querySelector('[data-price-graph]')).not.toBeNull());
    await waitFor(() =>
      expect(
        document.querySelector('[data-leg="long"] [data-mark="limit"]')?.getAttribute('data-price'),
      ).toBe('2497'),
    );
    // The limit tag carries the order's price AND size (no legs table remains
    // to spell them out).
    expect(
      document.querySelector('[data-leg="long"] [data-mark="limit"]')?.textContent,
    ).toContain('limit 2497 × 0.05');
    expect(document.querySelector('[data-leg="short"] [data-mark="limit"]')).toBeNull();
    expect(document.querySelector('[data-leg="short"] [data-mark="bid"]')?.getAttribute('data-price')).toBe('2499');
    // The hedge column carries its market-order simulation — the market hedge
    // Leg B fires to cover everything Leg A acquires (target − reserved),
    // matched back by symbol. The maker column shows NO market estimate: the
    // deal's whole point is resting at the limit.
    await waitFor(
      () =>
        expect(
          document.querySelector('[data-leg="short"] [data-mark="fill"]')?.getAttribute('data-price'),
        ).toBe('2497.4'),
      { timeout: 4000 },
    );
    expect(document.querySelector('[data-leg="long"] [data-mark="fill"]')).toBeNull();
    expect(previewCalls.at(-1)).toHaveLength(1);
    expect(previewCalls.at(-1)?.[0]).toMatchObject({
      kind: 'open-market',
      symbol: 'BINANCE_FUTURE_ETH_USDT',
      side: 'SELL',
      qty: '0.05',
    });
    // Each column names its leg's role under the venue caption.
    expect(screen.getByText('Leg A — limit order')).toBeInTheDocument();
    expect(screen.getByText('Leg B — market hedge after every fill')).toBeInTheDocument();
  });

  it('OPENING: the hedge qty is target − reserved, float dust trimmed off the wire', async () => {
    const previewCalls: ActionInput[][] = [];
    server.use(
      http.get('/api/books/:symbol', ({ params }) =>
        HttpResponse.json(
          env({ symbol: String(params.symbol), bestBid: 2499, bestAsk: 2501, mid: 2500 }),
        ),
      ),
      http.post('/api/preview', async ({ request }) => {
        const { actions } = (await request.json()) as { actions: ActionInput[] };
        previewCalls.push(actions);
        return HttpResponse.json(
          env({
            previews: actions.map((a, i) =>
              previewFor(a, {
                index: i,
                fillEstimate: {
                  qty: '0.03',
                  avgPrice: 2497.4,
                  worstPrice: 2497,
                  midPrice: 2500,
                  slippagePct: 0.06,
                  source: 'venue-orderbook',
                  confidence: 'high',
                  venue: 'BINANCE',
                },
              }),
            ),
          }),
        );
      }),
    );
    renderModal(
      makeDealView({
        pair: { mode: 'OPENING' },
        // The hedge still owes target − bReserved = 0.05 − 0.02, which floats
        // to 0.030000000000000002 — the wire must carry '0.03' EXACTLY.
        projection: { aFilled: '0.05', bReserved: '0.02', residualA: '0', unhedged: '0.03' },
      }),
    );
    await waitFor(() => expect(document.querySelector('[data-price-graph]')).not.toBeNull());
    await waitFor(
      () =>
        expect(
          document.querySelector('[data-leg="short"] [data-mark="fill"]')?.getAttribute('data-price'),
        ).toBe('2497.4'),
      { timeout: 4000 },
    );
    expect(document.querySelector('[data-leg="long"] [data-mark="fill"]')).toBeNull();
    expect(previewCalls.at(-1)).toHaveLength(1);
    expect(previewCalls.at(-1)?.[0]).toMatchObject({
      kind: 'open-market',
      symbol: 'BINANCE_FUTURE_ETH_USDT',
      side: 'SELL',
      qty: '0.03',
    });
  });

  it('OPENING single-leg (no hedge): the book graph renders with no preview at all', async () => {
    const previewCalls: ActionInput[][] = [];
    server.use(
      http.get('/api/books/:symbol', ({ params }) =>
        HttpResponse.json(
          env({ symbol: String(params.symbol), bestBid: 2499, bestAsk: 2501, mid: 2500 }),
        ),
      ),
      http.post('/api/preview', async ({ request }) => {
        const { actions } = (await request.json()) as { actions: ActionInput[] };
        previewCalls.push(actions);
        return HttpResponse.json(
          env({ previews: actions.map((a, i) => previewFor(a, { index: i })) }),
        );
      }),
    );
    renderModal(makeDealView({ pair: { mode: 'OPENING', b: null } }));
    await waitFor(() => expect(document.querySelector('[data-price-graph]')).not.toBeNull());
    await waitFor(() =>
      expect(
        document.querySelector('[data-leg="long"] [data-mark="limit"]')?.getAttribute('data-price'),
      ).toBe('2500'),
    );
    // Past the 400ms preview debounce: with no hedge leg there is nothing to
    // simulate, so no POST may ever fire.
    await new Promise((r) => setTimeout(r, 700));
    expect(previewCalls).toHaveLength(0);
    expect(document.querySelector('[data-mark="fill"]')).toBeNull();
  });

  it('re-pegs to a custom price, snapped to the venue tick', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    renderModal(); // default OPENING deal, tick 0.01
    server.use(
      http.post('/api/deals/:id/:cmd', async ({ params, request }) => {
        bodies.push({ cmd: String(params.cmd), ...((await request.json()) as object) });
        return HttpResponse.json(env({ id: String(params.id) }));
      }),
    );

    const input = await screen.findByLabelText('Custom re-peg price');
    const btn = screen.getByRole('button', { name: 'Re-peg to price' });
    // No parseable positive price yet → disabled.
    expect(btn).toBeDisabled();
    fireEvent.change(input, { target: { value: '-5' } });
    expect(btn).toBeDisabled();

    // An off-tick price goes out snapped to the 0.01 tick.
    fireEvent.change(input, { target: { value: '2497.137' } });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    await waitFor(() => expect(bodies).toEqual([{ cmd: 'repeg', price: '2497.14' }]));
    // The input clears once the command lands.
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('Convert now POSTs the command', async () => {
    const cmds: string[] = [];
    renderModal();
    server.use(
      http.post('/api/deals/:id/:cmd', ({ params }) => {
        cmds.push(String(params.cmd));
        return HttpResponse.json(env({ id: String(params.id) }));
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Convert now' }));
    await waitFor(() => expect(cmds).toEqual(['convert']));
  });

  it('HALTED: shows the halt reason and the resume control; unhedged is surfaced', async () => {
    renderModal(
      makeDealView({
        pair: { mode: 'HALTED', haltReason: 'hedge failed 3x' },
        projection: { aFilled: '0.05', bFilled: '0.02', unhedged: '0.03' },
      }),
    );
    expect(await screen.findByText(/HALTED — operator needed — hedge failed 3x/)).toBeInTheDocument();
    expect(screen.getByText(/unhedged/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Resume/ })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Convert now' })).not.toBeInTheDocument();
  });

  it('DONE: renders the honest terminal report, no controls', async () => {
    renderModal(
      makeDealView({
        pair: {
          mode: 'DONE',
          reportJson: JSON.stringify({ aFilled: '0.05', bFilled: '0.04', unhedged: '0.01', reason: 'stopped' }),
        },
        projection: { aFilled: '0.05', bFilled: '0.04', unhedged: '0.01' },
      }),
    );
    expect(await screen.findByText('Report')).toBeInTheDocument();
    expect(screen.getByText(/unhedged dust/)).toBeInTheDocument();
    expect(screen.getByText('stopped')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
    // An ordinary stop must NOT wear the crossing-limit explanation.
    expect(screen.queryByText(/through the market/)).not.toBeInTheDocument();
  });

  it('DONE by a crossing limit: explains the failure and points at the order form', async () => {
    renderModal(
      makeDealView({
        pair: {
          mode: 'DONE',
          reportJson: JSON.stringify({
            aFilled: '0',
            bFilled: '0',
            unhedged: '0',
            reason:
              'the limit price kept crossing the market — the venue rejected the post-only maker 5 times in a row',
          }),
        },
        projection: { aFilled: '0', bFilled: '0', unhedged: '0' },
      }),
    );
    expect(
      await screen.findByText(/the limit price was already through the market/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Try again from the order form with a fresh limit price/)).toBeInTheDocument();
  });

  it('DONE: labels each leg long/short with its venue + price, and the slippage', async () => {
    renderModal(
      makeDealView({
        pair: {
          mode: 'DONE',
          // Leg A = maker BUY on Gate @ 2500 (long/limit); leg B = taker SELL on
          // Binance @ 2503.75 (short/hedge). Basis = sell − buy = +3.75 →
          // favorable; % of the 2501.875 mid.
          reportJson: JSON.stringify({
            aFilled: '0.05', bFilled: '0.05', unhedged: '0', reason: 'filled',
            aAvgFill: '2500', bAvgFill: '2503.75',
          }),
        },
        projection: { aFilled: '0.05', bFilled: '0.05', unhedged: '0' },
      }),
    );
    expect(await screen.findByText('Report')).toBeInTheDocument();
    // Each leg reads: role · direction · venue · @ price.
    expect(screen.getByText('maker')).toBeInTheDocument();
    expect(screen.getByText('taker')).toBeInTheDocument();
    expect(screen.getByText('long')).toBeInTheDocument(); // the BUY (maker) leg
    expect(screen.getByText('short')).toBeInTheDocument(); // the SELL (taker) leg
    expect(screen.getByText('Gate')).toBeInTheDocument(); // maker venue
    expect(screen.getByText('Binance')).toBeInTheDocument(); // taker venue
    expect(screen.getByText('2500')).toBeInTheDocument(); // long/maker avg fill
    expect(screen.getByText('2503.75')).toBeInTheDocument(); // short/taker avg fill
    expect(screen.getByText(/^\+3\.75$/)).toBeInTheDocument(); // signed price basis
    expect(screen.getByText(/^\(\+0\.150%\)$/)).toBeInTheDocument(); // +0.150%
    expect(screen.getByText('favorable')).toBeInTheDocument();
  });

  it('DONE: omits the slippage block when a leg has no average fill', async () => {
    renderModal(
      makeDealView({
        pair: {
          mode: 'DONE',
          reportJson: JSON.stringify({ aFilled: '0.05', bFilled: '0', unhedged: '0.05', reason: 'stopped', aAvgFill: '2500', bAvgFill: null }),
        },
        projection: { aFilled: '0.05', bFilled: '0', unhedged: '0.05' },
      }),
    );
    expect(await screen.findByText('Report')).toBeInTheDocument();
    expect(screen.queryByText('maker')).not.toBeInTheDocument();
    expect(screen.queryByText('slippage')).not.toBeInTheDocument();
  });
});
