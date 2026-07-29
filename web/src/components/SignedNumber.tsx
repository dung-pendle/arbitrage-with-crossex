import { num, signedClass } from '../lib/fmt';

interface Props {
  value: number | string;
  /** Formats the (signed) numeric value; defaults to num(n, 2). The '+' prefix
   * for positives is added here — formatters keep their own '-' for negatives. */
  format?: (n: number) => string;
  className?: string;
}

/** Mono tabular signed value: green > 0, red < 0, dim at 0 (positives get a '+'). */
export function SignedNumber({ value, format = (n) => num(n), className }: Props) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return <span className={`num text-ink-400 ${className ?? ''}`}>—</span>;
  return (
    <span className={`num ${signedClass(n)} ${className ?? ''}`}>
      {n > 0 ? '+' : ''}
      {format(n)}
    </span>
  );
}
