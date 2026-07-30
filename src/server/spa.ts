/**
 * Serving the SPA with its API token baked in.
 *
 * The browser has to learn the per-install token somehow, and the one channel
 * that needs no user action and no new URL — so the bookmarked
 * http://localhost:6688 keeps working — is the HTML the server itself hands
 * out. The page carries the token in a meta tag; the client echoes it back on
 * every /api call.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const PLACEHOLDER = '__ARB_TOKEN__';

/** index.html with the token injected. A dist built before the placeholder
 * existed still gets the meta tag inserted — an old build must degrade to
 * "works", never to "401s every request". The token is hex, so there is
 * nothing to escape. */
export function tokenizedIndexHtml(webDist: string, token: string): string {
  const raw = fs.readFileSync(path.join(webDist, 'index.html'), 'utf8');
  if (raw.includes(PLACEHOLDER)) return raw.replaceAll(PLACEHOLDER, token);
  return raw.replace('</head>', `    <meta name="arb-token" content="${token}" />\n  </head>`);
}
