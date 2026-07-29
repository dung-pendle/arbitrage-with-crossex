/**
 * First-run (no credentials) behavior: the server must boot and serve the
 * credentials UI, clients-requiring routes must fail with a clean
 * 'not-configured' envelope, and entering keys must hot-swap from null.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requireClients, type Clients } from '../../src/core/clients';
import { Store } from '../../src/engine/db';
import { DISCLAIMER_VERSION } from '../../src/server/disclaimer';
import { gateVenue } from '../../src/engine/venueGate';
import { fixture, gate, HOST, makeTestApp, TEST_KEY, TEST_SECRET } from './helpers/gate-nock';

let app: FastifyInstance;
let current: Clients | null;
let envPath: string;
let store: Store;

beforeEach(() => {
  current = null;
  envPath = path.join(mkdtempSync(path.join(tmpdir(), 'env-')), 'config', '.env'); // parent dir intentionally absent
  const getClients = () => requireClients(current);
  store = new Store(':memory:');
  app = makeTestApp({
    getClients,
    engine: { store, venue: gateVenue(getClients), clock: { now: () => Date.now() } },
    credentials: { envPath, setClients: (c) => (current = c) },
  });
  // makeTestApp seeds env credentials for the credentials route; this suite is
  // about the state where none exist.
  delete process.env.GATE_API_KEY;
  delete process.env.GATE_API_SECRET;
});

afterEach(async () => {
  await app.close();
  nock.cleanAll();
  // Other suites expect the deterministic test env values.
  process.env.GATE_API_KEY = TEST_KEY;
  process.env.GATE_API_SECRET = TEST_SECRET;
});

describe('unconfigured server', () => {
  it('GET /api/health works without credentials (installer poll target)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health', headers: HOST });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ status: 'ok' });
  });

  it('GET /api/health still enforces the localhost origin guard', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health', headers: { host: 'evil.com' } });
    expect(res.statusCode).toBe(403);
  });

  it('GET /api/credentials reports configured:false', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/credentials', headers: HOST });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ configured: false, keyMasked: null });
  });

  it('clients-requiring reads fail 503 with category not-configured', async () => {
    for (const url of ['/api/account', '/api/orders/open']) {
      const res = await app.inject({ method: 'GET', url, headers: HOST });
      expect(res.statusCode, url).toBe(503);
      expect(res.json().error.category, url).toBe('not-configured');
    }
  });

  it('POST /api/deals fails 503 with NOTHING created (no intent row)', async () => {
    // Isolate the not-configured path from the first-run disclaimer gate (which
    // otherwise 403s before getClients; the gate itself is covered separately).
    await app.inject({
      method: 'POST',
      url: '/api/disclaimer/accept',
      headers: HOST,
      payload: { version: DISCLAIMER_VERSION },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/deals',
      headers: HOST,
      payload: {
        id: 'unconfigured-attempt',
        a: { symbol: 'GATE_FUTURE_ETH_USDT', side: 'BUY' },
        qty: '0.05',
        execution: 'taker',
      },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.category).toBe('not-configured');
    expect(store.listPairs()).toHaveLength(0);
  });

  it('deal reads work without credentials (the store needs no keys)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/deals?active=1', headers: HOST });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it('first-run flow: PUT /api/credentials validates, persists (creating the config dir), and hot-swaps from null', async () => {
    gate().get('/api/v4/crossex/accounts').query(true).reply(200, fixture('account.json'));

    const put = await app.inject({
      method: 'PUT',
      url: '/api/credentials',
      headers: HOST,
      payload: { key: 'firstrunkey1234', secret: 'firstrunsecret' },
    });
    expect(put.statusCode).toBe(200);
    expect(current).not.toBeNull(); // hot-swapped in

    // The server is now fully usable without a restart.
    gate().get('/api/v4/crossex/accounts').query(true).reply(200, fixture('account.json'));
    const account = await app.inject({ method: 'GET', url: '/api/account', headers: HOST });
    expect(account.statusCode).toBe(200);

    const creds = await app.inject({ method: 'GET', url: '/api/credentials', headers: HOST });
    expect(creds.json().data.configured).toBe(true);
  });
});
