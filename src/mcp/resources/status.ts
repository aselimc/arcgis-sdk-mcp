/**
 * Resource `arcgis-docs://status`: what this server process may reach and how its sources
 * are doing. A human concern, so it is a resource (and the `doctor` command) rather than a
 * tool.
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
 *
 * Over stdio the reader is the user's own MCP host, so the report names the cache and
 * project directories. Over HTTP anyone who reaches the endpoint can read it and there is
 * no authentication: absolute paths, which give away the account name and the directory
 * layout of the machine, are left out, and so is the project, which HTTP mode never scans.
 */
export async function collectStatus({
  ctx,
  services,
}: McpContainer): Promise<Record<string, unknown>> {
  const local = ctx.config.mode === 'stdio';
  const [{ dir, ...size }, sdks] = await Promise.all([ctx.cache.info(), ctx.workspace()]);
  return {
    server: { name: SERVER_NAME, version: ctx.config.version, mode: ctx.config.mode },
    asOf: ctx.clock.iso(),
    policy: ctx.policy.summary(),
    cache: { ...(local ? { dir } : {}), ...size, maxMb: ctx.config.cacheMaxMb },
    ...(local ? { workspace: { projectDir: ctx.config.projectDir, sdks } } : {}),
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
        'Effective source policy, cache size, circuit-breaker state per host, and index state and last error per documentation source; over stdio also the cache directory and the Esri SDKs detected in the project.',
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
