import type { FastifyInstance } from 'fastify';
import { CoreError } from '../../core/errors';
import { getLeverageMax, setLeverage } from '../../core/orders';
import type { AppDeps } from '../app';
import { TTL } from '../cache';

/** Max settable leverage for one symbol, from the cached risk-limit tiers. */
export async function leverageMaxFor(deps: AppDeps, symbol: string, fresh: boolean): Promise<number> {
  const { value } = await deps.cache.get(
    `risk:${symbol}`,
    TTL.static,
    async () => (await getLeverageMax(deps.getClients().crossEx, [symbol])).get(symbol) ?? 0,
    { fresh },
  );
  return value;
}

export function leverageRoutes(deps: AppDeps) {
  return async function plugin(app: FastifyInstance): Promise<void> {
    app.get('/leverage/:symbol', async (req, reply) => {
      const symbol = (req.params as { symbol: string }).symbol.toUpperCase();
      const fresh = (req.query as { fresh?: string }).fresh === '1';
      const { body } = await deps.getClients().crossEx.getCrossexPositionsLeverage({ symbols: symbol });
      const leverageMax = await leverageMaxFor(deps, symbol, fresh);
      return reply.ok({ symbol, leverage: Number(body?.[symbol] ?? 0), leverageMax });
    });

    app.put('/leverage/:symbol', async (req, reply) => {
      const symbol = (req.params as { symbol: string }).symbol.toUpperCase();
      const leverage = (req.body as { leverage?: unknown } | null)?.leverage;
      if (typeof leverage !== 'number' || !Number.isFinite(leverage)) {
        throw new CoreError('body must be { leverage: number }', 'validation');
      }
      const leverageMax = await leverageMaxFor(deps, symbol, false);
      if (leverage < 1 || (leverageMax > 0 && leverage > leverageMax)) {
        throw new CoreError(
          `leverage ${leverage}x must be between 1 and ${leverageMax}x for ${symbol}`,
          'leverage',
        );
      }
      await setLeverage(deps.getClients().crossEx, symbol, leverage);
      deps.cache.bust('positions');
      return reply.ok({ symbol, leverage });
    });
  };
}
