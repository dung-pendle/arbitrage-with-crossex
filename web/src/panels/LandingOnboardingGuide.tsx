import { CopyBlock } from '../components/CopyBlock';
import { INSTALL_CMD, LOCAL_APP_URL, REPO_URL } from '../lib/landing';
import { useTradeFlowOptional } from '../trade/TradeFlow';
import { Ext, GATE_API_KEYS_URL, GATE_CROSSEX_URL, GATE_SIGNUP_URL, Step, useNudge } from './onboardingBits';

/** Public-site rail: same shell and Gate steps as OnboardingGuide, but step 1 is
 * installing the terminal and no key ever touches this page — the API-key step
 * sends the visitor to the setup guide of their locally-running copy instead of
 * embedding the form, and the Execute nudge flashes the install command. */
export function LandingOnboardingGuide() {
  const flow = useTradeFlowOptional();
  const nonce = flow?.pairPrefill?.nonce ?? 0;
  const { ref: installRef, flash } = useNudge(nonce);

  return (
    <aside className="sticky top-16 w-[360px] shrink-0 self-start" aria-label="Setup guide">
      <div className="card px-5 py-5">
        <h2 className="text-xl font-bold tracking-tight text-ink-100">How to execute</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-300">
          Every number on the left is live. Five steps and you can take them.
        </p>
        <ol className="mt-5 flex flex-col gap-[18px]">
          <Step n={1} title="Install the terminal" active>
            Runs locally on your Mac — free and <Ext href={REPO_URL}>open source</Ext>. Paste this
            into the Terminal app and press Return:
            <div
              ref={installRef}
              className="relative mt-2 flex flex-col gap-2 rounded-lg border border-ink-700 bg-ink-950 p-3"
            >
              {flash && <div aria-hidden="true" className="flash-ring" />}
              <CopyBlock text={INSTALL_CMD} />
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
          <Step n={2} title="Fund Gate">
            Sign up on <Ext href={GATE_SIGNUP_URL}>gate.com/signup</Ext>, deposit the capital
            you’ll deploy.
          </Step>
          <Step n={3} title="Enable CrossEx">
            Move funds into <Ext href={GATE_CROSSEX_URL}>CrossEx</Ext>, Gate’s cross-exchange
            margin account.
          </Step>
          <Step n={4} title="Create your API key">
            In <Ext href={GATE_API_KEYS_URL}>API Management</Ext>, create an APIv4 key with CrossEx
            trade permission only; leave Withdrawal off. Paste it into the setup guide of your
            locally-running terminal at <Ext href={LOCAL_APP_URL}>localhost:6688</Ext> — keys stay
            on your machine and never touch this website.
          </Step>
          <Step n={5} title="Execute">
            Hit Execute on any card; all four legs land pre-filled.
          </Step>
        </ol>
      </div>
    </aside>
  );
}
