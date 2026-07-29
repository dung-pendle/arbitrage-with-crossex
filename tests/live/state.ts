/**
 * Run-state file (tests/live/.last-run.json) — written at suite start, BEFORE any
 * order leaves. It is the standalone cleanup's ONLY attribution source: without it
 * `yarn live:cleanup` refuses to touch anything.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { LIVE_DIR } from './env';

export const LAST_RUN_FILE = path.join(LIVE_DIR, '.last-run.json');

export interface LastRunState {
  runId: string;
  /** Order-text prefix used for every order the run placed via the app. */
  tag: string;
  /** The selected test symbols — cleanup never looks at any other symbol. */
  symbols: string[];
  /** ms epoch — cleanup only attributes orders created at/after this instant. */
  startedAt: number;
}

export function writeLastRun(state: LastRunState): void {
  fs.mkdirSync(LIVE_DIR, { recursive: true });
  fs.writeFileSync(LAST_RUN_FILE, JSON.stringify(state, null, 2) + '\n');
}

export function readLastRun(): LastRunState | null {
  if (!fs.existsSync(LAST_RUN_FILE)) return null;
  try {
    const state = JSON.parse(fs.readFileSync(LAST_RUN_FILE, 'utf8')) as LastRunState;
    if (!state || typeof state.tag !== 'string' || !Array.isArray(state.symbols) || !Number.isFinite(state.startedAt)) {
      return null;
    }
    return state;
  } catch {
    return null;
  }
}
