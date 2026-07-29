/**
 * Deterministic simulation test (DST) for the engine — the "no possible
 * race" proof harness. Each seeded episode drives the loop against an
 * adversarial venue: random fills, wire-outcome faults (unknown-delivered /
 * unknown-lost / rejects / insta-cancels), read outages, listing-coverage
 * failures, unknown status strings, user commands, partial IOC fills, and
 * crash-between-commit-and-wire — asserting the prime invariants against VENUE
 * TRUTH after every tick. A failing seed reproduces exactly.
 *
 * Run more episodes with DST_EPISODES=5000 vitest run tests/unit/v2-dst.test.ts
 */
import { describe, expect, it } from 'vitest';
import { fx, fxStr } from '../../src/engine/fx';
import { commands } from '../../src/engine/loop';
import {
  A_CONTRACT,
  assertInvariants,
  mkWorld,
  type CreateDirective,
  type World,
} from './engine-sim';

const EPISODES = Number(process.env.DST_EPISODES ?? 300);
const MAX_TICKS = 800;

/** mulberry32 — tiny deterministic PRNG. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(r: () => number, xs: T[]): T {
  return xs[Math.floor(r() * xs.length)];
}

async function runEpisode(seed: number): Promise<void> {
  const r = prng(seed);
  let crashNext = false;
  const target = pick(r, ['0.152', '0.1', '0.05', '1']);
  // Realistic venue-rule variety, including the dust dead-zone shapes (minSize /
  // minNotional above the lot) that a hedge residual can fall below.
  const bRules = pick(r, [
    undefined,
    { lot: '0.01' },
    { minSize: '0.05' },
    { minNotional: '150' }, // at ref 2500: qty < 0.06 is unsubmittable
  ]);
  // All the deal shapes the engine models: maker pairs, taker
  // pairs born in CONVERTING, single-leg deals, banded reduce-only closes.
  const shape = r();
  const w: World = mkWorld({
    target,
    deadlineInMs: pick(r, [15_000, 60_000, 200_000]),
    maxClip: pick(r, ['0.05', '0.2', '1000000000']),
    b: shape < 0.2 ? null : bRules, // 20% single-leg
    mode: shape >= 0.2 && shape < 0.45 ? 'CONVERTING' : 'OPENING', // 25% taker-born
    a: shape >= 0.35 && shape < 0.45 ? { side: 'SELL', reduceOnly: true } : undefined,
    clipBandBp: r() < 0.3 ? 50 : undefined,
    crashAfterCommit: () => crashNext,
  });

  for (let tick = 0; tick < MAX_TICKS; tick++) {
    // --- adversarial world evolution before this tick ---
    const maker = w.venue.liveOrder(A_CONTRACT);
    if (maker && r() < 0.35) {
      // random venue-side fill progress on the resting maker
      const frac = r();
      const remaining = maker.qty - maker.cum;
      const inc = (remaining * BigInt(Math.ceil(frac * 100))) / 100n;
      if (inc > 0n) w.venue.fill(maker.clientText, fxStr(inc));
    }
    if (r() < 0.15) {
      const roll = r();
      const d: CreateDirective =
        roll < 0.3
          ? 'unknown-delivered'
          : roll < 0.55
            ? 'unknown-lost'
            : roll < 0.7
              ? 'insta-cancel'
              : roll < 0.85
                ? 'reject:BALANCE_NOT_ENOUGH'
                : 'reject:POC_FILL_IMMEDIATELY';
      w.venue.nextCreate.push(d);
    }
    if (r() < 0.1) w.venue.nextIocFill.push(pick(r, [0, 0.5, 1]));
    if (r() < 0.1) w.venue.nextCancelRace.push(pick(r, [0.25, 0.5, 1])); // fills DURING cancel (FIX B.1.c)
    w.venue.readsFail = r() < 0.08;
    w.venue.sweepCoverage = r() >= 0.1;
    if (maker && r() < 0.01) w.venue.venueCancel(maker.clientText);
    if (maker && r() < 0.01) w.venue.setRawStatus(maker.clientText, 'ALIEN_STATE');
    if (r() < 0.02) commands.convertNow(w.store, w.pairId);
    if (r() < 0.01) commands.stop(w.store, w.pairId);
    if (r() < 0.03) commands.repeg(w.store, w.pairId, fxStr(fx('2400') + BigInt(Math.floor(r() * 200)) * fx('1')));
    if (r() < 0.02) commands.resumeAfterHalt(w.store, w.pairId);
    crashNext = r() < 0.03;

    // Un-quarantine alien statuses occasionally (the operator/venue resolves them),
    // else a frozen pair legitimately never terminates.
    if (r() < 0.3) {
      for (const o of w.venue.orders.values()) {
        if (o.rawStatus === 'ALIEN_STATE') o.rawStatus = 'OPEN';
      }
    }

    // --- one tick + invariants against venue truth ---
    await w.step(1);
    crashNext = false;
    assertInvariants(w);

    const pair = w.store.getPair(w.pairId)!;
    if (pair.mode === 'DONE') break;
  }

  // Terminal honesty: if the episode settled, the report equals venue truth.
  const pair = w.store.getPair(w.pairId)!;
  if (pair.mode === 'DONE') {
    const report = JSON.parse(pair.reportJson!) as { aFilled: string; bFilled: string; unhedged: string };
    const { aTrue, bTrue } = w.venue.truth();
    expect(report.aFilled, `seed ${seed}: report.aFilled`).toBe(fxStr(aTrue));
    expect(report.bFilled, `seed ${seed}: report.bFilled`).toBe(fxStr(bTrue));
  } else {
    // Not settled inside the tick budget: legitimate ONLY under a CURRENT
    // standing condition — an in-doubt/quarantined order, a HALT, or an active
    // hedge wall. A historical alert is NOT an excuse: a silent stall with a
    // stale alert from tick 50 must fail here.
    const orders = w.store.listOrders(w.pairId);
    const standing =
      orders.some((o) => o.state === 'PENDING' || o.quarantinedStatus) ||
      pair.mode === 'HALTED' ||
      pair.hedgeRejectStreak > 0;
    expect(
      standing,
      `seed ${seed}: non-terminal episode without a standing surfaced condition (mode=${pair.mode})`,
    ).toBe(true);
  }
  w.store.close();
}

describe(`deterministic simulation (${EPISODES} seeded episodes)`, () => {
  it(
    'holds the prime invariants under adversarial faults, crashes, and user actions',
    async () => {
      for (let seed = 1; seed <= EPISODES; seed++) {
        try {
          await runEpisode(seed);
        } catch (err) {
          throw new Error(`episode seed=${seed} failed: ${(err as Error).message}`);
        }
      }
    },
    Math.max(120_000, EPISODES * 100),
  );
});
