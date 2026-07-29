import { useState } from 'react';
import { useCredentials, useOpenOrders } from './api/queries';
import { AccountHealthStrip } from './components/AccountHealthStrip';
import { BrandMark } from './components/BrandMark';
import { Chip } from './components/Chip';
import { DisclaimerGate } from './components/DisclaimerGate';
import { CollapsibleSection, SectionsProvider } from './components/CollapsibleSection';
import { FreshnessIndicator } from './components/FreshnessIndicator';
import { SectionNav } from './components/SectionNav';
import { TableSkeleton } from './components/Skeleton';
import { BalancesPanel } from './panels/BalancesPanel';
import { FeesPanel } from './panels/FeesPanel';
import { OnboardingGuide } from './panels/OnboardingGuide';
import { OpenOrdersPanel } from './panels/OpenOrdersPanel';
import { OpportunitiesPanel } from './panels/OpportunitiesPanel';
import { PositionsHome } from './panels/PositionsHome';
import { SettingsDrawer } from './panels/SettingsDrawer';
import { TradesPanel } from './panels/TradesPanel';
import { RecoveryBanner } from './trade/RecoveryBanner';
import { TradeFlowProvider } from './trade/TradeFlow';
import { TradeRail } from './trade/TradeRail';

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const credentials = useCredentials();
  const openOrders = useOpenOrders();

  // Once the credentials query settles (not pending), anything short of a
  // confirmed `configured: true` — including a load ERROR (data undefined) —
  // means we must NOT expose the live trading UI. Fall back to the first-run
  // view: live opportunities on the left, the setup guide on the right.
  const setupNeeded = !credentials.isPending && !credentials.data?.configured;
  const orderCount = openOrders.data?.length ?? 0;
  const ordersBadge =
    orderCount > 0 ? (
      <Chip sm tone="cyan" className="num" title={`${orderCount} open order${orderCount === 1 ? '' : 's'}`}>
        {orderCount}
      </Chip>
    ) : undefined;

  return (
    <TradeFlowProvider>
      <DisclaimerGate />
      <div className="flex min-h-full flex-col">
          <header className="sticky top-0 z-40 border-b border-ink-800 bg-ink-950/80 backdrop-blur">
            <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
              <BrandMark />
              {/* Unconfigured, /api/account 503s forever and the strip would
                  sit on its loading skeleton — hide it until keys exist. */}
              {!setupNeeded && <AccountHealthStrip />}
              <div className="ml-auto flex items-center gap-2">
                <FreshnessIndicator />
                <button
                  type="button"
                  aria-label="Settings"
                  title="Settings"
                  onClick={() => setSettingsOpen(true)}
                  className="rounded-md border border-ink-700 bg-ink-900 px-2 py-1 text-sm text-ink-400 transition-colors hover:border-ink-500 hover:text-ink-100"
                >
                  ⚙
                </button>
              </div>
            </div>
          </header>

          {credentials.data?.configured && <RecoveryBanner />}

          <main className="mx-auto flex w-full max-w-[1500px] flex-1 items-start gap-5 px-5 py-5">
            <section className="min-w-0 flex-1">
              {credentials.isPending ? (
                <TableSkeleton rows={6} cols={7} />
              ) : setupNeeded ? (
                <>
                  <h2 className="mb-3 text-[34px] font-bold leading-tight tracking-tight text-ink-100">
                    Live fixed rates, up for grabs
                  </h2>
                  <OpportunitiesPanel unconfigured />
                </>
              ) : (
                <SectionsProvider>
                  <div className="flex items-start gap-4">
                    <SectionNav
                      sections={[
                        { id: 'opportunities', label: 'Opportunities' },
                        { id: 'positions', label: 'Positions' },
                        { id: 'balances', label: 'Balances' },
                        { id: 'orders', label: 'Open Orders', badge: ordersBadge },
                        { id: 'trades', label: 'Trades' },
                        { id: 'fees', label: 'Fees' },
                      ]}
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-4">
                      {/* Forward-looking: what to put on next, above what is on. */}
                      <CollapsibleSection id="opportunities" title="Opportunities" defaultOpen>
                        <OpportunitiesPanel />
                      </CollapsibleSection>
                      {/* Home base — the 4-leg boxes; always visible, never collapses. */}
                      <section id="positions" aria-label="Positions" className="scroll-mt-16">
                        <h2 className="mb-3 text-sm font-semibold text-ink-100">Positions</h2>
                        <PositionsHome />
                      </section>
                      <CollapsibleSection id="balances" title="Balances" defaultOpen>
                        <BalancesPanel />
                      </CollapsibleSection>
                      <CollapsibleSection id="orders" title="Open Orders" badge={ordersBadge} defaultOpen={false}>
                        <OpenOrdersPanel />
                      </CollapsibleSection>
                      <CollapsibleSection id="trades" title="Trades" defaultOpen={false}>
                        <TradesPanel />
                      </CollapsibleSection>
                      <CollapsibleSection id="fees" title="Fees" defaultOpen={false}>
                        <FeesPanel />
                      </CollapsibleSection>
                    </div>
                  </div>
                </SectionsProvider>
              )}
            </section>

            {setupNeeded ? <OnboardingGuide /> : <TradeRail />}
          </main>

        <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </div>
    </TradeFlowProvider>
  );
}
