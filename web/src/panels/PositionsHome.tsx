/**
 * The home view: every position is a box of a 4-leg fixed-return position.
 *  - complete/partial/boros-only boxes come from the strategy feed (Boros legs
 *    by tracked address + Gate perp overlay, 30s poll),
 *  - perp-only and stray boxes come from the live exposure groups (4s poll),
 *  - buildBoxes guarantees every position appears in exactly one box.
 * Owns the persisted {address, since, exit flags} state and both queries;
 * the boxes themselves are prop-driven.
 */
import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { qk, usePositions, useStrategy } from '../api/queries';
import type { CrossexPosition, StrategyRollup } from '../api/types';
import { EmptyState } from '../components/EmptyState';
import { Notes } from '../components/Notes';
import { QueryError } from '../components/QueryError';
import { TableSkeleton } from '../components/Skeleton';
import { useTradeFlowOptional } from '../trade/TradeFlow';
import { AddressForm, short, StrategyFreshness, TotalsStrip } from './HomeControls';
import { buildBoxes } from './homeBoxes';
import { useTrackedAddress } from './trackedAddress';
import { PerpOnlyBox, type PerpOnlyCue } from './PerpOnlyBox';
import { StrategyCard } from './StrategyCard';

export function PositionsHome() {
  const { address, since, setAddress, setSince, openSettings } = useTrackedAddress();
  const qc = useQueryClient();
  const flow = useTradeFlowOptional();

  const positionsQuery = usePositions();
  const strategyQuery = useStrategy(address, since);

  const track = (next: string) => setAddress(next);
  const changeSince = (next: number | null) => setSince(next);

  const strategyData = strategyQuery.data;
  const positionsData = positionsQuery.data;
  const boxes = useMemo(
    () => buildBoxes(strategyData, positionsData),
    [strategyData, positionsData],
  );

  const livePositions = useMemo(() => {
    const map = new Map<string, CrossexPosition>();
    for (const p of positionsData?.positions ?? []) map.set(p.symbol, p);
    return map;
  }, [positionsData?.positions]);

  // Perp-only cue: never claim "no Boros position" unless the strategy feed
  // has actually SETTLED successfully for the tracked address.
  const perpOnlyCue: PerpOnlyCue = !address
    ? 'add-address'
    : strategyQuery.isSuccess
      ? 'execute-boros'
      : 'boros-pending';

  // Boros-only cue → prefill the pair ticket. Mapping: the perp side equals
  // the Boros side at the same venue (both cancel that venue's floating rate).
  // Sizing: the larger Boros side (identical to Σ/2 for the canonical 2-leg
  // book, and the full leg size when only one Boros leg exists so far).
  const openPerpLegs =
    flow &&
    ((s: StrategyRollup) => {
      const borosLegs = s.legs.filter((l) => l.kind === 'boros');
      const sideNotional = (side: 'LONG' | 'SHORT') =>
        borosLegs.filter((l) => l.side === side).reduce((sum, l) => sum + l.notionalUsd, 0);
      flow.prefillPair({
        base: s.base,
        longVenue: borosLegs.find((l) => l.side === 'LONG')?.venue ?? null,
        shortVenue: borosLegs.find((l) => l.side === 'SHORT')?.venue ?? null,
        notionalUsd: Math.max(sideNotional('LONG'), sideNotional('SHORT')),
      });
    });

  const header = (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-400">
        4-leg fixed-return positions
      </h2>
      {address && (
        <span className="flex flex-wrap items-center gap-2 text-xs">
          {/* The address is edited in Settings now — the chip just jumps there. */}
          <button
            type="button"
            className="num text-ink-300 transition-colors hover:text-ink-100"
            title={`${address} — change the tracked address in Settings`}
            onClick={openSettings}
          >
            {short(address)} ✎
          </button>
          <StrategyFreshness
            dataUpdatedAt={strategyQuery.dataUpdatedAt || 0}
            staleError={strategyQuery.isError && strategyQuery.data !== undefined}
            onRefetch={() =>
              void qc.invalidateQueries({ queryKey: qk.strategy(address, since) })
            }
          />
        </span>
      )}
    </div>
  );

  // Nothing to draw boxes from yet. Also: with zero boxes we must not render
  // the definitive "No positions" claim while the strategy feed is still
  // pending — hold the skeleton until BOTH feeds have settled.
  const positionsPending = positionsQuery.isPending;
  const strategyPending = Boolean(address) && strategyQuery.isPending;
  if (
    (positionsPending && (!address || strategyPending)) ||
    (boxes.length === 0 && (positionsPending || strategyPending))
  ) {
    return (
      <div>
        {header}
        <TableSkeleton rows={4} cols={6} />
      </div>
    );
  }

  const positionsFailed = positionsQuery.isError && !positionsData;
  const strategyFailed = Boolean(address) && strategyQuery.isError && !strategyQuery.data;

  return (
    <div>
      {header}
      {strategyData && <Notes items={strategyData.warnings} className="mb-2" />}
      {strategyFailed && (
        <QueryError
          title="Couldn't load Boros strategy data"
          error={strategyQuery.error}
          onRetry={() => void strategyQuery.refetch()}
          className="mb-3"
        />
      )}
      {positionsFailed && (
        <QueryError title="Couldn't load positions" error={positionsQuery.error} className="mb-3" />
      )}

      {boxes.length === 0 && !strategyFailed && !positionsFailed ? (
        !address ? (
          <EmptyState
            icon="◈"
            title="Track your 4-leg strategy"
            hint="Enter the EVM address holding your Boros legs — the terminal matches them with your Gate perp legs and shows your locked and realized return, net of all costs. Perp pairs without Boros legs show up here too."
            action={<AddressForm submitLabel="Track" onTrack={track} />}
          />
        ) : (
          <EmptyState
            icon="◎"
            title="No positions"
            hint={`No perp positions in the connected account and no Boros positions on ${short(address)} (accountId 0). Open a delta-neutral pair from the order ticket to start a 4-leg position.`}
          />
        )
      ) : (
        <div className="flex flex-col gap-3">
          {strategyData && strategyData.strategies.length > 1 && (
            <TotalsStrip data={strategyData} />
          )}
          {boxes.map((box) =>
            box.kind === 'strategy' ? (
              <StrategyCard
                key={`s:${box.rollup.base}@${box.rollup.maturity}`}
                strategy={box.rollup}
                perpSource={strategyData?.perpSource ?? null}
                since={since}
                onChangeSince={changeSince}
                livePositions={livePositions}
                onOpenPerpLegs={openPerpLegs || undefined}
              />
            ) : (
              <PerpOnlyBox
                key={`${box.kind}:${box.group.base}`}
                group={box.group}
                stray={box.kind === 'stray'}
                livePositions={livePositions}
                cue={perpOnlyCue}
                address={address}
                onTrack={track}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}
