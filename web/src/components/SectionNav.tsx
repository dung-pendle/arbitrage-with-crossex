/**
 * Slim sticky nav for the left-pane section column. Clicking an item expands
 * the target section (collapsed sections open before scrolling) and
 * smooth-scrolls to its anchor. IntersectionObserver highlights the topmost
 * visible section; environments without IO just keep the first item active.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSections } from './CollapsibleSection';

interface NavSection {
  id: string;
  label: string;
  /** Live count chip etc. — rendered after the label. */
  badge?: ReactNode;
}

export function SectionNav({ sections }: { sections: NavSection[] }) {
  const sectionsApi = useSections();
  const [activeId, setActiveId] = useState(sections[0]?.id ?? '');

  // Section order for "topmost visible wins" — kept in a ref so the observer
  // effect only re-runs when the id list itself changes (badges re-render often).
  const orderRef = useRef(sections.map((s) => s.id));
  orderRef.current = sections.map((s) => s.id);
  const idsKey = orderRef.current.join('|');

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const visible = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target.id, e.isIntersecting);
        const topmost = orderRef.current.find((id) => visible.get(id));
        if (topmost) setActiveId(topmost);
      },
      // Ignore the strip hidden under the sticky header when deciding "in view".
      { rootMargin: '-64px 0px 0px 0px' },
    );
    for (const id of idsKey.split('|')) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [idsKey]);

  const go = (id: string) => {
    sectionsApi.setOpen(id, true); // expand first so the anchor has real height
    document.getElementById(id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  return (
    <nav
      aria-label="Sections"
      className="sticky top-16 flex w-36 shrink-0 flex-col gap-1 self-start"
    >
      {sections.map((s) => {
        const active = s.id === activeId;
        return (
          <button
            key={s.id}
            type="button"
            aria-current={active ? 'true' : undefined}
            data-active={active}
            onClick={() => go(s.id)}
            className={`flex items-center gap-1.5 rounded-md border-l-2 px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
              active
                ? 'border-cyan-400 bg-ink-900 text-ink-100'
                : 'border-transparent text-ink-400 hover:bg-ink-900 hover:text-ink-200'
            }`}
          >
            <span className="min-w-0 flex-1 truncate">{s.label}</span>
            {s.badge}
          </button>
        );
      })}
    </nav>
  );
}
