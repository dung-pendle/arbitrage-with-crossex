/**
 * Cross-mount persistence for deal idempotency keys.
 *
 * The basket id is what makes a lost-response retry a no-op: POST /deals dedupes
 * on it, so resending the SAME id after a network blip returns the existing deal
 * instead of creating a second one. ExecuteControl deliberately keeps the id on
 * error for exactly that reason — but it lived only in a component ref, so any
 * unmount (toggling the ticket between Single and Pair fully remounts it) or a
 * page reload dropped it. The next confirm minted a fresh uuid the server could
 * not dedupe, and a full second delta-neutral pair was created: 2x the intended
 * notional on both venues, double open fees, and a second deal to unwind.
 *
 * Storage shape: ONE localStorage key holding a MAP of intent -> {id, ts}. The
 * first version stored a single global slot, which re-opened the double-execute
 * from another angle: every ExecuteControl instance shares this store, so ANY
 * other ticket submitting (overwrite) or succeeding (unconditional clear) in
 * the window between a lost response and its retry destroyed the pending id.
 * Entries are therefore scoped per intent — a write touches only its own entry
 * and clearing names the exact intent whose deal completed.
 *
 * Constraints on every entry:
 *   - Scoped to the EXACT intent. Reusing an id with edited actions would let
 *     the server dedupe the edit away and surface the wrong basket, so the
 *     stored intent must match before the id is recovered.
 *   - Short-lived. Once the deal exists on the server it is deduped forever, so
 *     a stale id would silently reopen an old deal instead of placing a new one.
 *     Only an in-flight/just-failed submit is worth recovering. Expired entries
 *     are pruned on read AND write, so an expired id is never returned even if
 *     nothing ever rewrites the map.
 *   - Bounded. The map is capped at MAX_ENTRIES (oldest evicted) so abandoned
 *     intents can never grow the localStorage value without limit.
 */
import { readJson, writeJson } from '../lib/storage';

const KEY = 'crossex.pendingBasket';
const TTL_MS = 15 * 60_000;
/** Far more simultaneous unresolved submits than any real session produces —
 * the cap exists only to bound the map, never to evict a live retry's id. */
const MAX_ENTRIES = 20;

interface PendingEntry {
  id: string;
  ts: number;
}

/** intent (ExecuteControl's resetKey) -> the unresolved basket id for it. */
type PendingMap = Record<string, PendingEntry>;

function asMap(p: unknown): PendingMap {
  const out: PendingMap = {};
  if (!p || typeof p !== 'object' || Array.isArray(p)) return out;
  const rec = p as Record<string, unknown>;
  // Legacy single-slot shape ({intent, id, ts}) from the first version of this
  // module — migrate it rather than drop it: the update can land exactly inside
  // someone's lost-response window, which is the one moment the id matters.
  if (typeof rec.intent === 'string' && typeof rec.id === 'string' && typeof rec.ts === 'number') {
    out[rec.intent] = { id: rec.id, ts: rec.ts };
    return out;
  }
  for (const [intent, v] of Object.entries(rec)) {
    const e = v as Partial<PendingEntry> | null;
    if (e && typeof e === 'object' && typeof e.id === 'string' && typeof e.ts === 'number') {
      out[intent] = { id: e.id, ts: e.ts };
    }
  }
  return out;
}

/** The persisted map with expired entries already dropped (TTL pruning on the
 * READ path, so a stale id can never be recovered; the WRITE path persists the
 * pruned result so the map also physically shrinks). */
function readMap(): PendingMap {
  const map = readJson<PendingMap>(KEY, {}, asMap);
  const now = Date.now();
  for (const intent of Object.keys(map)) {
    if (now - map[intent].ts > TTL_MS) delete map[intent];
  }
  return map;
}

/** The unresolved basket id for this exact intent, or null. */
export function readPendingBasket(intent: string): string | null {
  if (!intent) return null;
  return readMap()[intent]?.id ?? null;
}

/** Remember the id being submitted, so a remount or reload can resend the same
 * one. Touches ONLY this intent's entry — other tickets' pending ids survive. */
export function writePendingBasket(intent: string, id: string): void {
  if (!intent) return;
  const map = readMap();
  map[intent] = { id, ts: Date.now() };
  const keys = Object.keys(map);
  if (keys.length > MAX_ENTRIES) {
    // Evict oldest-first, never the entry just written (it is the one live
    // submit we know about; the oldest are the most likely already abandoned).
    keys
      .filter((k) => k !== intent)
      .sort((a, b) => map[a].ts - map[b].ts)
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach((k) => delete map[k]);
  }
  writeJson(KEY, map);
}

/** THIS intent's deal exists — its next confirm must mint a fresh id. Clears
 * only the named entry: an unconditional wipe here would let any other ticket's
 * success destroy a different ticket's pending id mid-retry (the global-slot
 * bug this module's map shape exists to prevent). */
export function clearPendingBasket(intent: string): void {
  if (!intent) return;
  const map = readMap();
  delete map[intent];
  writeJson(KEY, map);
}
