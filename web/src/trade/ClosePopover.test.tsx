import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { ActionInput, DealRequest, PreviewResponse } from '../api/types';
import { baseHandlers, ethPosition, previewFor } from '../test/fixtures';
import { env, server } from '../test/server';
import { renderWithClient } from '../test/utils';
import { ClosePopover } from './ClosePopover';

function closePreviewHandler() {
  return http.post('/api/preview', async ({ request }) => {
    const { actions } = (await request.json()) as { actions: ActionInput[] };
    const a = actions[0];
    return HttpResponse.json(
      env<PreviewResponse>({
        previews: [
          previewFor(a, {
            side: 'SELL',
            type: 'LIMIT',
            tif: 'IOC',
            reduceOnly: true,
            qty: a.kind === 'close-position' && a.qty ? a.qty : '0.3',
            price: '2497.45',
            estNotional: 753,
            closing: { positionQty: '0.3', upnl: '3', mark: 2510 },
            fees: {
              makerRate: 0.0002,
              takerRate: 0.0005,
              specialOverride: false,
              quote: 'USDT',
              est: { taker: 0.3765 },
            },
          }),
        ],
      }),
    );
  });
}

describe('ClosePopover', () => {
  it('previews a full close (marketable limit px + uPnL) with the reduce-only note', async () => {
    server.use(...baseHandlers(), closePreviewHandler());
    renderWithClient(<ClosePopover position={ethPosition} anchor={null} onDismiss={() => {}} />);

    expect(await screen.findByText(/marketable limit px/)).toBeInTheDocument();
    expect(screen.getByText('2497.45')).toBeInTheDocument();
    expect(screen.getByText(/reduce-only IOC marketable limit/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close now ▸' })).toBeEnabled();
  });

  it('partial qty above the position shows an inline error and disables Close', async () => {
    server.use(...baseHandlers(), closePreviewHandler());
    renderWithClient(<ClosePopover position={ethPosition} anchor={null} onDismiss={() => {}} />);
    await screen.findByText(/marketable limit px/);

    await userEvent.click(screen.getByRole('radio', { name: 'partial' }));
    await userEvent.type(screen.getByLabelText('Close qty'), '0.5'); // position is 0.3

    expect(await screen.findByText(/close qty exceeds position \(0\.3\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close now ▸' })).toBeDisabled();
  });

  it('holding "Close now" POSTs a reduce-only banded close deal (no review modal)', async () => {
    const dealCalls: DealRequest[] = [];
    server.use(
      ...baseHandlers(),
      closePreviewHandler(),
      http.post('/api/deals', async ({ request }) => {
        dealCalls.push((await request.json()) as DealRequest);
        return HttpResponse.json(env({ id: dealCalls[0].id }), { status: 202 });
      }),
    );
    renderWithClient(<ClosePopover position={ethPosition} anchor={null} onDismiss={() => {}} />);

    const btn = await screen.findByRole('button', { name: 'Close now ▸' });
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.pointerDown(btn);
    await waitFor(() => expect(dealCalls).toHaveLength(1), { timeout: 2_000 });
    // The deal maps the RESOLVER's close (side/qty from the live position via
    // the preview) with the protection band carried as clipBandPct.
    expect(dealCalls[0]).toMatchObject({
      a: { symbol: 'GATE_FUTURE_ETH_USDT', side: 'SELL', reduceOnly: true },
      execution: 'taker',
      clipBandPct: 0.5,
    });
    expect(dealCalls[0].b ?? null).toBeNull();
  });
});
