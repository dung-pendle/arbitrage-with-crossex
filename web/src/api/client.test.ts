/** The client attaches this install's API token to every /api call — and
 * attaches nothing when the page did not come from the terminal backend (dev,
 * where the Vite proxy adds it server-side, and the public landing build,
 * which has no token and must keep working). */
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { fetchJson } from './client';
import { env, server } from '../test/server';

function setMeta(content: string | null): void {
  document.head.querySelector('meta[name="arb-token"]')?.remove();
  if (content === null) return;
  const m = document.createElement('meta');
  m.setAttribute('name', 'arb-token');
  m.setAttribute('content', content);
  document.head.appendChild(m);
}

/** Capture the token header the client sends on a request. */
async function tokenSent(): Promise<string | null> {
  let seen: string | null = null;
  server.use(
    http.get('/api/health', ({ request }) => {
      seen = request.headers.get('x-arb-token');
      return HttpResponse.json(env({ status: 'ok' }));
    }),
  );
  await fetchJson('/health');
  return seen;
}

afterEach(() => setMeta(null));

describe('fetchJson auth header', () => {
  it('sends the token from the injected meta tag', async () => {
    setMeta('tok123');
    expect(await tokenSent()).toBe('tok123');
  });

  it('sends nothing when there is no meta tag (landing build)', async () => {
    setMeta(null);
    expect(await tokenSent()).toBeNull();
  });

  it('sends nothing when the placeholder was never replaced (dev)', async () => {
    setMeta('__ARB_TOKEN__');
    expect(await tokenSent()).toBeNull();
  });
});
