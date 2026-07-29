import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { HOST, makeTestApp, mockGateGet } from './helpers/gate-nock';

describe('GET /api/account', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  it('returns the ok envelope with camelCase account fields', async () => {
    app = makeTestApp();
    const scope = mockGateGet('/accounts', { fixture: 'account.json' });

    const res = await app.inject({ method: 'GET', url: '/api/account', headers: HOST });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.marginBalance).toBe('993.4877'); // margin_balance → camelCase by the SDK
    expect(body.data.assets).toHaveLength(2);
    expect(body.data.assets[0].availableBalance).toBe('260.0000');
    expect(typeof body.meta.ts).toBe('number');
    expect(body.meta.stale).toBeUndefined();
    expect(scope.isDone()).toBe(true);
  });

  it('serves the second request within the TTL from cache (one Gate call)', async () => {
    app = makeTestApp();
    const scope = mockGateGet('/accounts', { fixture: 'account.json' }); // exactly one interceptor

    const first = await app.inject({ method: 'GET', url: '/api/account', headers: HOST });
    const second = await app.inject({ method: 'GET', url: '/api/account', headers: HOST });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().data.marginBalance).toBe('993.4877');
    expect(scope.isDone()).toBe(true);
  });
});
