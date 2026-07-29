import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { OpenOrder } from '../api/types';
import { env, server } from '../test/server';
import { renderWithClient } from '../test/utils';
import { OpenOrdersPanel } from './OpenOrdersPanel';

const order: OpenOrder = {
  orderId: '424242',
  text: 'web_abc_0',
  state: 'WEIRD_STATE_42',
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

describe('OpenOrdersPanel', () => {
  it('renders an unknown state verbatim in a neutral chip (never crashes)', async () => {
    server.use(http.get('/api/orders/open', () => HttpResponse.json(env([order]))));
    renderWithClient(<OpenOrdersPanel />);

    const chip = await screen.findByText('WEIRD_STATE_42');
    expect(chip).toBeInTheDocument();
    expect(chip.className).toContain('chip');
    // Neutral — none of the toned colors.
    for (const toned of ['text-emerald-400', 'text-rose-400', 'text-amber-400', 'text-sky-400']) {
      expect(chip.className).not.toContain(toned);
    }
  });

  it('fires DELETE /api/orders/:id exactly once on Cancel', async () => {
    let deletes = 0;
    server.use(
      http.get('/api/orders/open', () => HttpResponse.json(env([order]))),
      http.delete('/api/orders/:id', ({ params }) => {
        deletes += 1;
        expect(params.id).toBe('424242');
        return HttpResponse.json(env({ orderId: '424242', canceled: true }));
      }),
    );
    renderWithClient(<OpenOrdersPanel />);

    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(deletes).toBe(1));
    // A refetch happens after invalidation; the DELETE must not repeat.
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(deletes).toBe(1);
  });
});
