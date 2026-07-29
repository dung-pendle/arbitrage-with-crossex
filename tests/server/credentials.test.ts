import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { HOST, makeTestApp, TEST_KEY, TEST_SECRET } from './helpers/gate-nock';

describe('GET /api/credentials', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  it('reports a masked key and never leaks the secret', async () => {
    app = makeTestApp(); // sets GATE_API_KEY/GATE_API_SECRET deterministically

    const res = await app.inject({ method: 'GET', url: '/api/credentials', headers: HOST });

    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.configured).toBe(true);
    expect(data.keyMasked).toBe('test…5678'); // first 4 + … + last 4 of testkey12345678

    expect(res.body).not.toContain(TEST_SECRET);
    expect(res.body).not.toContain(TEST_KEY); // full key never appears either
  });
});
