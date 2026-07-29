import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../../src/engine/db';
import { A_CONTRACT, B_CONTRACT, FakeVenue, VirtualClock, legSpec } from '../unit/engine-sim';
import { HOST, makeTestApp, mockGateDelete, mockGateGet } from './helpers/gate-nock';

describe('/api/orders', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  it('GET /orders/open returns the resting order (cached)', async () => {
    app = makeTestApp();
    const scope = mockGateGet('/open_orders', { fixture: 'open-orders.json' });

    const res = await app.inject({ method: 'GET', url: '/api/orders/open', headers: HOST });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0].orderId).toBe('900001');
    expect(res.json().data[0].timeInForce).toBe('GTC');

    const again = await app.inject({ method: 'GET', url: '/api/orders/open', headers: HOST });
    expect(again.statusCode).toBe(200); // served from cache — single interceptor
    expect(scope.isDone()).toBe(true);
  });

  it('GET /orders/history pages with defaults and reports hasMore', async () => {
    app = makeTestApp();
    mockGateGet('/history_orders', { fixture: 'history-orders.json', query: { page: 1, limit: 2 } });

    const res = await app.inject({ method: 'GET', url: '/api/orders/history?limit=2', headers: HOST });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.orders).toHaveLength(2);
    expect(data.hasMore).toBe(true); // full page of 2
  });

  it('GET /orders/:id returns the order', async () => {
    app = makeTestApp();
    mockGateGet('/orders/900101', { fixture: 'order.filled.json' });

    const res = await app.inject({ method: 'GET', url: '/api/orders/900101', headers: HOST });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.executedAvgPrice).toBe('61896.1');
    expect(res.json().data.state).toBe('FILLED');
  });

  it('DELETE /orders/:id cancels and busts the open-orders cache', async () => {
    app = makeTestApp();
    const openScope = mockGateGet('/open_orders', { fixture: 'open-orders.json', times: 2 });
    mockGateDelete('/orders/900001', { body: { order_id: '900001', status: 'success' } });

    await app.inject({ method: 'GET', url: '/api/orders/open', headers: HOST });
    const del = await app.inject({ method: 'DELETE', url: '/api/orders/900001', headers: HOST });
    expect(del.statusCode).toBe(200);

    // Second Gate read proves the cache was busted (TTL had not expired).
    await app.inject({ method: 'GET', url: '/api/orders/open', headers: HOST });
    expect(openScope.isDone()).toBe(true);
  });

  // The engine's leg-A maker is indistinguishable from a hand-placed order in
  // the Open Orders table. Cancelling it from here bypassed the loop AND left
  // cancel_requested at 0 — which decide() reads as "the user killed the maker
  // on the exchange" = an explicit STOP that permanently relinquishes the rest
  // of the acquisition. One click silently abandoned a half-filled two-leg entry.
  it('DELETE /orders/:id refuses an order the engine owns', async () => {
    const store = new Store(':memory:');
    const venue = new FakeVenue();
    const clock = new VirtualClock();
    app = makeTestApp({ engine: { store, venue, clock } });

    store.createPair({
      id: 'deal-000009',
      mode: 'OPENING',
      a: legSpec(A_CONTRACT, 'BUY'),
      b: legSpec(B_CONTRACT, 'SELL'),
      targetQty: '0.152',
      limitPrice: '2500',
      pricePolicy: 'fixed',
      deadlineAt: null,
      makerNotBefore: 0,
      hedgeNotBefore: 0,
      pocRejects: 0,
      hedgeRejectStreak: 0,
      maxClip: null,
      clipBandBp: null,
      haltReason: null,
      reportJson: null,
      createdAt: clock.now(),
    });
    const o = store.insertPendingOrder({
      pairId: 'deal-000009',
      leg: 'A',
      kind: 'maker',
      side: 'BUY',
      qty: '0.152',
      price: '2500',
      tif: 'poc',
      now: clock.now(),
    });
    store.updateOrder(o.pairId, o.leg, o.seq, { state: 'OPEN', venueOrderId: '900001' });

    const del = await app.inject({ method: 'DELETE', url: '/api/orders/900001', headers: HOST });
    expect(del.statusCode).toBe(400);
    expect(del.json().error.message).toMatch(/managed by the engine/);
    // Nothing reached the venue: no DELETE interceptor was registered at all.
    expect(store.listOrders('deal-000009')[0].cancelRequested).toBe(0);
  });

  it('DELETE /orders/:id still cancels a hand-placed order while a deal is running', async () => {
    const store = new Store(':memory:');
    app = makeTestApp({ engine: { store, venue: new FakeVenue(), clock: new VirtualClock() } });
    mockGateDelete('/orders/777777', { body: { order_id: '777777', status: 'success' } });

    const del = await app.inject({ method: 'DELETE', url: '/api/orders/777777', headers: HOST });
    expect(del.statusCode).toBe(200);
  });
});
