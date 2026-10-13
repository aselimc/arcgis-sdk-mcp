/**
 * Resource `arcgis-docs://status`: what this server process may reach and how its sources
 * are doing. A human concern, so it is a resource (and the `doctor` command) rather than a
 * tool (design decision 26).
 */
import type { McpServer } from '@modelcontextprotocol/server';
import { RESOURCE_SCHEME, SERVER_NAME } from '../../core/names.js';
import { LIVE_RESOURCE_CACHE } from '../annotations.js';
import type { McpContainer } from '../container.js';

/** URI of the status resource. */
export const STATUS_URI = `${RESOURCE_SCHEME}://status`;

/**
 * Collects the status report. Reads in-memory state and the size of the cache directory;
 * it issues no upstream request.
 */
export async function collectStatus({
  ctx,
  services,
}: McpContainer): Promise<Record<string, unknown>> {
  const [cache, sdks] = await Promise.all([ctx.cache.info(), ctx.workspace()]);
  return {
    server: { name: SERVER_NAME, version: ctx.config.version, mode: ctx.config.mode },
    asOf: ctx.clock.iso(),
    policy: ctx.policy.summary(),
    cache: { ...cache, maxMb: ctx.config.cacheMaxMb },
    workspace: { projectDir: ctx.config.projectDir, sdks },
    github: ctx.github.quota(),
    hosts: ctx.http.hostStates(),
    sources: services.index.health(),
  };
}

/** Registers the status resource. */
export function registerStatusResource(server: McpServer, container: McpContainer): void {
  server.registerResource(
    'status',
    STATUS_URI,
    {
      title: 'ArcGIS docs server status',
      description:
        'Effective source policy, cache directory and size, Esri SDKs detected in the project, circuit-breaker state per host, and index state and last error per documentation source.',
      mimeType: 'application/json',
      cacheHint: LIVE_RESOURCE_CACHE,
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(await collectStatus(container), null, 2),
        },
      ],
    }),
  );
}
