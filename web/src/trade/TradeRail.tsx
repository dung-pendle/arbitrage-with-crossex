/** Right rail: the order ticket ([Pair | Single], pair-first). */
import { useEffect, useRef, useState } from 'react';
import { SegmentedToggle } from '../components/SegmentedToggle';
import { PairTicket } from './PairTicket';
import { SingleTicket } from './SingleTicket';
import { useTradeFlowOptional } from './TradeFlow';

type TicketMode = 'single' | 'pair';

export function TradeRail() {
  // Pair is the default: the terminal exists for delta-neutral pair entries.
  const [mode, setMode] = useState<TicketMode>('pair');
  const flow = useTradeFlowOptional();
  const asideRef = useRef<HTMLElement>(null);

  // A strategy-box "Open the perp legs" prefill lands here: make sure the pair
  // ticket is visible (PairTicket itself consumes the field values).
  const prefillNonce = flow?.pairPrefill?.nonce ?? 0;
  useEffect(() => {
    if (!prefillNonce) return;
    setMode('pair');
    asideRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [prefillNonce]);

  return (
    // The 340px is mirrored by TabBar's right slot so the active tab's cyan
    // shelf ends exactly where this rail begins — change both together.
    <aside ref={asideRef} className="flex w-[340px] shrink-0 flex-col gap-4" aria-label="Order ticket">
      <div className="card px-4 py-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-100">Order ticket</h2>
          <SegmentedToggle<TicketMode>
            ariaLabel="Ticket mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'pair', label: 'Pair' },
              { value: 'single', label: 'Single' },
            ]}
          />
        </div>
        {mode === 'single' ? <SingleTicket /> : <PairTicket />}
      </div>
    </aside>
  );
}
