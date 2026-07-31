/** The one piece of client-side money math. The exit half was only ever
 * covered through StrategyCard; the entry half's sign convention (an ADD-BACK
 * of costs the server already subtracted) is easy to get backwards, so it is
 * pinned here head-on. */
import { describe, expect, it } from 'vitest';
import { applyCostFlags, SECONDS_IN_YEAR, type CostFlags } from './strategyMath';

const ALL_OFF: CostFlags = { inclExitFees: false, inclExitSlippage: false, inclEntryCost: true };

/** A round strategy: $1,000 of capital, half a year elapsed. */
const base = {
  perpExitFeesUsd: 40,
  perpExitSlippageUsd: 10,
  perpEntryFeesUsd: 30,
  perpEntrySlippageUsd: 20 as number | null,
  realizedPnlUsd: 100,
  realizedApr: 0.2,
  expectedPnlToMaturityUsd: 500 as number | null,
  capitalUsd: 1_000,
  elapsedSeconds: SECONDS_IN_YEAR / 2,
};

const run = (flags: Partial<CostFlags>) => applyCostFlags({ ...base, flags: { ...ALL_OFF, ...flags } });

describe('applyCostFlags — entry cost', () => {
  it('including it is a no-op — the server already subtracted it', () => {
    const r = run({});
    expect(r.entryAddBackUsd).toBe(0);
    expect(r.currentNetUsd).toBe(100);
    expect(r.expectedUsd).toBe(500);
    expect(r.apr).toBe(0.2); // untouched, not re-derived
  });

  it('omitting it hands back fees + slippage to BOTH headline numbers', () => {
    const r = run({ inclEntryCost: false });
    expect(r.entryAddBackUsd).toBe(50); // 30 + 20
    expect(r.currentNetUsd).toBe(150);
    expect(r.expectedUsd).toBe(550);
    // Re-annualized off the add-back alone: 150 / 1000 × 2 = 30%.
    expect(r.apr).toBeCloseTo(0.3, 10);
  });

  it('unknown entry slippage counts as zero, exactly as the server counts it', () => {
    const r = applyCostFlags({
      ...base,
      perpEntrySlippageUsd: null,
      flags: { ...ALL_OFF, inclEntryCost: false },
    });
    expect(r.entryAddBackUsd).toBe(30); // fees only — never a guess
    expect(r.currentNetUsd).toBe(130);
  });

  it('a FAVORABLE entry crossing hands back less, not more (signed)', () => {
    // Entry slippage is signed: negative = the pair filled in the user's favor,
    // so it was never a cost and there is less to give back than the fees.
    const r = applyCostFlags({
      ...base,
      perpEntrySlippageUsd: -12,
      flags: { ...ALL_OFF, inclEntryCost: false },
    });
    expect(r.entryAddBackUsd).toBe(18); // 30 − 12
    expect(r.currentNetUsd).toBe(118);
  });
});

describe('applyCostFlags — entry vs exit stay independent', () => {
  it('the exit cost never reaches the "now" line; the entry add-back always does', () => {
    const r = run({ inclEntryCost: false, inclExitFees: true, inclExitSlippage: true });
    expect(r.exitUsd).toBe(50); // 40 + 10, still charged in full
    expect(r.currentNetUsd).toBe(150); // exit is a FUTURE cost — not spent yet
    expect(r.netUsd).toBe(100); // …but it is in the APR basis
    expect(r.expectedUsd).toBe(500); // 500 + 50 − 50
  });

  it('an unknown exit fee is never guessed, even with the entry omitted', () => {
    const r = applyCostFlags({
      ...base,
      perpExitFeesUsd: null,
      flags: { inclExitFees: true, inclExitSlippage: true, inclEntryCost: false },
    });
    expect(r.exitUsd).toBe(10); // slippage only
    expect(r.expectedUsd).toBe(540); // 500 + 50 − 10
  });

  it('a null projection stays null however the flags are set', () => {
    const r = applyCostFlags({
      ...base,
      expectedPnlToMaturityUsd: null,
      flags: { inclExitFees: true, inclExitSlippage: true, inclEntryCost: false },
    });
    expect(r.expectedUsd).toBeNull();
    expect(r.currentNetUsd).toBe(150); // the "now" line is still knowable
  });

  it('gives up on the APR rather than mis-annualize an unknown window', () => {
    const r = applyCostFlags({
      ...base,
      elapsedSeconds: null,
      flags: { ...ALL_OFF, inclEntryCost: false },
    });
    expect(r.apr).toBeNull();
  });
});

/** The itemised entry cost: a book built across several executions can drop the
 * ones that belonged to an earlier strategy, one at a time. */
describe('applyCostFlags — per-part entry exclusion', () => {
  const parts = [
    { id: 'slip:deal:a', kind: 'slippage' as const, usd: 12, atSec: 1, venues: [], side: null, qty: 1 },
    { id: 'slip:deal:b', kind: 'slippage' as const, usd: 8, atSec: 2, venues: [], side: null, qty: 1 },
    { id: 'fees:X', kind: 'fees' as const, usd: 18, atSec: null, venues: [], side: 'LONG' as const, qty: null },
    { id: 'fees:Y', kind: 'fees' as const, usd: 12, atSec: null, venues: [], side: 'SHORT' as const, qty: null },
  ]; // 20 slippage + 30 fees = the 20/30 aggregates in `base`

  const withParts = (excluded: string[]) =>
    applyCostFlags({
      ...base,
      perpEntryFeesUsd: 30,
      perpEntrySlippageUsd: 20,
      perpEntryParts: parts,
      flags: { ...ALL_OFF, excludedEntryPartIds: new Set(excluded) },
    });

  it('ticking everything charges everything — the default', () => {
    const r = withParts([]);
    expect(r.entryAddBackUsd).toBe(0);
    expect(r.currentNetUsd).toBe(100);
  });

  it('hands back exactly the un-ticked execution, and nothing else', () => {
    const r = withParts(['slip:deal:a']);
    expect(r.entryAddBackUsd).toBe(12);
    expect(r.entryAddBackSlippageUsd).toBe(12);
    expect(r.entryAddBackFeesUsd).toBe(0); // the fee rows are untouched
    expect(r.currentNetUsd).toBe(112);
    expect(r.expectedUsd).toBe(512);
  });

  it('splits the add-back by kind so each waterfall bar can shrink on its own', () => {
    const r = withParts(['slip:deal:b', 'fees:X']);
    expect(r.entryAddBackSlippageUsd).toBe(8);
    expect(r.entryAddBackFeesUsd).toBe(18);
    expect(r.entryAddBackUsd).toBe(26);
  });

  it('un-ticking every part matches the master switch exactly', () => {
    const all = withParts(parts.map((p) => p.id));
    const omitted = applyCostFlags({
      ...base,
      perpEntryFeesUsd: 30,
      perpEntrySlippageUsd: 20,
      perpEntryParts: parts,
      flags: { ...ALL_OFF, inclEntryCost: false },
    });
    expect(all.entryAddBackUsd).toBe(omitted.entryAddBackUsd);
    expect(all.currentNetUsd).toBe(omitted.currentNetUsd);
  });

  it('ignores ids it does not recognise (a part that has since vanished)', () => {
    const r = withParts(['slip:deal:gone', 'fees:closed-leg']);
    expect(r.entryAddBackUsd).toBe(0);
  });

  it('the master switch still works off the aggregates when nothing is itemised', () => {
    // An older payload, or a book the server could not decompose: Omit must
    // still hand back the full amount rather than silently doing nothing.
    const r = applyCostFlags({
      ...base,
      perpEntryFeesUsd: 30,
      perpEntrySlippageUsd: 20,
      perpEntryParts: [],
      flags: { ...ALL_OFF, inclEntryCost: false, excludedEntryPartIds: new Set(['whatever']) },
    });
    expect(r.entryAddBackUsd).toBe(50);
  });

  it('exclusions are ignored entirely while the master switch is off', () => {
    const r = applyCostFlags({
      ...base,
      perpEntryFeesUsd: 30,
      perpEntrySlippageUsd: 20,
      perpEntryParts: parts,
      flags: { ...ALL_OFF, inclEntryCost: false, excludedEntryPartIds: new Set(['fees:X']) },
    });
    expect(r.entryAddBackUsd).toBe(50); // everything, not 18
  });
});
