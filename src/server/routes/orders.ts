import type { FastifyInstance } from 'fastify';
import { CoreError } from '../../core/errors';
import type { AppDeps } from '../app';
import { TTL } from '../cache';

interface HistoryQuery {
  symbol?: string;
  page?: string;
  limit?: string;
  from?: string;
  to?: string;
  fresh?: string;
}

/** Paging params with defaults; limit capped at Gate's 200. */
export function pageParams(q: { page?: string; limit?: string; from?: string; to?: string }): {
  page: number;
  limit: number;
  from?: number;
  to?: number;
} {
  const page = Math.max(1, Math.floor(Number(q.page)) || 1);
  const limit = Math.min(200, Math.max(1, Math.floor(Number(q.limit)) || 50));
  const from = q.from !== undefined ? Number(q.from) : undefined;
  const to = q.to !== undefined ? Number(q.to) : undefined;
  return { page, limit, from, to };
}

export function ordersRoutes(deps: AppDeps) {
  return async function plugin(app: FastifyInstance): Promise<void> {
    app.get('/orders/open', async (req, reply) => {
      const q = req.query as { symbol?: string; fresh?: string };
      const { value, stale } = await deps.cache.get(
        `openOrders:${q.symbol ?? ''}`,
        TTL.live,
        async () =>
          (await deps.getClients().crossEx.listCrossexOpenOrders(q.symbol ? { symbol: q.symbol } : {}))
            .body,
        { fresh: q.fresh === '1' },
      );
      return reply.ok(value, { stale });
    });

    app.get('/orders/history', async (req, reply) => {
      const q = req.query as HistoryQuery;
      const { page, limit, from, to } = pageParams(q);
      const { body: orders } = await deps
        .getClients()
        .crossEx.listCrossexHistoryOrders({ page, limit, symbol: q.symbol, from, to });
      return reply.ok({ orders, page, limit, hasMore: orders.length === limit });
    });

    app.get('/orders/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const { body } = await deps.getClients().crossEx.getCrossexOrder(id);
      return reply.ok(body);
    });

    app.delete('/orders/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      // Engine-owned orders are OFF LIMITS to the route layer. Two reasons, and
      // the second is the dangerous one:
      //
      //  1. The reconcile loop is the only writer of venue-mutating calls
      //     (MAKER-HEDGE.md). A cancel from here happens outside the loop and
      //     outside the `orders` ledger, so cancel_requested is never set.
      //  2. Because cancel_requested stays 0, the venue reporting CANCELLED is
      //     decoded by decide() as "the user killed the maker on the exchange" =
      //     an explicit STOP, which by design outranks the deadline and
      //     PERMANENTLY relinquishes the remaining acquisition. A user tidying
      //     up the Open Orders table would silently abandon a half-filled
      //     two-leg entry, with no confirmation and no explanation.
      //
      // The deal's own Stop control does this properly, through the loop.
      const owned = deps.engine?.store.findLiveOrderByVenueId(id);
      if (owned) {
        throw new CoreError(
          `order ${id} belongs to deal ${owned.pairId} and is managed by the engine — use that deal's Stop control instead of cancelling it by hand`,
          'validation',
        );
      }
      const { body } = await deps.getClients().crossEx.cancelCrossexOrder(id);
      deps.cache.bust('openOrders');
      return reply.ok(body);
    });
  };
}
