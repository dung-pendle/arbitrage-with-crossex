/** react-query hooks for every monitoring endpoint. All list/table queries use
 * `placeholderData: keepPreviousData` so background refetches never blank tables. */
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { del, fetchJson, postJson, putJson } from './client';
import type {
  DealAlert,
  DealView,
  BookTouch,
  BorosEntryMode,
  CredentialsInfo,
  CredentialsInput,
  DisclaimerStatus,
  CrossexAccount,
  EntryMode,
  ExitMode,
  LeverageInfo,
  OpenOrder,
  OpportunitiesResult,
  PositionsResponse,
  StrategyReturns,
  SymbolDetail,
  SymbolRule,
  TradesResponse,
  VenueFees,
} from './types';

export const qk = {
  credentials: ['credentials'] as const,
  disclaimer: ['disclaimer'] as const,
  account: ['account'] as const,
  positions: ['positions'] as const,
  openOrders: ['orders', 'open'] as const,
  trades: ['trades'] as const,
  fees: ['fees'] as const,
  symbols: (q: string) => ['symbols', q] as const,
  symbolsByBase: (base: string) => ['symbols', 'base', base] as const,
  symbolDetail: (symbol: string) => ['symbolDetail', symbol] as const,
  strategy: (address: string, since: number | null) => ['strategy', address, since ?? ''] as const,
  opportunities: (
    notionalUsd: number,
    borosEntry: BorosEntryMode,
    entryMode: EntryMode,
    exitMode: ExitMode,
    feeTier: string | undefined,
  ) => ['opportunities', notionalUsd, borosEntry, entryMode, exitMode, feeTier ?? ''] as const,
  deal: (id: string) => ['deal', id] as const,
  activeDeals: ['deals', 'active'] as const,
  alerts: ['alerts'] as const,
};

export function useCredentials() {
  return useQuery({
    queryKey: qk.credentials,
    queryFn: () => fetchJson<CredentialsInfo>('/credentials'),
    staleTime: Infinity, // fetch once; invalidated explicitly after a PUT
    // When the query is in an error state (no data), a NEW observer mounting
    // retries it by default (`retryOnMount`), and each retry flips `isPending`
    // back to true — App would bounce between the skeleton and the first-run
    // view for as long as the error persists. Recovery is explicit (PUT
    // invalidation / manual refetch), matching the "fetch once" contract.
    retryOnMount: false,
  });
}

export function useAccount() {
  return useQuery({
    queryKey: qk.account,
    queryFn: () => fetchJson<CrossexAccount>('/account'),
    refetchInterval: 5_000,
    placeholderData: keepPreviousData,
  });
}

export function usePositions() {
  return useQuery({
    queryKey: qk.positions,
    queryFn: () => fetchJson<PositionsResponse>('/positions'),
    refetchInterval: 4_000,
    placeholderData: keepPreviousData,
  });
}

export function useOpenOrders(symbol?: string) {
  const search = symbol ? `?symbol=${encodeURIComponent(symbol)}` : '';
  return useQuery({
    queryKey: [...qk.openOrders, symbol ?? ''] as const,
    queryFn: () => fetchJson<OpenOrder[]>(`/orders/open${search}`),
    refetchInterval: 4_000,
    placeholderData: keepPreviousData,
  });
}

export function useTrades(limit = 100) {
  return useInfiniteQuery({
    queryKey: [...qk.trades, limit] as const,
    queryFn: ({ pageParam }) =>
      fetchJson<TradesResponse>(`/trades?limit=${limit}&page=${pageParam}&join=1`),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
}

/** 4-leg strategy returns for the tracked EVM address (Boros legs + perp overlay).
 * Settlements are hourly at the fastest — 30s keeps the card feeling live.
 * Deliberately NO keepPreviousData: after a Change to a different address the
 * old address's financial data must never render attributed to the new one
 * (same-key background polls keep data without it). */
export function useStrategy(address: string | null, since: number | null = null) {
  const search = since ? `?since=${since}` : '';
  return useQuery({
    queryKey: qk.strategy(address ?? '', since),
    queryFn: () => fetchJson<StrategyReturns>(`/strategy/${encodeURIComponent(address ?? '')}${search}`),
    enabled: Boolean(address),
    refetchInterval: 30_000,
  });
}

export interface OpportunitiesParams {
  notionalUsd: number;
  borosEntry: BorosEntryMode;
  entryMode: EntryMode;
  exitMode: ExitMode;
  /** Simulate a Gate CrossEx VIP fee tier (e.g. 'vip0') instead of the
   * account's live schedule — the unconfigured view always sends one. */
  feeTier?: string;
}

/** Route bounds (src/server/routes/opportunities.ts): anything outside them is
 * a 400, so the hook must not send it. */
export const OPPORTUNITY_NOTIONAL_MIN = 1_000;
export const OPPORTUNITY_NOTIONAL_MAX = 100_000_000;

/** Mirror of the server's simulated CrossEx fee tiers
 * (src/core/estimate/crossexFeeTiers.ts) — anything else is a 400. */
export const OPPORTUNITY_FEE_TIERS = Array.from(
  { length: 17 },
  (_, i) => `vip${i}` as const,
) as readonly `vip${number}`[];
export type OpportunityFeeTier = (typeof OPPORTUNITY_FEE_TIERS)[number];

export function isValidOpportunityNotional(notionalUsd: number): boolean {
  return (
    Number.isFinite(notionalUsd) &&
    notionalUsd >= OPPORTUNITY_NOTIONAL_MIN &&
    notionalUsd <= OPPORTUNITY_NOTIONAL_MAX
  );
}

/** Forward-looking fixed-return opportunities across the Boros arb groups.
 * The size and the three modes are all part of the key — every combination is
 * a different computation. `keepPreviousData` covers both the 12s poll and a
 * size/mode switch, so the cards never blank out mid-recompute (read
 * `isPlaceholderData` to dim them). */
export function useOpportunities(p: OpportunitiesParams) {
  const search =
    `?notionalUsd=${p.notionalUsd}&borosEntry=${p.borosEntry}` +
    `&entryMode=${p.entryMode}&exitMode=${p.exitMode}` +
    (p.feeTier ? `&feeTier=${p.feeTier}` : '');
  return useQuery({
    queryKey: qk.opportunities(p.notionalUsd, p.borosEntry, p.entryMode, p.exitMode, p.feeTier),
    queryFn: () => fetchJson<OpportunitiesResult>(`/opportunities${search}`),
    enabled: isValidOpportunityNotional(p.notionalUsd),
    refetchInterval: 12_000,
    placeholderData: keepPreviousData,
  });
}

export function useFees() {
  return useQuery({
    queryKey: qk.fees,
    queryFn: () => fetchJson<VenueFees[]>('/fees'),
    refetchInterval: 600_000,
    placeholderData: keepPreviousData,
  });
}

export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) => del<unknown>(`/orders/${encodeURIComponent(orderId)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.openOrders }),
  });
}

/** First-run disclaimer acceptance state (fetch once; the accept mutation updates
 * it in place). Not registered in public mode, where it resolves 404 → treated as
 * not-required by the gate (which only mounts in the terminal build). */
export function useDisclaimer() {
  return useQuery({
    queryKey: qk.disclaimer,
    queryFn: () => fetchJson<DisclaimerStatus>('/disclaimer'),
    staleTime: Infinity,
    retryOnMount: false,
  });
}

export function useAcceptDisclaimer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (version: string) => postJson<DisclaimerStatus>('/disclaimer/accept', { version }),
    onSuccess: (data) => qc.setQueryData(qk.disclaimer, data),
  });
}

// ---------------------------------------------------------------------------
// Trading hooks
// ---------------------------------------------------------------------------

/** Symbols filtered to one base coin (pair-ticket venue rows). */
export function useSymbolsByBase(base: string | null) {
  return useQuery({
    queryKey: qk.symbolsByBase(base ?? ''),
    queryFn: () => fetchJson<SymbolRule[]>(`/symbols?base=${encodeURIComponent(base ?? '')}`),
    enabled: Boolean(base),
    staleTime: 300_000,
    placeholderData: keepPreviousData,
  });
}

/** One symbol's rule + leverageMax (ticket leverage cap, tick snapping). */
export function useSymbolDetail(symbol: string | null) {
  return useQuery({
    queryKey: qk.symbolDetail(symbol ?? ''),
    queryFn: () => fetchJson<SymbolDetail>(`/symbols/${encodeURIComponent(symbol ?? '')}`),
    enabled: Boolean(symbol),
    staleTime: 300_000,
  });
}

/** Poll one deal every second while it works; stop at DONE (kept for review). */
export function useDealView(id: string | null) {
  return useQuery({
    queryKey: qk.deal(id ?? ''),
    queryFn: () => fetchJson<DealView>(`/deals/${encodeURIComponent(id ?? '')}`),
    enabled: Boolean(id),
    refetchInterval: (query) => (query.state.data?.pair.mode === 'DONE' ? false : 1_000),
    refetchIntervalInBackground: true,
  });
}

/** Venue touch for the re-peg decision UI — polls only while enabled. */
export function useVenueBook(symbol: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['book', symbol ?? ''] as const,
    queryFn: () => fetchJson<BookTouch>(`/books/${encodeURIComponent(symbol ?? '')}`),
    enabled: enabled && Boolean(symbol),
    refetchInterval: 2_500,
    placeholderData: keepPreviousData,
  });
}

/** Deal commands: one-row intent edits the reconcile loop reads on its next tick. */
export function useDealCommand(command: 'convert' | 'repeg' | 'stop' | 'resume') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body?: Record<string, unknown> }) =>
      postJson<{ id: string }>(`/deals/${encodeURIComponent(id)}/${command}`, body ?? {}),
    onSuccess: (_r, { id }) => void qc.invalidateQueries({ queryKey: qk.deal(id) }),
  });
}

/** Deals still working (the recovery banner + a tab-reload's way back in). */
export function useActiveDeals() {
  return useQuery({
    queryKey: qk.activeDeals,
    queryFn: () => fetchJson<DealView[]>('/deals?active=1'),
    refetchInterval: 5_000,
    refetchIntervalInBackground: true,
  });
}

/** Standing engine alerts (walls, quarantines, unresolved orders). */
export function useAlerts() {
  return useQuery({
    queryKey: qk.alerts,
    queryFn: () => fetchJson<DealAlert[]>('/alerts?unacked=1'),
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  });
}

export function useAckAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => postJson<{ acked: boolean }>(`/alerts/${id}/ack`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.alerts }),
  });
}

/** PUT /api/leverage/:symbol; positions carry leverage, so bust them. */
export function useSetLeverage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ symbol, leverage }: { symbol: string; leverage: number }) =>
      putJson<LeverageInfo>(`/leverage/${encodeURIComponent(symbol)}`, { leverage }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.positions }),
  });
}

/** PUT /api/credentials — the backend route ships later; callers must handle
 * 404/network errors gracefully ("credentials service not available yet"). */
export function usePutCredentials() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CredentialsInput) => putJson<CredentialsInfo>('/credentials', body),
    onSuccess: () => qc.invalidateQueries(), // credentials changed — everything is suspect
  });
}
