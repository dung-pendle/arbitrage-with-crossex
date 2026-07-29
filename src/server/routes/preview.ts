import type { FastifyPluginCallback } from 'fastify';
import type { ActionInput } from '../../core/actions';
import { CoreError } from '../../core/errors';
const MAX_ACTIONS = 20;
import { previewActions } from '../../core/preview';
import type { VenueFeeRow } from '../../core/estimate/fees';
import type { AppDeps } from '../app';
import { TTL } from '../cache';

export function previewRoutes(deps: AppDeps): FastifyPluginCallback {
  return (app, _opts, done) => {
    // Zero side effects: full validation + sizing + fill/fee estimates.
    app.post('/preview', async (req, reply) => {
      const body = req.body as { actions?: ActionInput[] } | undefined;
      const actions = body?.actions;
      if (!Array.isArray(actions) || actions.length === 0) {
        throw new CoreError('body must be { actions: ActionInput[] } with at least one action');
      }
      if (actions.length > MAX_ACTIONS) throw new CoreError(`too many actions (max ${MAX_ACTIONS})`);
      const clients = deps.getClients();
      // Same cache key/TTL as GET /api/fees — one Gate call serves both.
      const feeRows = await deps.cache.get<VenueFeeRow[]>('fees', TTL.static, async () => {
        const { body: rows } = await clients.crossEx.getCrossexFee();
        return rows ?? [];
      });
      const previews = await previewActions({ clients, feeRows: feeRows.value }, actions);
      return reply.ok({ previews });
    });
    done();
  };
}
