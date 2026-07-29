import { useEffect, useState } from 'react';
import { CopyBlock } from '../components/CopyBlock';
import { SegmentedToggle } from '../components/SegmentedToggle';
import { AUDIT_PROMPT, INSTALL_CMD, INSTALL_CMD_WINDOWS, LOCAL_APP_URL, REPO_URL } from '../lib/landing';
import { useTradeFlowOptional } from '../trade/TradeFlow';
import { Ext, GATE_API_KEYS_URL, GATE_CROSSEX_URL, GATE_SIGNUP_URL, Step, useNudge } from './onboardingBits';

type Os = 'macos' | 'windows';

/** Default the install command to the visitor's own platform, so the common
 * case is copy-and-go. Anything we can't identify falls back to macOS. */
function detectOs(): Os {
  if (typeof navigator === 'undefined') return 'macos';
  return /Windows|Win32|Win64/i.test(navigator.userAgent) ? 'windows' : 'macos';
}

/** Public-site rail: same shell and Gate steps as OnboardingGuide, but step 1 is
 * installing the terminal and no key ever touches this page — the API-key step
 * sends the visitor to the setup guide of their locally-running copy instead of
 * embedding the form, and the Execute nudge flashes the install command. */
export function LandingOnboardingGuide() {
  const flow = useTradeFlowOptional();
  const nonce = flow?.pairPrefill?.nonce ?? 0;
  const { ref: installRef, flash } = useNudge(nonce);
  const [os, setOs] = useState<Os>(detectOs);
  const windows = os === 'windows';

  // Every step starts closed: six steps of full content buries the live rates
  // that are the actual pitch. Titles alone read as a short, scannable promise.
  const [openSteps, setOpenSteps] = useState<ReadonlySet<number>>(() => new Set());
  const toggle = (n: number) =>
    setOpenSteps((prev) => {
      const next = new Set(prev);
      if (!next.delete(n)) next.add(n);
      return next;
    });
  const step = (n: number) => ({
    collapsible: true as const,
    open: openSteps.has(n),
    onToggle: () => toggle(n),
  });

  // The Execute nudge flashes the install command — open its step first, or
  // there is nothing on screen to flash.
  useEffect(() => {
    if (!nonce) return;
    setOpenSteps((prev) => (prev.has(1) ? prev : new Set(prev).add(1)));
  }, [nonce]);

  return (
    <aside className="sticky top-16 w-[360px] shrink-0 self-start" aria-label="Setup guide">
      <div className="card px-5 py-5">
        <h2 className="text-xl font-bold tracking-tight text-ink-100">How to execute</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-300">
          Every number on the left is live. Six steps and you can take them.
        </p>
        <ol className="mt-5 flex flex-col gap-[18px]">
          <Step n={1} title="Install the terminal" active {...step(1)}>
            Runs locally on your own machine — free and <Ext href={REPO_URL}>open source</Ext>. Pick
            your system, paste the command, press Return:
            <div
              ref={installRef}
              className="relative mt-2 flex flex-col gap-2 rounded-lg border border-ink-700 bg-ink-950 p-3"
            >
              {flash && <div aria-hidden="true" className="flash-ring" />}
              <SegmentedToggle<Os>
                ariaLabel="Operating system"
                value={os}
                onChange={setOs}
                options={[
                  { value: 'macos', label: <span className="text-xs">macOS</span> },
                  { value: 'windows', label: <span className="text-xs">Windows</span> },
                ]}
              />
              <CopyBlock text={windows ? INSTALL_CMD_WINDOWS : INSTALL_CMD} />
              <span className="text-[10.5px] leading-relaxed text-ink-400">
                {windows
                  ? 'In Windows PowerShell — press Win, type PowerShell, open it. Windows 10 or 11; nothing to install first.'
                  : 'In the Terminal app.'}
              </span>
              <a
                href={LOCAL_APP_URL}
                target="_blank"
                rel="noreferrer"
                className="btn btn-primary justify-center text-xs font-semibold"
              >
                After that, open http://localhost:6688 ↗
              </a>
              <span className="text-center text-[10.5px] text-ink-400">
                It never asks for keys in the terminal.
              </span>
            </div>
          </Step>
          <Step n={2} title="Audit it with your own AI" {...step(2)}>
            Don’t take our word for it. Paste this into whichever assistant you trust — ChatGPT,
            Claude, Gemini — and have it read the source before you hand anything real to it:
            <div className="mt-2 rounded-lg border border-ink-700 bg-ink-950 p-3">
              <CopyBlock text={AUDIT_PROMPT} label="Copy audit prompt" />
            </div>
          </Step>
          <Step n={3} title="Fund Gate" {...step(3)}>
            Sign up on <Ext href={GATE_SIGNUP_URL}>gate.com/signup</Ext>, deposit the capital
            you’ll deploy.
          </Step>
          <Step n={4} title="Enable CrossEx" {...step(4)}>
            Move funds into <Ext href={GATE_CROSSEX_URL}>CrossEx</Ext>, Gate’s cross-exchange
            margin account.
          </Step>
          <Step n={5} title="Create your API key" {...step(5)}>
            In <Ext href={GATE_API_KEYS_URL}>API Management</Ext>, create an APIv4 key with CrossEx
            trade permission only; leave Withdrawal off. Paste it into the setup guide of your
            locally-running terminal at <Ext href={LOCAL_APP_URL}>localhost:6688</Ext> — keys stay
            on your machine and never touch this website.
          </Step>
          <Step n={6} title="Execute" {...step(6)}>
            Hit Execute on any card; all four legs land pre-filled.
          </Step>
        </ol>
      </div>
    </aside>
  );
}
