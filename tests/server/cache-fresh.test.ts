import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { HOST, makeTestApp, mockGateGet } from './helpers/gate-nock';

describe('?fresh=1 cache bypass', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  it('refetches from Gate despite a warm long-TTL cache', async () => {
    app = makeTestApp();
    // Fees TTL is 600s — the second Gate call can only be the fresh bypass.
    const scope = mockGateGet('/fee', { fixture: 'fee.json', times: 2 });

    const warm = await app.inject({ method: 'GET', url: '/api/fees', headers: HOST });
    expect(warm.statusCode).toBe(200);
    expect(warm.json().data).toHaveLength(7);

    const fresh = await app.inject({ method: 'GET', url: '/api/fees?fresh=1', headers: HOST });
    expect(fresh.statusCode).toBe(200);
    expect(fresh.json().data.map((f: { exchangeType: string }) => f.exchangeType)).toContain('DERIBIT');

    expect(scope.isDone()).toBe(true); // both interceptors consumed

    // And a third plain GET is served from cache (no interceptor left to consume).
    const cached = await app.inject({ method: 'GET', url: '/api/fees', headers: HOST });
    expect(cached.statusCode).toBe(200);
  });
});
