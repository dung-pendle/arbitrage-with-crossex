/**
 * Fee estimation from /crossex/fee rows. Rates come per venue (future maker/taker)
 * with optional exact-symbol overrides; which side(s) of the maker/taker range apply
 * depends on order type + tif.
 */
import type { FeeEstimate } from '../actions';
import { parseSymbol } from '../numbers';

/** Structural mirror of the SDK's fee models (`InlineResponse200` / `CrossexSpecialFee`)
 * so both SDK instances and plain recorded JSON typecheck. All rates are decimal strings. */
export interface SpecialFee {
  symbol: string;
  makerFeeRate: string;
  takerFeeRate: string;
}

export interface VenueFeeRow {
  exchangeType?: string;
  futureMakerFee?: string;
  futureTakerFee?: string;
  spotMakerFee?: string;
  spotTakerFee?: string;
  specialFeeList?: SpecialFee[];
}

interface FeeRates {
  makerRate: number;
  takerRate: number;
  specialOverride: boolean;
  quote: string;
}

/**
 * Venue-level futures rates when no symbol is known (an unlisted or unconfirmed
 * CrossEx listing still trades that venue's schedule). No special-fee override —
 * those are keyed by exact symbol.
 */
export function resolveVenueFeeRates(
  feeRows: VenueFeeRow[],
  exchange: string,
): Pick<FeeRates, 'makerRate' | 'takerRate'> | null {
  const row = feeRows.find((r) => (r.exchangeType ?? '').toUpperCase() === exchange.toUpperCase());
  if (!row) return null;
  const makerRate = Number(row.futureMakerFee);
  const takerRate = Number(row.futureTakerFee);
  if (!Number.isFinite(makerRate) || !Number.isFinite(takerRate)) return null;
  return { makerRate, takerRate };
}

/**
 * Rates for one symbol: venue row matched on parseSymbol().exchange, future* rates,
 * then an exact-symbol specialFeeList override wins. Null when the venue row is
 * missing (callers render "unknown" — never throw).
 */
export function resolveFeeRates(feeRows: VenueFeeRow[], symbol: string): FeeRates | null {
  const sym = symbol.toUpperCase();
  const { exchange, quote } = parseSymbol(sym);
  const row = feeRows.find((r) => (r.exchangeType ?? '').toUpperCase() === exchange);
  if (!row) return null;
  let makerRate = Number(row.futureMakerFee);
  let takerRate = Number(row.futureTakerFee);
  let specialOverride = false;
  const special = (row.specialFeeList ?? []).find((s) => s.symbol.toUpperCase() === sym);
  if (special) {
    makerRate = Number(special.makerFeeRate);
    takerRate = Number(special.takerFeeRate);
    specialOverride = true;
  }
  if (!Number.isFinite(makerRate) || !Number.isFinite(takerRate)) return null;
  return { makerRate, takerRate, specialOverride, quote };
}

/**
 * Fee amounts on notional = qty × price. MARKET (and LIMIT IOC/FOK — taker-or-cancel)
 * pay taker only; POC can only rest, so maker only; GTC LIMIT may do either, so both
 * bounds are estimated (a range).
 */
export function estimateFees(
  rates: FeeRates,
  args: { type: 'MARKET' | 'LIMIT'; tif: string; qty: string; price: number },
): FeeEstimate {
  const notional = Number(args.qty) * args.price;
  const est: FeeEstimate['est'] = {};
  if (args.type === 'MARKET' || args.tif === 'IOC' || args.tif === 'FOK') {
    est.taker = notional * rates.takerRate;
  } else if (args.tif === 'POC') {
    est.maker = notional * rates.makerRate;
  } else {
    est.taker = notional * rates.takerRate;
    est.maker = notional * rates.makerRate;
  }
  return {
    makerRate: rates.makerRate,
    takerRate: rates.takerRate,
    specialOverride: rates.specialOverride,
    quote: rates.quote,
    est,
  };
}
