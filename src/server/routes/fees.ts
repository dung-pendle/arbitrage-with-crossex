import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app';
import { TTL } from '../cache';

export function feesRoutes(deps: AppDeps) {
  return async function plugin(app: FastifyInstance): Promise<void> {
    app.get('/fees', async (req, reply) => {
      const fresh = (req.query as { fresh?: string }).fresh === '1';
      const { value, stale } = await deps.cache.get(
        'fees',
        TTL.static,
        async () => (await deps.getClients().crossEx.getCrossexFee()).body,
        { fresh },
      );
      return reply.ok(value, { stale });
    });
  };
}
