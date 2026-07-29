/**
 * Fixed-point decimal arithmetic for engine quantities/prices: BigInt scaled to 12
 * decimal places. Every quantity in the engine is a decimal STRING at rest
 * (DB, venue API) and an Fx (bigint) during arithmetic — floats never touch
 * money math, so folds and invariant checks are exact (no QTY_EPS anywhere).
 */

export type Fx = bigint;

export const FX_DECIMALS = 12;
const SCALE = 10n ** BigInt(FX_DECIMALS);

export const FX_ZERO: Fx = 0n;

/** Parse a decimal string ("0.152", "-3", "1e-3" NOT supported) to fixed-point. */
export function fx(s: string | null | undefined): Fx {
  if (s === null || s === undefined || s === '') return 0n;
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s.trim());
  if (!m) throw new Error(`fx: not a plain decimal string: "${s}"`);
  const [, sign, intPart, fracPart = ''] = m;
  if (fracPart.length > FX_DECIMALS) {
    // More precision than the engine models — refuse rather than silently round.
    throw new Error(`fx: more than ${FX_DECIMALS} decimals: "${s}"`);
  }
  const frac = fracPart.padEnd(FX_DECIMALS, '0');
  const abs = BigInt(intPart) * SCALE + BigInt(frac);
  return sign === '-' ? -abs : abs;
}

/** Format fixed-point back to a canonical decimal string (no trailing zeros). */
export function fxStr(x: Fx): string {
  const sign = x < 0n ? '-' : '';
  const abs = x < 0n ? -x : x;
  const int = abs / SCALE;
  const frac = (abs % SCALE).toString().padStart(FX_DECIMALS, '0').replace(/0+$/, '');
  return frac ? `${sign}${int}.${frac}` : `${sign}${int}`;
}

/** Floor x DOWN to a multiple of step (step > 0). The engine's ONLY quantity
 * rounding primitive — quantities are never rounded up (hazard 8). */
export function fxFloorToStep(x: Fx, step: Fx): Fx {
  if (step <= 0n) return x;
  if (x <= 0n) return 0n;
  return (x / step) * step;
}

/** Ceil x UP to a multiple of step. PRICE-ONLY: a SELL protection band must
 * round AWAY from the market (up), or flooring gives the band away by up to a
 * tick. Never used for quantities. */
export function fxCeilToStep(x: Fx, step: Fx): Fx {
  if (step <= 0n) return x;
  if (x <= 0n) return 0n;
  const floored = (x / step) * step;
  return floored === x ? x : floored + step;
}

export function fxMin(a: Fx, b: Fx): Fx {
  return a < b ? a : b;
}

export function fxMax(a: Fx, b: Fx): Fx {
  return a > b ? a : b;
}

/** a*b where b is a price — result scaled back to FX_DECIMALS (used for notional). */
export function fxMul(a: Fx, b: Fx): Fx {
  return (a * b) / SCALE;
}

/** a/b keeping FX scale (both operands FX-scaled). Truncates toward zero. Used
 * for weighted averages (Σ qty·price ÷ Σ qty). Returns 0 when b is 0. */
export function fxDiv(a: Fx, b: Fx): Fx {
  if (b === 0n) return 0n;
  return (a * SCALE) / b;
}
