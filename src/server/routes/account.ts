import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app';
import { TTL } from '../cache';

export function accountRoutes(deps: AppDeps) {
  return async function plugin(app: FastifyInstance): Promise<void> {
    app.get('/account', async (req, reply) => {
      const fresh = (req.query as { fresh?: string }).fresh === '1';
      const { value, stale } = await deps.cache.get(
        'account',
        TTL.live,
        async () => (await deps.getClients().crossEx.getCrossexAccount()).body,
        { fresh },
      );
      return reply.ok(value, { stale });
    });
  };
}
