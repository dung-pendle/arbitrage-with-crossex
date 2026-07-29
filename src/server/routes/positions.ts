import type { FastifyInstance } from 'fastify';
import { computeExposure } from '../../core/positions';
import type { AppDeps } from '../app';
import { TTL } from '../cache';

export function positionsRoutes(deps: AppDeps) {
  return async function plugin(app: FastifyInstance): Promise<void> {
    app.get('/positions', async (req, reply) => {
      const fresh = (req.query as { fresh?: string }).fresh === '1';
      const { value, stale } = await deps.cache.get(
        'positions',
        TTL.live,
        async () => (await deps.getClients().crossEx.listCrossexPositions()).body,
        { fresh },
      );
      return reply.ok({ positions: value, exposure: computeExposure(value) }, { stale });
    });
  };
}
