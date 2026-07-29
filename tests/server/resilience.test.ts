import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOST, makeTestApp, mockGateGet } from './helpers/gate-nock';

const RATE_LIMIT_BODY = { label: 'TOO_MANY_REQUESTS', message: 'too many requests' };

describe('resilience', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    vi.useRealTimers();
    await app?.close();
  });

  it('429 after the TTL expires → serves the stale cached value with meta.stale', async () => {
    // Fake ONLY Date: TtlCache reads Date.now(); real timers keep fastify/nock happy.
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ['Date'], now: t0 });

    app = makeTestApp();
    mockGateGet('/accounts', { fixture: 'account.json' });
    mockGateGet('/accounts', { status: 429, body: RATE_LIMIT_BODY });

    const first = await app.inject({ method: 'GET', url: '/api/account', headers: HOST });
    expect(first.statusCode).toBe(200);
    expect(first.json().meta.stale).toBeUndefined();

    vi.setSystemTime(t0 + 3000); // past the 2s account TTL

    const second = await app.inject({ method: 'GET', url: '/api/account', headers: HOST });
    expect(second.statusCode).toBe(200);
    const body = second.json();
    expect(body.ok).toBe(true);
    expect(body.meta.stale).toBe(true);
    expect(body.data.marginBalance).toBe('993.4877');
  });

  it('429 with an EMPTY cache → 429 rate-limited envelope', async () => {
    app = makeTestApp();
    mockGateGet('/accounts', { status: 429, body: RATE_LIMIT_BODY });

    const res = await app.inject({ method: 'GET', url: '/api/account', headers: HOST });

    expect(res.statusCode).toBe(429);
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.error.category).toBe('rate-limited');
    expect(body.error.retryable).toBe(true);
    expect(body.error.label).toBe('TOO_MANY_REQUESTS'); // Gate's label survives the envelope
  });
});
