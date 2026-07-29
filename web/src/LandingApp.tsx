import { BrandMark } from './components/BrandMark';
import { REPO_URL } from './lib/landing';
import { LandingOnboardingGuide } from './panels/LandingOnboardingGuide';
import { OpportunitiesPanel } from './panels/OpportunitiesPanel';
import { TradeFlowProvider } from './trade/TradeFlow';

/** The public landing shell: the first-run terminal view with every credential
 * surface removed — no settings drawer, no account pollers, no key input
 * anywhere. Reached only through main-landing.tsx, so the terminal bundle never
 * includes it and this bundle never includes the credentials form.
 * TradeFlowProvider mounts no queries; it only carries the Execute→guide nudge. */
export function LandingApp() {
  return (
    <TradeFlowProvider>
      <div className="flex min-h-full flex-col">
        <header className="sticky top-0 z-40 border-b border-ink-800 bg-ink-950/80 backdrop-blur">
          <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
            <BrandMark />
            <div className="ml-auto flex items-center gap-2">
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-ink-700 bg-ink-900 px-2.5 py-1 text-sm text-ink-400 transition-colors hover:border-ink-500 hover:text-ink-100"
              >
                View on GitHub
              </a>
            </div>
          </div>
        </header>

        {/* Stacked below lg: the rail is a fixed 360px that cannot shrink, so in
            a row it left the content column max(0, VW-420) — literally 0px on
            every phone, with the sticky rail painting over (and swallowing the
            taps for) the Execute buttons underneath. Rates lead; guide follows. */}
        <main className="mx-auto flex w-full max-w-[1500px] flex-1 flex-col gap-5 px-5 py-5 lg:flex-row lg:items-start">
          <section className="min-w-0 flex-1">
            <h2 className="mb-3 text-[34px] font-bold leading-tight tracking-tight text-ink-100">
              Live fixed rates, up for grabs
            </h2>
            <OpportunitiesPanel unconfigured />
          </section>

          <LandingOnboardingGuide />
        </main>
      </div>
    </TradeFlowProvider>
  );
}
