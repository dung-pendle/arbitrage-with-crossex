/**
 * Collapsible section + the shared open/closed store behind it (the /pb letter
 * and the shared-position page's explainers).
 *
 * Open-state overrides persist to localStorage; a section with no stored
 * override falls back to its `defaultOpen`. Content stays MOUNTED while
 * collapsed (hidden via the `hidden` attribute), so anything live inside it
 * keeps working — and an in-page find still hits collapsed text.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { readJson, writeJson } from '../lib/storage';

const SECTIONS_STORAGE_KEY = 'crossex:sections:v1';

type Overrides = Record<string, boolean>;

interface SectionsApi {
  isOpen: (id: string, defaultOpen: boolean) => boolean;
  setOpen: (id: string, open: boolean) => void;
}

const SectionsCtx = createContext<SectionsApi | null>(null);

function load(): Overrides {
  return readJson<Overrides>(SECTIONS_STORAGE_KEY, {}, (parsed) => {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (e): e is [string, boolean] => typeof e[1] === 'boolean',
      ),
    );
  });
}

export function SectionsProvider({ children }: { children: ReactNode }) {
  const [overrides, setOverrides] = useState<Overrides>(load);

  useEffect(() => {
    writeJson(SECTIONS_STORAGE_KEY, overrides);
  }, [overrides]);

  const api = useMemo<SectionsApi>(
    () => ({
      isOpen: (id, defaultOpen) => overrides[id] ?? defaultOpen,
      setOpen: (id, open) =>
        setOverrides((prev) => (prev[id] === open ? prev : { ...prev, [id]: open })),
    }),
    [overrides],
  );

  return <SectionsCtx.Provider value={api}>{children}</SectionsCtx.Provider>;
}

export function useSections(): SectionsApi {
  const ctx = useContext(SectionsCtx);
  if (!ctx) throw new Error('useSections must be used inside <SectionsProvider>');
  return ctx;
}

interface SectionProps {
  id: string;
  title: string;
  defaultOpen: boolean;
  children: ReactNode;
}

export function CollapsibleSection({ id, title, defaultOpen, children }: SectionProps) {
  const sections = useSections();
  const open = sections.isOpen(id, defaultOpen);
  const contentId = `${id}-content`;

  return (
    <section id={id} aria-label={title} className="card scroll-mt-16">
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => sections.setOpen(id, !open)}
          className="flex w-full items-center gap-2 rounded-xl px-4 py-3 text-left text-sm font-semibold text-ink-100 transition-colors hover:bg-ink-800/60"
        >
          <span
            aria-hidden="true"
            className={`text-[10px] text-ink-500 transition-transform ${open ? 'rotate-90' : ''}`}
          >
            ▶
          </span>
          {title}
        </button>
      </h2>
      <div id={contentId} hidden={!open} className="border-t border-ink-800 px-4 pb-4 pt-4">
        {children}
      </div>
    </section>
  );
}
