/** The perp entry cost, itemised and tickable.
 *
 * A position built across several executions — a venue migration, a DCA top-up,
 * legs rolled in from a previous maturity — was charged for all of them. Only
 * the user knows which ones belong to THIS strategy, so each is listed with what
 * it cost and when, and un-ticking one hands it back.
 *
 * The two kinds are not equally resolved, and the rows say so rather than
 * implying a precision the data doesn't have: slippage is per execution, fees
 * are per leg over that position's whole life. */
import type { PerpEntryCostPart } from '../api/types';
import { SignedNumber } from '../components/SignedNumber';
import { microLabelClass } from '../components/Th';
import { fmtDateLocal, fmtUsd, num, prettyVenue } from '../lib/fmt';

/** Newest first, then fees last — the executions are the interesting part, and
 * the per-leg fee rows are the constant tail. */
function ordered(parts: readonly PerpEntryCostPart[]): PerpEntryCostPart[] {
  return [...parts].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'slippage' ? -1 : 1;
    return (a.atSec ?? 0) - (b.atSec ?? 0);
  });
}

function Row({
  part,
  checked,
  onToggle,
}: {
  part: PerpEntryCostPart;
  checked: boolean;
  onToggle: () => void;
}) {
  const venues = part.venues.map(prettyVenue).join(' ↔ ');
  const when = part.atSec === null ? 'position life' : fmtDateLocal(part.atSec);
  return (
    <label
      data-part={part.id}
      className={`flex items-center gap-2 py-0.5 text-[11px] transition-opacity ${
        checked ? '' : 'opacity-45'
      }`}
      title={
        part.kind === 'slippage'
          ? `The crossing cost of this execution: (long fill − short fill) × ${num(part.qty ?? 0)} matched. Untick it if these fills belong to an earlier strategy.`
          : "Gate reports this position's trading fees as one cumulative number covering its whole life, so it cannot be split per execution. Untick it if the position was opened before this strategy."
      }
    >
      <input type="checkbox" className="chk" checked={checked} onChange={onToggle} />
      <span className="w-[74px] shrink-0 text-ink-400">
        {part.kind === 'slippage' ? 'Entry slip' : 'Fees'}
      </span>
      <span className="w-[86px] shrink-0 text-ink-500">{when}</span>
      <span className="min-w-0 flex-1 truncate text-ink-300">
        {part.side ? `${part.side.toLowerCase()} ` : ''}
        {venues}
        {part.qty !== null && <span className="text-ink-500"> · {num(part.qty)}</span>}
      </span>
      <SignedNumber
        value={-part.usd}
        format={(n) => fmtUsd(Math.abs(n), 2)}
        className="shrink-0 text-right"
      />
    </label>
  );
}

export function EntryCostParts({
  id,
  parts,
  excluded,
  onToggle,
  chargedUsd,
}: {
  id: string;
  parts: readonly PerpEntryCostPart[];
  excluded: ReadonlySet<string>;
  onToggle: (partId: string) => void;
  /** What the position is still charged, after the ticks. */
  chargedUsd: number;
}) {
  if (parts.length === 0) {
    return (
      <div id={id} className="mt-1.5 rounded-lg border border-ink-700 bg-ink-950/60 p-2.5 text-[11px] text-ink-400">
        This position's entry cost couldn't be itemised — use Omit to drop it whole.
      </div>
    );
  }
  return (
    <div id={id} className="mt-1.5 rounded-lg border border-ink-700 bg-ink-950/60 px-2.5 py-2">
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className={microLabelClass}>Charged to this position</span>
        <span className="num text-[11px] font-medium text-amber-300">−{fmtUsd(chargedUsd, 2)}</span>
      </div>
      {ordered(parts).map((p) => (
        <Row key={p.id} part={p} checked={!excluded.has(p.id)} onToggle={() => onToggle(p.id)} />
      ))}
    </div>
  );
}
