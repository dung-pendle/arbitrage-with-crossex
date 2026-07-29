/**
 * STANDALONE emergency cleanup — `yarn live:cleanup` (tsx script, no vitest).
 *
 * Attribution-first: it reads tests/live/.last-run.json (written by the suite
 * BEFORE any order) and refuses to act without it. For each recorded symbol it
 * additionally verifies, from Gate's own order history since the run started,
 * that the most recent OPENING (non-reduce-only) order carries the run's tag
 * prefix — only then does it close the position. It is therefore impossible to
 * point this tool at positions the live suite did not open.
 *
 * Exit codes: 0 = flat & everything attributable; 1 = manual review required
 * (no/stale state, unattributable position, or still not flat).
 */
import { makeClients } from '../../src/core/clients';
import { describeError } from '../../src/core/errors';
import { cancelByTag, closeTestPositions, positionOn, verifyFlat } from './cleanup-lib';
import { isAttributable, isStateStale, openingOrdersSince } from './cleanup-attribution';
import { readLastRun, LAST_RUN_FILE } from './state';

async function main(): Promise<void> {
  const state = readLastRun();
  if (!state) {
    console.error(`manual review required — no attributable run state (${LAST_RUN_FILE} missing or unreadable)`);
    process.exit(1);
  }
  const ageMs = Date.now() - state.startedAt;
  if (isStateStale(state.startedAt)) {
    console.error(
      `manual review required — no attributable run state (.last-run.json is ${(ageMs / 3_600_000).toFixed(1)}h old, > 24h; ` +
        'inspect Gate manually instead of trusting it)',
    );
    process.exit(1);
  }

  const clients = makeClients();
  console.log(
    `live-suite cleanup: run ${state.runId}, tag "${state.tag}", started ${new Date(state.startedAt).toISOString()}`,
  );
  console.log(`symbols: ${state.symbols.join(', ')}`);

  // 1. Cancel leftover open orders whose text carries the run tag (the text prefix
  //    is the attribution — nothing else is ever canceled).
  const canceled = await cancelByTag(clients, state.symbols, state.tag, (m) => console.log(`  ${m}`));
  if (canceled.length === 0) console.log('  no tagged open orders left');

  // 2. Close positions ONLY where Gate's history proves the run opened them.
  let attributionFailed = false;
  const attributable: string[] = [];
  for (const symbol of state.symbols) {
    const pos = await positionOn(clients, symbol);
    if (!pos) continue;
    const opening = await openingOrdersSince(clients, symbol, state.startedAt);
    const latest = opening[0];
    if (isAttributable(latest, state.tag)) {
      console.log(`  position on ${symbol} (qty ${pos.positionQty}) attributed to this run (order ${latest.orderId})`);
      attributable.push(symbol);
    } else {
      attributionFailed = true;
      console.error(
        `  NOT attributable: position on ${symbol} (qty ${pos.positionQty}) but the most recent opening order since run start ` +
          `${latest ? `has text "${latest.text}"` : 'was not found in history'} — refusing to close it; manual review required`,
      );
    }
  }
  if (attributable.length > 0) {
    await closeTestPositions(clients, attributable, (m) => console.log(`  ${m}`));
  }

  // 3. Verdict.
  const flat = await verifyFlat(clients, state.symbols);
  console.log(
    flat
      ? `verdict: FLAT on ${state.symbols.join(', ')}`
      : `verdict: NOT FLAT — a position or open order remains on ${state.symbols.join(', ')}; close it via yarn close or the Gate web UI`,
  );
  process.exit(flat && !attributionFailed ? 0 : 1);
}

main().catch((err) => {
  console.error(`cleanup error: ${describeError(err)} — review positions/orders on Gate manually`);
  process.exit(1);
});
