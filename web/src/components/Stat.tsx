import type { ReactNode } from 'react';
import { microLabelClass } from './Th';

/** Micro-labeled stat for a card's hero strip. `hero` marks the headline
 * number; `sm` steps both scales down one notch (the denser opportunity
 * cards). */
export function Stat({
  label,
  hero,
  sm,
  children,
}: {
  label: string;
  hero?: boolean;
  sm?: boolean;
  children: ReactNode;
}) {
  const valueClass = hero
    ? sm
      ? 'text-2xl font-semibold'
      : 'text-3xl font-semibold'
    : sm
      ? 'text-lg'
      : 'text-xl';
  return (
    <div>
      <div className={microLabelClass}>{label}</div>
      <div className={`mt-0.5 ${valueClass}`}>{children}</div>
    </div>
  );
}
