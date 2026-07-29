/**
 * GET /api/books/:symbol — the venue's live touch (best bid/ask/mid) for a
 * CrossEx symbol, from the PUBLIC per-venue order book. Powers the maker-hedge
 * re-peg decision UI: the user sees fresh prices on both venues before moving
 * the resting order. Short TTL — this is a price display, not a data feed.
 */
import type { FastifyInstance } from 'fastify';
import type { RestEstimate } from '../../core/actions';
import { fetchVenueBook, touchOf } from '../../core/estimate/books';
import { CoreError } from '../../core/errors';
import { parseSymbol } from '../../core/numbers';
import type { AppDeps } from '../app';
import { TTL } from '../cache';

/** The venue touch (same shape the preview's restEstimate uses) + its symbol. */
export interface BookTouch extends RestEstimate {
  symbol: string;
}

export function booksRoutes(deps: AppDeps) {
  return async function plugin(app: FastifyInstance): Promise<void> {
    app.get('/books/:symbol', async (req, reply) => {
      const symbol = (req.params as { symbol: string }).symbol.toUpperCase();
      const fresh = (req.query as { fresh?: string }).fresh === '1';
      const { value, stale } = await deps.cache.get(
        `books:${symbol}`,
        TTL.book,
        async (): Promise<BookTouch> => {
          const { exchange, base, quote } = parseSymbol(symbol);
          const touch = touchOf(await fetchVenueBook(exchange, base, quote));
          if (!touch) throw new CoreError(`no public order book available for ${symbol}`, 'network');
          return { symbol, ...touch };
        },
        { fresh },
      );
      return reply.ok(value, { stale });
    });
  };
}
