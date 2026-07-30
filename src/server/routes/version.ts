import type { FastifyInstance } from 'fastify';
import type { FetchLike } from '../../core/boros/client';
import type { AppDeps } from '../app';
import { TTL } from '../cache';
import { compareVersions, fetchLatestVersion, type RemoteVersion } from '../version';

/**
 * GET /api/version — is a newer release published on GitHub main?
 *
 * Always 200; never throws. The remote read happens lazily (first request),
 * only when the running copy KNOWS its own version and the check isn't
 * disabled — so an unconfigured `updateCheck` dep (every test app, public
 * mode) makes this route provably network-free. Failures are cached as null
 * for the full TTL: silent by design.
 */
export function versionRoutes(deps: AppDeps) {
  const fetchImpl: FetchLike = deps.versionFetch ?? (globalThis.fetch as unknown as FetchLike);
  return async function plugin(app: FastifyInstance): Promise<void> {
    app.get('/version', async (_req, reply) => {
      const current = deps.updateCheck?.current ?? null;
      let remote: RemoteVersion | null = null;
      if (current !== null && !deps.updateCheck?.disabled) {
        remote = (
          await deps.cache.get('version:latest', TTL.version, () => fetchLatestVersion(fetchImpl))
        ).value;
      }
      const updateAvailable =
        remote !== null && current !== null && (compareVersions(remote.version, current) ?? 0) > 0;
      return reply.ok({
        current,
        install: deps.install ?? null,
        latest: remote?.version ?? null,
        updateAvailable,
        // Highlights only when they describe a version the user doesn't have.
        highlights: updateAvailable && remote ? remote.highlights : [],
      });
    });
  };
}
