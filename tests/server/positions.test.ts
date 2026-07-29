import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { HOST, makeTestApp, mockGateGet } from './helpers/gate-nock';

describe('GET /api/positions', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  it('groups the cross-quote BTC pair into ONE neutral exposure group', async () => {
    app = makeTestApp();
    mockGateGet('/positions', { fixture: 'positions.pair-neutral.json' });

    const res = await app.inject({ method: 'GET', url: '/api/positions', headers: HOST });

    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.positions).toHaveLength(2);

    // The cross-quote grouping regression: USDC + USDT legs must land in one BTC group.
    expect(data.exposure).toHaveLength(1);
    const group = data.exposure[0];
    expect(group.base).toBe('BTC');
    expect(group.neutral).toBe(true);
    expect(group.singleLeg).toBe(false);
    expect(group.legs).toHaveLength(2);
    expect(group.legs.map((l: { quote: string }) => l.quote).sort()).toEqual(['USDC', 'USDT']);
    expect(group.legs.map((l: { side: string }) => l.side).sort()).toEqual(['LONG', 'SHORT']);
  });

  it('empty book → empty exposure', async () => {
    app = makeTestApp();
    mockGateGet('/positions', { fixture: 'positions.empty.json' });

    const res = await app.inject({ method: 'GET', url: '/api/positions', headers: HOST });

    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.positions).toEqual([]);
    expect(data.exposure).toEqual([]);
  });
});
