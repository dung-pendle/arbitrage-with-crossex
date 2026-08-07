import { describe, expect, it } from 'vitest';
import { makeClients } from '../../src/core/clients';
import { fixture, gate } from './helpers/gate-nock';

describe('Gate broker channel id', () => {
  // Gate attributes this tool's API flow under its Broker Program by the
  // X-Gate-Channel-Id header; it is set once on the shared ApiClient's default
  // headers in makeClients so no caller can forget it. matchHeader makes the
  // nock scope unreachable without the header — the request itself would fail.
  it('every signed request carries X-Gate-Channel-Id: boros', async () => {
    const scope = gate()
      .matchHeader('x-gate-channel-id', 'boros')
      .get('/api/v4/crossex/accounts')
      .query(true)
      .reply(200, fixture('account.json'));

    const clients = makeClients({ key: 'test-key', secret: 'test-secret' });
    const { body } = await clients.crossEx.getCrossexAccount();

    expect(body).toBeTruthy();
    scope.done();
  });
});
