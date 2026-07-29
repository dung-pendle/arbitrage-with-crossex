import type { CrossexOrder, CrossexTrade } from 'gate-api';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app';
import { TTL } from '../cache';
import { pageParams } from './orders';

interface TradesQuery {
  symbol?: string;
  page?: string;
  limit?: string;
  from?: string;
  to?: string;
  join?: string;
  fresh?: string;
}

export function tradesRoutes(deps: AppDeps) {
  return async function plugin(app: FastifyInstance): Promise<void> {
    app.get('/trades', async (req, reply) => {
      const q = req.query as TradesQuery;
      const fresh = q.fresh === '1';
      const { page, limit, from, to } = pageParams(q);

      const key = `trades:${q.symbol ?? ''}:${page}:${limit}:${from ?? ''}:${to ?? ''}`;
      const { value: trades, stale } = await deps.cache.get(
        key,
        TTL.trades,
        async () =>
          (await deps.getClients().crossEx.listCrossexHistoryTrades({ page, limit, symbol: q.symbol, from, to }))
            .body,
        { fresh },
      );

      // join=1: the UI renders "LMT IOC · taker" per fill group, so attach the
      // originating order's type/tif from a recent-orders page (best effort).
      let out: Array<CrossexTrade & { orderType?: string; orderTif?: string }> = trades;
      if (q.join === '1') {
        const { value: orders } = await deps.cache.get(
          'historyOrders:p1',
          TTL.historyOrders,
          async () =>
            (await deps.getClients().crossEx.listCrossexHistoryOrders({ page: 1, limit: 100 })).body,
          { fresh },
        );
        const byId = new Map<string, CrossexOrder>(orders.map((o) => [String(o.orderId), o]));
        out = trades.map((t) => {
          const o = byId.get(String(t.orderId));
          return { ...t, orderType: o?.type, orderTif: o?.timeInForce };
        });
      }

      return reply.ok({ trades: out, page, limit, hasMore: trades.length === limit }, { stale });
    });
  };
}
