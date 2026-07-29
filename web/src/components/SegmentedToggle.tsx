import type { ReactNode } from 'react';

interface Props<T extends string> {
  value: T;
  options: { value: T; label: ReactNode; sub?: ReactNode }[];
  onChange: (next: T) => void;
  ariaLabel?: string;
  /** Extra classes on the track — e.g. `seg-cyan` for the cyan-active variant. */
  className?: string;
}

/** House segmented control (copied from boros-tools _shared-frontend). */
export function SegmentedToggle<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: Props<T>) {
  return (
    <div className={className ? `seg ${className}` : 'seg'} role="radiogroup" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          data-active={value === opt.value}
          className="seg-btn"
          onClick={() => onChange(opt.value)}
        >
          <span>{opt.label}</span>
          {opt.sub && <span className="ml-1 text-[10px] text-ink-400">{opt.sub}</span>}
        </button>
      ))}
    </div>
  );
}
