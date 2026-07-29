/**
 * First-run disclaimer gate: /api/disclaimer status + accept, and the
 * POST /api/deals backstop that refuses to place an order until the current
 * disclaimer version is accepted (persisted next to the .env in the config dir).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { DISCLAIMER_VERSION } from '../../src/server/disclaimer';
import { HOST, makeTestApp } from './helpers/gate-nock';

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

function makeApp(): FastifyInstance {
  const envPath = path.join(mkdtempSync(path.join(tmpdir(), 'disc-')), '.env');
  return makeTestApp({ credentials: { envPath, setClients: () => {} } });
}

describe('disclaimer gate', () => {
  it('reports unaccepted, blocks POST /api/deals (403), then unblocks after accept', async () => {
    app = makeApp();

    const before = await app.inject({ method: 'GET', url: '/api/disclaimer', headers: HOST });
    expect(before.statusCode).toBe(200);
    expect(before.json().data).toMatchObject({ version: DISCLAIMER_VERSION, accepted: false, acceptedVersion: null });

    // Trading is refused with a recognizable label BEFORE the body is parsed.
    const blocked = await app.inject({ method: 'POST', url: '/api/deals', headers: HOST, payload: {} });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.label).toBe('DISCLAIMER_NOT_ACCEPTED');

    const accept = await app.inject({
      method: 'POST',
      url: '/api/disclaimer/accept',
      headers: HOST,
      payload: { version: DISCLAIMER_VERSION },
    });
    expect(accept.statusCode).toBe(200);
    expect(accept.json().data.accepted).toBe(true);

    const after = await app.inject({ method: 'GET', url: '/api/disclaimer', headers: HOST });
    expect(after.json().data).toMatchObject({ accepted: true, acceptedVersion: DISCLAIMER_VERSION });

    // Gate lifted: the same call now gets PAST the gate and fails on its own
    // validation (missing deal id → 400), never the 403 again.
    const past = await app.inject({ method: 'POST', url: '/api/deals', headers: HOST, payload: {} });
    expect(past.statusCode).toBe(400);
  });

  it('rejects accepting a different version', async () => {
    app = makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/disclaimer/accept',
      headers: HOST,
      payload: { version: 'not-the-current-version' },
    });
    expect(res.statusCode).toBe(400);
  });
});
