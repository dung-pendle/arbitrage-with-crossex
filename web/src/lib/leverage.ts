/** A leverage entry is invalid when it isn't a finite number ≥ 1 or exceeds the
 * venue cap. `max` ≤ 0 means "cap unknown" — only the lower bound is enforced. */
export function isLevOutOfRange(n: number, max: number): boolean {
  return !Number.isFinite(n) || n < 1 || (max > 0 && n > max);
}
