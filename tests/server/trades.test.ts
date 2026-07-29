import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { HOST, makeTestApp, mockGateGet } from './helpers/gate-nock';

interface TradeRow {
  orderId: string;
  matchRole: string;
  orderType?: string;
  orderTif?: string;
}

describe('GET /api/trades', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  it('join=1 attaches orderType/orderTif to the fill whose order_id matches', async () => {
    app = makeTestApp();
    const tradesScope = mockGateGet('/history_trades', { fixture: 'history-trades.json' });
    const ordersScope = mockGateGet('/history_orders', { fixture: 'history-orders.json' });

    const res = await app.inject({ method: 'GET', url: '/api/trades?join=1', headers: HOST });

    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    const trades: TradeRow[] = data.trades;
    expect(trades).toHaveLength(3);

    const joined = trades.find((t) => t.orderId === '900101');
    expect(joined).toBeDefined();
    expect(joined!.orderType).toBe('LIMIT'); // "LMT IOC · taker" per fill group
    expect(joined!.orderTif).toBe('IOC');
    expect(joined!.matchRole).toBe('taker');

    for (const t of trades.filter((t) => t.orderId !== '900101')) {
      expect(t.orderType).toBeUndefined();
      expect(t.orderTif).toBeUndefined();
    }
    expect(tradesScope.isDone()).toBe(true);
    expect(ordersScope.isDone()).toBe(true);
  });

  it('hasMore is false for a short page', async () => {
    app = makeTestApp();
    mockGateGet('/history_trades', { fixture: 'history-trades.json' });

    const res = await app.inject({ method: 'GET', url: '/api/trades?limit=50', headers: HOST });

    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.page).toBe(1);
    expect(data.limit).toBe(50);
    expect(data.hasMore).toBe(false); // 3 fills < limit 50
  });
});
