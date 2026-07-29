/**
 * Safety interlocks for the live trade suite. ALL of them must pass in beforeAll
 * before ANY write call; each failure throws an Error naming the guard.
 *
 *  1. live-tests-flag     — LIVE_TRADE_TESTS === '1' (set by `yarn test:live`)
 *  2. ack-sentence        — LIVE_TRADE_ACK equals the exact acknowledgement sentence
 *  3. notional-ceiling    — configured notional is positive and ≤ the hard $100 cap
 *  4. credentials         — real .env credentials exist (makeClients throws otherwise)
 *  5. preflight-exposure  — DIRECT SDK reads (never the server cache): no open
 *                           position and no open order on any selected test symbol
 *  6. margin-headroom     — available_margin ≥ 3×notional
 */
import { makeClients, type Clients } from '../../src/core/clients';
import { ACK_SENTENCE, HARD_NOTIONAL_CEILING_USDT, NOTIONAL } from './env';

function guardError(guard: string, detail: string): Error {
  return new Error(`[guard:${guard}] ${detail} — refusing to place live orders`);
}

/** Guard 1: the vitest project flag. */
export function assertLiveTestsEnabled(): void {
  if (process.env.LIVE_TRADE_TESTS !== '1') {
    throw guardError('live-tests-flag', `LIVE_TRADE_TESTS must be '1' (run via \`yarn test:live\`)`);
  }
}

/** Guard 2: the explicit human acknowledgement. */
export function assertAck(): void {
  if (process.env.LIVE_TRADE_ACK !== ACK_SENTENCE) {
    throw guardError('ack-sentence', `set LIVE_TRADE_ACK to exactly "${ACK_SENTENCE}"`);
  }
}

/** Guard 3: notional sanity + the hard ceiling (a constant — not overridable). */
export function assertNotionalCeiling(): void {
  if (!Number.isFinite(NOTIONAL) || NOTIONAL <= 0) {
    throw guardError('notional-ceiling', `LIVE_TRADE_NOTIONAL must be a positive number (got "${process.env.LIVE_TRADE_NOTIONAL}")`);
  }
  if (NOTIONAL > HARD_NOTIONAL_CEILING_USDT) {
    throw guardError(
      'notional-ceiling',
      `LIVE_TRADE_NOTIONAL ${NOTIONAL} exceeds the hard $${HARD_NOTIONAL_CEILING_USDT} ceiling`,
    );
  }
}

/** Guard 4: credentials must exist — returns the authenticated real clients. */
export function assertCredentials(): Clients {
  try {
    return makeClients();
  } catch (err) {
    throw guardError('credentials', (err as Error).message);
  }
}

/**
 * Guard 5 (PREFLIGHT): refuse to trade on a symbol that already has ANY open
 * position or ANY open order. Reads go straight to the Gate SDK — never through
 * the server routes/cache — so a stale cache can never mask real exposure.
 */
export async function assertNoExistingExposure(clients: Clients, symbols: string[]): Promise<void> {
  for (const symbol of symbols) {
    const { body: positions } = await clients.crossEx.listCrossexPositions({ symbol });
    const live = (positions ?? []).filter((p) => Number(p.positionQty ?? 0) !== 0);
    if (live.length > 0) {
      throw guardError('preflight-exposure', `existing OPEN POSITION on ${symbol} (qty ${live[0].positionQty})`);
    }
    const { body: orders } = await clients.crossEx.listCrossexOpenOrders({ symbol });
    if ((orders ?? []).length > 0) {
      throw guardError('preflight-exposure', `existing OPEN ORDER(S) on ${symbol} (first id ${orders[0].orderId})`);
    }
  }
}

/** Guard 6: enough free margin for the run (≥ 3×notional), via a direct SDK read. */
export async function assertMarginHeadroom(clients: Clients): Promise<number> {
  const { body: account } = await clients.crossEx.getCrossexAccount();
  const available = Number(account.availableMargin);
  if (!(available >= 3 * NOTIONAL)) {
    throw guardError(
      'margin-headroom',
      `available margin ${account.availableMargin} USDT < 3×notional (${3 * NOTIONAL} USDT)`,
    );
  }
  return available;
}
