/**
 * Header controls for the 4-leg home view (moved from the old StrategyPanel):
 * the tracked-address chip / AddressForm, the APR-clock control (now showing
 * the basis DATE), freshness, and the totals
 * strip. PositionsHome owns all state; everything here is presentational.
 * (The exit toggles moved into each StrategyCard — per-position, not global.)
 */
import { useId, useState, type FormEvent } from 'react';
import type { StrategyReturns } from '../api/types';
import { FreshnessButton } from '../components/FreshnessIndicator';
import { SignedNumber } from '../components/SignedNumber';
import { fmtPct, fmtUsd } from '../lib/fmt';
import { readJson } from '../lib/storage';
import { applyCostFlags, type CostFlags } from './strategyMath';

export const STRATEGY_STORAGE_KEY = 'crossex.strategy.v1';
export const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export interface Stored {
  address: string | null;
  /** Custom APR-clock start (unix seconds); null = default (Boros open). */
  since: number | null;
}

/** Read the persisted shape (legacy exit-flag keys are ignored — the exit
 * toggles are per-position now, owned by each StrategyCard). */
export function loadStored(): Stored {
  return readJson<Stored>(
    STRATEGY_STORAGE_KEY,
    { address: null, since: null },
    (parsed) => {
      const p = parsed as { address?: unknown; since?: unknown } | null;
      const address =
        typeof p?.address === 'string' && EVM_ADDRESS_RE.test(p.address) ? p.address : null;
      const since =
        typeof p?.since === 'number' && Number.isFinite(p.since) && p.since > 0 ? p.since : null;
      return { address, since };
    },
  );
}

export const short = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

/** Unix seconds → the local-time value a <input type="datetime-local"> wants. */
function toLocalInput(sec: number): string {
  const d = new Date(sec * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AddressForm({
  initial,
  submitLabel,
  onTrack,
  onCancel,
  full = false,
}: {
  initial?: string;
  submitLabel: string;
  onTrack: (address: string) => void;
  onCancel?: () => void;
  /** Fill the container instead of centring at a fixed width — for the narrow
   * settings drawer, where the fixed w-96 input would overflow. */
  full?: boolean;
}) {
  const id = useId();
  const [value, setValue] = useState(initial ?? '');
  const [touched, setTouched] = useState(false);
  const trimmed = value.trim();
  const valid = EVM_ADDRESS_RE.test(trimmed);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (valid) onTrack(trimmed);
  };

  return (
    <form onSubmit={submit} className={`flex flex-col gap-2 ${full ? 'items-stretch' : 'items-center'}`}>
      <div className={`flex items-center gap-2 ${full ? 'w-full' : ''}`}>
        <label htmlFor={id} className="sr-only">
          EVM address
        </label>
        <input
          id={id}
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="0x…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={`input num font-mono ${full ? 'min-w-0 flex-1' : 'w-96 max-w-full'} ${
            touched && !valid ? 'border-rose-500/60' : ''
          }`}
        />
        <button type="submit" className="btn-primary" disabled={touched && !valid}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn-ghost-xs" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      {touched && !valid && (
        <div className="text-xs text-rose-400">
          That doesn't look like an EVM address (expected 0x followed by 40 hex characters).
        </div>
      )}
    </form>
  );
}

/** "⟳ 8s ago" ticking freshness for the strategy query (amber on stale error). */
export function StrategyFreshness({
  dataUpdatedAt,
  staleError,
  onRefetch,
}: {
  dataUpdatedAt: number;
  staleError: boolean;
  onRefetch: () => void;
}) {
  return (
    <FreshnessButton
      dense
      dataUpdatedAt={dataUpdatedAt}
      staleError={staleError}
      title="Refetch strategy data"
      onRefetch={onRefetch}
    />
  );
}

/** Compact totals strip shown when the address runs more than one strategy.
 * Covers the Boros-tracked strategies only — perp-only boxes are not in the
 * server totals. Exit parts re-derived per the checked flags. */
const FLAGS_ON: CostFlags = { inclExitFees: true, inclExitSlippage: true, inclEntryCost: true };

export function TotalsStrip({ data }: { data: StrategyReturns }) {
  const flags = FLAGS_ON; // totals always include known future exit costs
  const { totals, strategies } = data;
  const weightedElapsed =
    totals.capitalUsd > 0
      ? strategies.reduce((s, x) => s + x.capitalUsd * (x.elapsedSeconds ?? 0), 0) / totals.capitalUsd
      : null;
  const { expectedUsd } = applyCostFlags({
    flags,
    perpExitFeesUsd: totals.perpExitFeesTotalUsd,
    perpExitSlippageUsd: totals.perpExitSlippageTotalUsd,
    // The totals payload carries no PAID perp entry breakdown, and it never
    // needs one: the entry cost is always included here, so the add-back is 0.
    perpEntryFeesUsd: 0,
    perpEntrySlippageUsd: null,
    realizedPnlUsd: totals.realizedPnlUsd,
    realizedApr: totals.realizedApr,
    expectedPnlToMaturityUsd: totals.expectedPnlToMaturityUsd,
    capitalUsd: totals.capitalUsd,
    elapsedSeconds: weightedElapsed,
  });
  // Honesty guards: the server sums per-strategy projections with null→0, and
  // null exit totals fold in as 0 — mark both cases instead of implying exact.
  const anyProjection = strategies.some((s) => s.expectedPnlToMaturityUsd !== null);
  const exitUnknown =
    (flags.inclExitFees && totals.perpExitFeesTotalUsd === null) ||
    (flags.inclExitSlippage && totals.perpExitSlippageTotalUsd === null);
  return (
    <div className="card flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 text-sm">
      <span className="text-[10px] uppercase tracking-wider text-ink-500">
        Boros-tracked totals
      </span>
      <span className="text-ink-400">
        Current PnL{' '}
        <SignedNumber value={totals.realizedPnlUsd} format={(n) => fmtUsd(n)} className="font-medium" />
      </span>
      <span className="text-ink-400">
        Realized APR{' '}
        {totals.realizedApr === null ? (
          <span className="num text-ink-400">—</span>
        ) : (
          <SignedNumber value={totals.realizedApr} format={(n) => fmtPct(n)} className="font-medium" />
        )}
      </span>
      <span className="text-ink-400">
        Capital <span className="num font-medium text-ink-100">{fmtUsd(totals.capitalUsd, 0)}</span>
      </span>
      <span className="text-ink-400">
        Est. by maturity{' '}
        {expectedUsd === null || !anyProjection ? (
          <span className="num" title="No strategy has a known start — nothing to project">
            —
          </span>
        ) : (
          <SignedNumber value={expectedUsd} format={(n) => fmtUsd(n, 0)} className="font-medium" />
        )}
        {exitUnknown && (
          <span
            className="text-amber-400"
            title="Some strategies' perp exit costs are unknown (fee schedule unavailable) — they are NOT included here even though the checkbox is on; the per-box numbers that can include them do."
          >
            *
          </span>
        )}
      </span>
    </div>
  );
}

/** The "Boros position open ✎" label under the timeline's start date. The ✎
 * opens an inline editor for a custom strategy-start override; Default
 * restores the Boros-open anchor. The override anchors the spread-lock
 * assumption AND the realized-APR window. */
export function TimelineClockEdit({
  since,
  basis,
  onChange,
}: {
  since: number | null;
  basis: 'boros-open' | 'perp-open' | 'custom' | null;
  onChange?: (since: number | null) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [bad, setBad] = useState(false);

  const label =
    since || basis === 'custom'
      ? 'custom start'
      : basis === 'perp-open'
        ? 'perp position open'
        : 'Boros position open';

  const apply = () => {
    const sec = Math.floor(new Date(draft).getTime() / 1000);
    if (!Number.isFinite(sec) || sec <= 0 || sec >= Math.floor(Date.now() / 1000)) {
      setBad(true);
      return;
    }
    onChange?.(sec);
    setOpen(false);
  };

  return (
    <span className="flex flex-wrap items-center gap-1 text-ink-600">
      <span title="Start of the strategy clock: the spread-lock assumption and the realized-APR window both run from here. Default: when the Boros legs opened.">
        {label}
      </span>
      {onChange && (
        <button
          type="button"
          aria-label="Edit the strategy start"
          title="Edit the strategy start"
          className="rounded px-0.5 leading-none text-ink-500 transition-colors hover:text-ink-200"
          onClick={() => {
            setDraft(since ? toLocalInput(since) : '');
            setBad(false);
            setOpen((v) => !v);
          }}
        >
          ✎
        </button>
      )}
      {open && (
        <span className="flex items-center gap-1">
          <label htmlFor={id} className="sr-only">
            APR clock start
          </label>
          <input
            id={id}
            type="datetime-local"
            className={`input px-1 py-0.5 text-xs ${bad ? 'border-rose-500/60' : ''}`}
            value={draft}
            max={toLocalInput(Math.floor(Date.now() / 1000))}
            onChange={(e) => {
              setDraft(e.target.value);
              setBad(false);
            }}
          />
          <button type="button" className="btn-ghost-xs" onClick={apply}>
            Apply
          </button>
          <button
            type="button"
            className="btn-ghost-xs"
            title="Reset to the default (earliest Boros leg open)"
            onClick={() => {
              onChange?.(null);
              setOpen(false);
            }}
          >
            Default
          </button>
        </span>
      )}
    </span>
  );
}
