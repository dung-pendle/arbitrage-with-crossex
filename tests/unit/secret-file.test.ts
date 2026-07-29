import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { restrictToOwner } from '../../src/server/secretFile';

describe('restrictToOwner', () => {
  it('makes a file owner-only and is idempotent', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-'));
    const f = path.join(dir, '.env');
    fs.writeFileSync(f, 'GATE_KEY=secret\n', { mode: 0o644 });
    restrictToOwner(f);
    restrictToOwner(f);
    if (process.platform !== 'win32') {
      expect(fs.statSync(f).mode & 0o777).toBe(0o600);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('makes a directory owner-only', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-'));
    fs.chmodSync(dir, 0o755);
    restrictToOwner(dir);
    if (process.platform !== 'win32') {
      expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('never throws on a missing path', () => {
    expect(() => restrictToOwner(path.join(os.tmpdir(), 'nope-does-not-exist-xyz'))).not.toThrow();
  });
});
