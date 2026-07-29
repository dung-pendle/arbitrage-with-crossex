/**
 * Trade-flow orchestrator: owns the single execution-view modal slot and the
 * pair-ticket prefill channel.
 *
 * Execution is inline everywhere now (hold-to-confirm + hover review via
 * <ExecuteControl>); this provider no longer gates money behind a review modal.
 * Its jobs: surface the DealModal once a deal is executing (openDeal is called
 * by ExecuteControl on a 202 and by the recovery banner), and carry "open the
 * perp legs" prefills from the strategy boxes to the PairTicket (prefillPair
 * bumps a nonce; the ticket consumes it once).
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { DealModal } from './DealModal';
import type { ExecMode } from './PairTicketBits';

export interface PairPrefill {
  base: string;
  /** Venue keys (BINANCE / HYPERLIQUID / …); null = leave that leg unselected. */
  longVenue: string | null;
  shortVenue: string | null;
  notionalUsd: number;
  /** Execution mode to arm the ticket with; omitted = leave the user's choice. */
  mode?: ExecMode;
  /** Monotonic — a new prefill with identical content still re-applies. */
  nonce: number;
}

export interface TradeFlowApi {
  modalOpen: boolean;
  /** Show the live deal view (post-202, or the recovery banner). */
  openDeal: (dealId: string) => void;
  pairPrefill: PairPrefill | null;
  /** Prefill the pair ticket (strategy-box "Open the perp legs" cue). */
  prefillPair: (p: Omit<PairPrefill, 'nonce'>) => void;
}

const Ctx = createContext<TradeFlowApi | null>(null);

export function useTradeFlow(): TradeFlowApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTradeFlow must be used inside <TradeFlowProvider>');
  return ctx;
}

/** Null-tolerant variant for panels that render in provider-less unit tests. */
export function useTradeFlowOptional(): TradeFlowApi | null {
  return useContext(Ctx);
}

export function TradeFlowProvider({ children }: { children: ReactNode }) {
  const [dealId, setDealId] = useState<string | null>(null);
  const [pairPrefill, setPairPrefill] = useState<PairPrefill | null>(null);
  const prefillNonce = useRef(0);

  const openDeal = useCallback((id: string) => setDealId(id), []);
  const prefillPair = useCallback((p: Omit<PairPrefill, 'nonce'>) => {
    prefillNonce.current += 1;
    setPairPrefill({ ...p, nonce: prefillNonce.current });
  }, []);

  const api = useMemo<TradeFlowApi>(
    () => ({ modalOpen: dealId !== null, openDeal, pairPrefill, prefillPair }),
    [dealId, openDeal, pairPrefill, prefillPair],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      {dealId !== null && <DealModal key={dealId} dealId={dealId} onClose={() => setDealId(null)} />}
    </Ctx.Provider>
  );
}
