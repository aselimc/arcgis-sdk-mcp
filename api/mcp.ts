/**
 * Vercel function: the MCP endpoint of a private hosted instance, at `/api/mcp` (and at
 * `/mcp` through the rewrite in `vercel.json`). See docs/hosting.md.
 *
 * It serves the stateless handler `arcgis-sdk-mcp --http` serves, with a bearer token that
 * is mandatory here: without `ARCGIS_DOCS_HTTP_TOKEN` every request is answered 503. The
 * container (caches, indexes, rate limits) is created on the first request and shared by
 * every later request this instance serves.
 */
import { createContainer } from '../src/app/composition-root.js';
import { createHostedHandler } from '../src/cli/http-hosted.js';
import { createServer } from '../src/mcp/server.js';

const handler = createHostedHandler({
  env: process.env,
  loadApp: () => Promise.resolve({ createContainer, createServer }),
});

// An index build that fails after its tool call has answered must not end the instance;
// the failure goes to the function log.
process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
  process.stderr.write(
    `${JSON.stringify({ t: new Date().toISOString(), level: 'error', msg: 'unhandled rejection', error: message })}\n`,
  );
});

/** Web-standard method handlers; Vercel routes each method of the request to its export. */
export const GET = handler;
export const HEAD = handler;
export const POST = handler;
export const DELETE = handler;
export const OPTIONS = handler;
