import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app';

/** Liveness probe for the installer/LaunchAgent: no auth, works unconfigured. */
export function healthRoutes(_deps: AppDeps) {
  return async function plugin(app: FastifyInstance): Promise<void> {
    app.get('/health', async (_req, reply) => reply.ok({ status: 'ok' }));
  };
}
