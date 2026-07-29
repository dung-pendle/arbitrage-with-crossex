/**
 * Pre-trade fill estimation: VWAP-walk a real orderbook when one is reachable,
 * else degrade through a labeled fallback chain (venue book → Gate proxy book →
 * reference price + spread haircut → null). `source`/`confidence` on the result
 * tell the UI exactly how much to trust the number.
 */
import type { FillEstimate } from '../actions';
import type { Clients } from '../clients';
import { parseSymbol } from '../numbers';
import { resolveReferencePrice, type Side } from '../orders';
import { fetchVenueBook, type NormalizedBook } from './books';

/**
 * VWAP walk of one side's levels (in book order). Direction-agnostic: callers pass
 * asks (asc) for a BUY and bids (desc) for a SELL. When the book is thinner than
 * `qty`, the remainder is extrapolated at the LAST level's price so avgPrice still
 * covers the full qty (`exhausted` flags the guess). Null on empty/invalid input.
 */
export function walkBook(
  levels: Array<[number, number]>,
  qty: number,
): { avgPrice: number; worstPrice: number; filledQty: number; exhausted: boolean } | null {
  if (!Array.isArray(levels) || !Number.isFinite(qty) || qty <= 0) return null;
  let remaining = qty;
  let cost = 0;
  let filled = 0;
  let worst = 0;
  for (const [price, size] of levels) {
    if (!(price > 0) || !(size > 0)) continue;
    const take = remaining < size ? remaining : size;
    cost += take * price;
    filled += take;
    worst = price;
    remaining -= take; // exact 0 on the final level (take === remaining)
    if (remaining === 0) break;
  }
  if (filled === 0) return null;
  if (remaining > 0) cost += remaining * worst;
  return { avgPrice: cost / qty, worstPrice: worst, filledQty: filled, exhausted: remaining > 0 };
}

/** Percent vs mid, signed against the taker: positive = paying up (BUY above / SELL below mid). */
function signedSlippage(side: Side, avgPrice: number, mid: number): number {
  if (!(mid > 0)) return 0;
  const raw = ((avgPrice - mid) / mid) * 100;
  return side === 'BUY' ? raw : -raw;
}

interface EstimateFillDeps {
  clients: Clients;
  /** Injectable for tests; defaults to the live per-venue fetcher. */
  fetchBook?: typeof fetchVenueBook;
}

interface EstimateFillArgs {
  symbol: string;
  side: Side;
  qty: string;
  refPrice?: number;
}

/**
 * Fallback chain:
 * 1. target venue's public book  → 'venue-orderbook', high (medium when depth ran out)
 * 2. Gate BASE_USDT book as proxy → 'gate-orderbook', medium (low when partial)
 * 3. reference price ± EST_SPREAD_BPS haircut → 'reference+spread', low
 * 4. null.
 * `venue` is always the TARGET venue; `source` says where the numbers came from.
 */
export async function estimateFill(deps: EstimateFillDeps, args: EstimateFillArgs): Promise<FillEstimate | null> {
  const { exchange, base, quote, pair } = parseSymbol(args.symbol.toUpperCase());
  const qty = Number(args.qty);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  const fetchBook = deps.fetchBook ?? fetchVenueBook;

  const fromBook = (book: NormalizedBook | null, source: 'venue-orderbook' | 'gate-orderbook'): FillEstimate | null => {
    if (!book) return null;
    const walk = walkBook(args.side === 'BUY' ? book.asks : book.bids, qty);
    if (!walk) return null;
    const mid =
      book.bids.length && book.asks.length
        ? (book.bids[0][0] + book.asks[0][0]) / 2
        : (args.refPrice ?? walk.avgPrice);
    const [full, partial] = source === 'venue-orderbook' ? (['high', 'medium'] as const) : (['medium', 'low'] as const);
    return {
      qty: args.qty,
      avgPrice: walk.avgPrice,
      worstPrice: walk.worstPrice,
      midPrice: mid,
      slippagePct: signedSlippage(args.side, walk.avgPrice, mid),
      source,
      confidence: walk.exhausted ? partial : full,
      venue: exchange,
      ...(walk.exhausted ? { partialDepth: true } : {}),
    };
  };

  const venueEst = fromBook(await fetchBook(exchange, base, quote), 'venue-orderbook');
  if (venueEst) return venueEst;

  if (exchange !== 'GATE') {
    const gateEst = fromBook(await fetchBook('GATE', base, quote), 'gate-orderbook');
    if (gateEst) return gateEst;
  }

  let ref = args.refPrice;
  if (!(typeof ref === 'number' && ref > 0)) {
    try {
      ref = (await resolveReferencePrice(deps.clients, { pairs: [pair] })).price;
    } catch {
      return null;
    }
  }
  const rawBps = Number(process.env.EST_SPREAD_BPS);
  const bps = Number.isFinite(rawBps) && rawBps > 0 ? rawBps : 10;
  const avgPrice = args.side === 'BUY' ? ref * (1 + bps / 10000) : ref * (1 - bps / 10000);
  return {
    qty: args.qty,
    avgPrice,
    worstPrice: avgPrice,
    midPrice: ref,
    slippagePct: signedSlippage(args.side, avgPrice, ref),
    source: 'reference+spread',
    confidence: 'low',
    venue: exchange,
  };
}
