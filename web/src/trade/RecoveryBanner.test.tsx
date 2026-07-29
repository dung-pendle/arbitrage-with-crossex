import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { makeDealView } from '../test/fixtures';
import { env, server } from '../test/server';
import { renderWithClient } from '../test/utils';
import { RecoveryBanner } from './RecoveryBanner';
import { TradeFlowProvider } from './TradeFlow';

function renderBanner(deals: ReturnType<typeof makeDealView>[], alerts: unknown[] = []) {
  server.use(
    http.get('/api/deals', () => HttpResponse.json(env(deals))),
    http.get('/api/alerts', () => HttpResponse.json(env(alerts))),
  );
  return renderWithClient(
    <TradeFlowProvider>
      <RecoveryBanner />
    </TradeFlowProvider>,
  );
}

describe('RecoveryBanner', () => {
  it('renders nothing with no active deals and no alerts', async () => {
    renderBanner([]);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('surfaces a working deal after a tab reload with a way back into the live view', async () => {
    renderBanner([makeDealView({ pair: { mode: 'OPENING' } })]);
    expect(await screen.findByRole('alert')).toHaveTextContent(/deal is still working/i);
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('a HALTED deal takes priority with the loud styling', async () => {
    renderBanner([
      makeDealView({ pair: { id: 'ok1', mode: 'OPENING' } }),
      makeDealView({ pair: { id: 'bad1', mode: 'HALTED' } }),
    ]);
    expect(await screen.findByRole('alert')).toHaveTextContent(/HALTED — operator needed/);
  });

  it('standing engine alerts render with an ack control when no deal is active', async () => {
    renderBanner([], [{ id: 1, ts: 0, level: 'error', pairId: null, message: 'hedge wall: retries failing', ack: 0 }]);
    expect(await screen.findByRole('alert')).toHaveTextContent(/hedge wall/);
    expect(screen.getByRole('button', { name: 'ack' })).toBeInTheDocument();
  });
});
