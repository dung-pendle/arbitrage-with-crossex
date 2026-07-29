import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Shared pieces of the two setup rails (OnboardingGuide, LandingOnboardingGuide).
 * A separate module so the landing bundle can use them without importing the
 * terminal guide's CredentialsForm dependency. */

export const GATE_SIGNUP_URL = 'https://www.gate.com/signup';
export const GATE_CROSSEX_URL = 'https://www.gate.com/crossex';
export const GATE_API_KEYS_URL = 'https://www.gate.com/myaccount/api_key_manage';

export function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-cyan-300 underline decoration-cyan-500/40 underline-offset-2 hover:text-cyan-200"
    >
      {children}
    </a>
  );
}

export function Step({
  n,
  title,
  active = false,
  children,
}: {
  n: number;
  title: string;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className={`num flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ${
          active
            ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-300'
            : 'border-ink-500 bg-transparent text-ink-300'
        }`}
      >
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-[13px] font-semibold text-ink-100">{title}</h3>
        <div className="mt-1 text-xs leading-relaxed text-ink-300">{children}</div>
      </div>
    </li>
  );
}

/** Scroll-to + flash the guide's actionable block when the prefill nonce bumps.
 * The input focus is optional-chained, so a target without one (the landing
 * install command) just scrolls and flashes. */
export function useNudge(nonce: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (!nonce) return;
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    ref.current?.querySelector('input')?.focus({ preventScroll: true });
    setFlash(true);
    // Outlive the 1.8s flashPulse so the ring never cuts off mid-animation.
    const t = setTimeout(() => setFlash(false), 1900);
    return () => clearTimeout(t);
  }, [nonce]);

  return { ref, flash };
}
