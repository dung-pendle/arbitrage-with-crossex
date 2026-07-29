/**
 * Owner-only permissions for the files that hold a live-money secret, on every
 * platform the terminal runs on.
 *
 * On POSIX the mode bits passed to mkdir/writeFile/chmod do the job. On Windows
 * they are SILENTLY IGNORED — Node maps chmod to nothing more than the read-only
 * attribute — so a `.env` containing Gate API keys would simply inherit whatever
 * ACL its parent directory has. Under %LOCALAPPDATA% that is the user plus
 * SYSTEM and (depending on the machine) local Administrators; in a source
 * checkout it is whatever the containing folder allows, which on a shared or
 * domain-joined PC can be considerably wider.
 *
 * So on Windows we set the ACL explicitly with icacls: strip inheritance and
 * grant full control to the current user only.
 *
 * Every call is best-effort and never throws: this hardens a file, it must never
 * be the reason the server refuses to start or a credential save fails.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';

const isWindows = process.platform === 'win32';

/**
 * The current user's SID. Names are not safe to grant against: USERNAME can fail
 * to resolve on a domain-joined machine, a renamed account, or a localised
 * Windows - and a failed grant AFTER inheritance has been stripped leaves an
 * empty DACL that locks out even the owner. `whoami /user` gives the SID, which
 * always resolves, and `*S-1-...` is icacls's own syntax for it.
 */
function currentWindowsSid(): string | null {
  try {
    const out = execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    const m = out.match(/"(S-1-[\d-]+)"/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Restrict `target` (file or directory) to its owner.
 * `recurse` applies the grant to a directory's existing contents too.
 *
 * Order matters and is the whole point: grant FIRST, drop inheritance only once
 * the grant has succeeded, then verify the result is still readable/writable and
 * restore Windows defaults if it is not. Doing it the obvious way round --
 * `/inheritance:r` before `/grant` -- is exactly what left the data directory
 * with an empty DACL, so the server could not open its own SQLite ledger
 * (SQLITE_CANTOPEN) with nothing to explain why. A slightly wider ACL is
 * recoverable; a folder nobody can open is not.
 */
export function restrictToOwner(target: string, opts?: { recurse?: boolean }): void {
  try {
    if (!fs.existsSync(target)) return;
    if (!isWindows) {
      fs.chmodSync(target, fs.statSync(target).isDirectory() ? 0o700 : 0o600);
      return;
    }
    const sid = currentWindowsSid();
    if (!sid) return; // cannot name the grantee safely - leave the ACL alone
    const isDir = fs.statSync(target).isDirectory();
    const icacls = (args: string[]): void => {
      execFileSync('icacls', [target, ...args], { stdio: 'ignore', windowsHide: true });
    };

    // (OI)(CI) are INHERITANCE flags: correct on a directory, meaningless on a
    // file. Granting them to a directory is also what lets the files created
    // inside it (.env, disclaimer.json) inherit the same owner-only access
    // without ever touching them individually - which matters, because applying
    // ACLs recursively to files that already exist is how the data directory's
    // SQLite ledger ended up unopenable.
    icacls(['/grant:r', isDir ? `*${sid}:(OI)(CI)F` : `*${sid}:(F)`]);
    icacls(['/inheritance:r']);

    // Prove we did not just lock ourselves out - of this path AND, for a
    // directory, of what is already inside it.
    try {
      fs.accessSync(target, fs.constants.R_OK | fs.constants.W_OK);
      if (isDir) {
        for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
          if (entry.isFile()) {
            fs.accessSync(`${target}\\${entry.name}`, fs.constants.R_OK | fs.constants.W_OK);
          }
        }
      }
    } catch {
      icacls(['/reset', '/t', '/c']);
    }
  } catch {
    /* best-effort: never block startup or a credential write on a permissions call */
  }
}
