/**
 * The per-install API token: what makes the local API something only YOU can
 * drive, rather than anything running on the machine.
 *
 * The server binds loopback and rejects foreign Host/Origin headers, but
 * neither stops a local process — under any account on a shared box — from
 * simply POSTing a deal. A random token, stored 0600 beside the .env and
 * handed to the browser by the HTML the server itself serves, narrows that to
 * processes running as the owning user.
 *
 * It is exactly as strong as the .env next to it, and no stronger: anything
 * running as you can read both. That boundary is stated in the README.
 */
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { restrictToOwner } from './secretFile';

const TOKEN_FILE = 'api-token';

/**
 * The token for this install, created on first boot. Lives in the CONFIG dir
 * (never the app dir, which an update replaces wholesale), so open tabs
 * survive updates and restarts.
 *
 * Missing or empty regenerates. Any other read failure THROWS: silently
 * carrying on would drop the control entirely and unauthenticate a live-money
 * API, which is the one outcome worse than refusing to start — and the only
 * way to get here is broken permissions in the very directory that holds the
 * Gate secret, where credential writes are already failing.
 */
export function readOrCreateApiToken(configDir: string): string {
  const file = path.join(configDir, TOKEN_FILE);
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing) return existing;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(
        `cannot read the API token at ${file} — fix its permissions, or delete it and restart (${(err as Error).message})`,
      );
    }
  }
  const token = randomBytes(32).toString('hex');
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${token}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file); // atomic on the same filesystem
  restrictToOwner(file); // Windows ignores the 0600 above
  return token;
}
