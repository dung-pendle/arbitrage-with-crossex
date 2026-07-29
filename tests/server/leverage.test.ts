import type { FastifyInstance } from 'fastify';
import nock from 'nock';
import { afterEach, describe, expect, it } from 'vitest';
import { HOST, makeTestApp, mockGateGet, mockGatePost } from './helpers/gate-nock';

const SYMBOL = 'GATE_FUTURE_ETH_USDT';

describe('/api/leverage/:symbol', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  it('GET returns current leverage + leverageMax', async () => {
    app = makeTestApp();
    mockGateGet('/positions/leverage', { body: { [SYMBOL]: '5' } });
    mockGateGet('/rule/risk_limits', { fixture: 'risk-limits.json' });

    const res = await app.inject({ method: 'GET', url: `/api/leverage/${SYMBOL}`, headers: HOST });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ symbol: SYMBOL, leverage: 5, leverageMax: 50 });
  });

  it('PUT over max → 400 category leverage, and no Gate write happens', async () => {
    app = makeTestApp();
    mockGateGet('/rule/risk_limits', { fixture: 'risk-limits.json' });
    // No POST /crossex/positions/leverage interceptor exists: with net disabled,
    // any attempted write would explode into a network error, not a clean 400.

    const res = await app.inject({
      method: 'PUT',
      url: `/api/leverage/${SYMBOL}`,
      headers: HOST,
      payload: { leverage: 100 },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.error.category).toBe('leverage');
    expect(nock.pendingMocks()).toEqual([]); // only the risk-limits read was consumed
  });

  it('PUT within max writes {symbol, leverage} to Gate and busts the positions cache', async () => {
    app = makeTestApp();
    // Two positions interceptors: cached GET before the PUT + refetch after the bust.
    const positionsScope = mockGateGet('/positions', { fixture: 'positions.empty.json', times: 2 });
    mockGateGet('/rule/risk_limits', { fixture: 'risk-limits.json' });
    const writeScope = mockGatePost('/positions/leverage', {
      requestBody: { symbol: SYMBOL, leverage: '5' }, // SDK serializes leverage as a string
      body: { symbol: SYMBOL, leverage: '5' },
    });

    const before = await app.inject({ method: 'GET', url: '/api/positions', headers: HOST });
    expect(before.statusCode).toBe(200);

    const put = await app.inject({
      method: 'PUT',
      url: `/api/leverage/${SYMBOL}`,
      headers: HOST,
      payload: { leverage: 5 },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().data).toEqual({ symbol: SYMBOL, leverage: 5 });
    expect(writeScope.isDone()).toBe(true);

    // Within the 2s TTL, so a second Gate call proves the cache was busted.
    const after = await app.inject({ method: 'GET', url: '/api/positions', headers: HOST });
    expect(after.statusCode).toBe(200);
    expect(positionsScope.isDone()).toBe(true);
  });
});
