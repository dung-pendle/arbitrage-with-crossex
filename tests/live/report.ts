/**
 * Run report accumulator: every order, every distinct raw order-state string, fees
 * per coin, recorded fixtures and cleanup steps. Written to
 * tests/live/reports/live-run-<ISO>.md AND printed to stdout even on failure
 * (the suite calls write() from afterAll's finally, and from the signal handlers).
 *
 * Raw state strings are merged write-through into
 * tests/fixtures/gate/observed-order-states.json — { "STATE": ["context", ...] },
 * deduped across runs so every run enriches one shared file.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { FIXTURE_ROOT, LIVE_DIR, NOTIONAL, RECORD_FIXTURES, runId, TAG } from './env';

const RECORDED_DIR = path.join(FIXTURE_ROOT, 'recorded');
const RECORDED_LIVE_DIR = path.join(RECORDED_DIR, 'live-api');
const STATES_FILE = path.join(FIXTURE_ROOT, 'observed-order-states.json');
const REPORTS_DIR = path.join(LIVE_DIR, 'reports');

const README_LINE =
  '`live-api/*.json` hold the CAMELCASE `data` payloads returned by the app’s `/api` routes ' +
  '(recorded by tests/live — the raw snake_case wire format is not visible through the server).';

/** Identity fields → placeholder; monetary magnitudes → "0". Recorded fixtures exist
 * to capture API SHAPES (field names, decimal-string format, state strings), not the
 * maintainer's real balances/identity — so we redact the values but keep valid shapes. */
const IDENTITY_KEYS = /^(userId|positionId|orderId|user_id|position_id)$/;
const MONEY_KEYS =
  /^(marginBalance|availableMargin|initialMargin|maintenanceMargin|equity|balance|availableBalance|upnl|liability|positionValue|accountLimit|margin_balance|available_margin|initial_margin|maintenance_margin|available_balance|position_value)$/;

function scrubSensitive(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(scrubSensitive);
  if (data && typeof data === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (IDENTITY_KEYS.test(k)) out[k] = '0';
      else if (MONEY_KEYS.test(k) && (typeof v === 'string' || typeof v === 'number')) out[k] = '0';
      else out[k] = scrubSensitive(v);
    }
    return out;
  }
  return data;
}

export interface ReportedOrder {
  orderId: string;
  context: string;
  kind: string;
  symbol: string;
  status: string;
  executedQty?: string;
  executedAvgPrice?: string;
  fee?: string;
  feeCoin?: string;
  rawState?: string;
}

class LiveRunReport {
  private orders: ReportedOrder[] = [];
  private states = new Map<string, Set<string>>();
  private fees = new Map<string, number>();
  private cleanupSteps: string[] = [];
  private notes: string[] = [];
  private fixturesWritten: string[] = [];
  private verdict: 'FLAT' | 'NOT FLAT' | 'UNVERIFIED' = 'UNVERIFIED';
  private written = false;

  note(text: string): void {
    this.notes.push(text);
  }

  addOrder(order: ReportedOrder): void {
    this.orders.push(order);
    if (order.fee && Number(order.fee) > 0) this.addFee(order.feeCoin || 'USDT', Number(order.fee));
  }

  addFee(coin: string, amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.fees.set(coin, (this.fees.get(coin) ?? 0) + amount);
  }

  cleanup(step: string): void {
    this.cleanupSteps.push(step);
  }

  setVerdict(flat: boolean): void {
    this.verdict = flat ? 'FLAT' : 'NOT FLAT';
  }

  /** Merge one raw order-state string into observed-order-states.json (write-through,
   * dedup, preserve other runs' contexts) — one shared file across runs. */
  observeState(state: string | undefined, context: string): void {
    const s = String(state ?? 'undefined');
    if (!this.states.has(s)) this.states.set(s, new Set());
    this.states.get(s)!.add(context);
    fs.mkdirSync(FIXTURE_ROOT, { recursive: true });
    let existing: Record<string, string[]> = {};
    if (fs.existsSync(STATES_FILE)) {
      try {
        existing = JSON.parse(fs.readFileSync(STATES_FILE, 'utf8')) as Record<string, string[]>;
      } catch {
        /* corrupt file — rewrite from scratch */
      }
    }
    const contexts = new Set(existing[s] ?? []);
    contexts.add(context);
    existing[s] = [...contexts].sort();
    fs.writeFileSync(STATES_FILE, JSON.stringify(existing, null, 2) + '\n');
  }

  /** Record one route payload under recorded/live-api/<name>.json (camelCase — the
   * server never exposes snake_case). No-op unless LIVE_TRADE_RECORD_FIXTURES is on.
   * The whole recorded/ dir is gitignored, but we ALSO scrub identity + balances
   * before writing so a stray `git add -f` (or an un-ignore) can't leak the account. */
  recordFixture(name: string, data: unknown): void {
    if (!RECORD_FIXTURES) return;
    fs.mkdirSync(RECORDED_LIVE_DIR, { recursive: true });
    const readme = path.join(RECORDED_DIR, '_README.md');
    if (!fs.existsSync(readme)) {
      fs.writeFileSync(readme, `# Recorded Gate CrossEx fixtures\n\n${README_LINE}\n`);
    } else if (!fs.readFileSync(readme, 'utf8').includes('live-api/*.json')) {
      fs.appendFileSync(readme, `\n${README_LINE}\n`);
    }
    fs.writeFileSync(
      path.join(RECORDED_LIVE_DIR, `${name}.json`),
      JSON.stringify(scrubSensitive(data), (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n',
    );
    this.fixturesWritten.push(`recorded/live-api/${name}.json`);
  }

  private render(): string {
    const lines: string[] = [];
    lines.push(`# Live trade run ${runId}`);
    lines.push('');
    lines.push(`- tag: \`${TAG}\``);
    lines.push(`- notional: $${NOTIONAL}`);
    lines.push(`- finished: ${new Date().toISOString()}`);
    lines.push(`- **final verdict: ${this.verdict}**`);
    if (this.verdict === 'NOT FLAT') {
      lines.push('- ⚠️ NOT FLAT — run `yarn live:cleanup` and verify on Gate manually.');
    }
    lines.push('');
    lines.push('## Orders');
    lines.push('');
    if (this.orders.length === 0) {
      lines.push('(none placed)');
    } else {
      lines.push('| orderId | kind | symbol | status | executedQty | avgPrice | fee | rawState | context |');
      lines.push('|---|---|---|---|---|---|---|---|---|');
      for (const o of this.orders) {
        lines.push(
          `| ${o.orderId} | ${o.kind} | ${o.symbol} | ${o.status} | ${o.executedQty ?? ''} | ` +
            `${o.executedAvgPrice ?? ''} | ${o.fee ? `${o.fee} ${o.feeCoin ?? ''}` : ''} | ${o.rawState ?? ''} | ${o.context} |`,
        );
      }
    }
    lines.push('');
    lines.push('## Order states observed (merged into tests/fixtures/gate/observed-order-states.json)');
    lines.push('');
    if (this.states.size === 0) lines.push('(none)');
    for (const [state, contexts] of this.states) lines.push(`- \`${state}\`: ${[...contexts].sort().join(', ')}`);
    lines.push('');
    lines.push('## Total fees paid');
    lines.push('');
    if (this.fees.size === 0) lines.push('(none observed)');
    for (const [coin, total] of this.fees) lines.push(`- ${total.toFixed(8)} ${coin}`);
    lines.push('');
    lines.push('## Fixtures refreshed');
    lines.push('');
    if (this.fixturesWritten.length === 0) lines.push('(none)');
    for (const f of this.fixturesWritten) lines.push(`- tests/fixtures/gate/${f}`);
    if (this.states.size > 0) lines.push('- tests/fixtures/gate/observed-order-states.json');
    lines.push('');
    lines.push('## Cleanup steps');
    lines.push('');
    if (this.cleanupSteps.length === 0) lines.push('(none needed)');
    for (const s of this.cleanupSteps) lines.push(`- ${s}`);
    if (this.notes.length) {
      lines.push('');
      lines.push('## Notes');
      lines.push('');
      for (const n of this.notes) lines.push(`- ${n}`);
    }
    lines.push('');
    return lines.join('\n');
  }

  /** Write the markdown report + print it to stdout. Safe to call more than once
   * (signal handler and afterAll can race on an aborted run) — writes once. */
  write(): string | undefined {
    if (this.written) return undefined;
    this.written = true;
    const md = this.render();
    let file: string | undefined;
    try {
      fs.mkdirSync(REPORTS_DIR, { recursive: true });
      file = path.join(REPORTS_DIR, `live-run-${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
      fs.writeFileSync(file, md);
    } catch {
      /* report must still reach stdout */
    }
    console.log('\n' + md);
    if (file) console.log(`report written: ${file}`);
    return file;
  }
}

export const report = new LiveRunReport();
