/**
 * The MCP endpoint as a web-standard `fetch(request) => Response` handler, for platforms
 * whose functions take a `Request` (Vercel, and any fetch-native runtime). It applies the
 * same rules as the `node:http` server of `http.ts`, in the same order, around the same
 * stateless SDK handler:
 *
 * 1. fail closed: a deployment that needs a token and has none answers 503 to everything;
 * 2. `Host` and `Origin` against the allowed host names;
 * 3. routing: the MCP endpoint and the health check, 404 otherwise;
 * 4. the bearer token on the MCP endpoint;
 * 5. the SDK's stateless handler.
 *
 * Every answer carries `Cache-Control: no-store`, so no CDN or proxy keeps a tool result.
 */
import {
  createMcpHandler,
  validateHostHeader,
  validateOriginHeader,
  type McpHttpHandler,
  type McpServerFactory,
} from '@modelcontextprotocol/server';
import { SERVER_NAME } from '../core/names.js';
import type { Logger } from '../core/ports.js';
import { bearerChallenge, checkBearer, missingTokenMessage } from './http-auth.js';

/** Paths answered as the MCP endpoint: `/mcp`, and `/api/mcp` where a platform mounts functions under `/api`. */
export const FETCH_MCP_PATHS: readonly string[] = ['/mcp', '/api/mcp'];

/** Paths answered as the health check. */
export const FETCH_HEALTH_PATHS: readonly string[] = ['/healthz', '/api/healthz'];

/**
 * Query parameter that marks a request on an MCP path as the health check. A platform
 * rewrite (`/healthz` to `/api/mcp?healthz=1` in `vercel.json`) may hand the function either
 * the original or the rewritten URL; with the flag both reach the health check.
 */
export const HEALTH_QUERY = 'healthz';

/** Headers on every answer: nothing here may be stored by a shared cache or indexed. */
export const NO_STORE_HEADERS: Readonly<Record<string, string>> = {
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex',
};

/**
 * The stateless SDK handler both transports serve: one server instance per request from the
 * factory, a JSON body for 2026-07-28 clients and one SSE-framed message for 2025-era ones.
 */
export function createStatelessHandler(factory: McpServerFactory, logger: Logger): McpHttpHandler {
  return createMcpHandler(factory, {
    onerror: (error: Error) => {
      logger.warn('http request error', { error });
    },
  });
}

/** What {@link createFetchApp} needs. */
export interface FetchAppOptions {
  /** Creates the MCP server; called once per request, so it must be cheap. */
  factory: McpServerFactory;
  logger: Logger;
  /** This package's version, reported by the health check. */
  version: string;
  /** The bearer token every MCP request must carry; no check when `undefined`. */
  token?: string | undefined;
  /**
   * Why this deployment must have a token (see `tokenRequirement`). Set together with an
   * undefined `token`, every request is refused with 503 instead of being served.
   */
  tokenRequired?: string | undefined;
  /** Host names accepted in `Host` and `Origin`; `undefined` skips both checks. */
  allowedHosts: readonly string[] | undefined;
  /** Default {@link FETCH_MCP_PATHS}. */
  mcpPaths?: readonly string[];
  /** Default {@link FETCH_HEALTH_PATHS}. */
  healthPaths?: readonly string[];
}

/** A web-standard handler and its shutdown function. */
export interface FetchApp {
  fetch: (request: Request) => Promise<Response>;
  close: () => Promise<void>;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...NO_STORE_HEADERS, ...headers },
  });
}

/** The answer of the SDK handler with the no-store headers added. */
function withNoStore(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(NO_STORE_HEADERS)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** 403 for a `Host` or `Origin` this deployment does not answer to, or `undefined`. */
function rejectedByHost(request: Request, allowed: readonly string[]): Response | undefined {
  const host = validateHostHeader(request.headers.get('host'), [...allowed]);
  if (!host.ok) {
    return json(403, {
      error:
        `Forbidden: ${host.message}. A deployment answers only to its own host names; add ` +
        'this one to ARCGIS_DOCS_HTTP_ALLOWED_HOSTS if it is yours',
    });
  }
  const origin = validateOriginHeader(request.headers.get('origin'), [...allowed]);
  if (!origin.ok) return json(403, { error: `Forbidden: ${origin.message}` });
  return undefined;
}

/** Builds the handler. Nothing is fetched or created until the first MCP request. */
export function createFetchApp(options: FetchAppOptions): FetchApp {
  const { logger, token, allowedHosts } = options;
  const mcpPaths = options.mcpPaths ?? FETCH_MCP_PATHS;
  const healthPaths = options.healthPaths ?? FETCH_HEALTH_PATHS;
  const handler = createStatelessHandler(options.factory, logger);
  const misconfigured =
    token === undefined && options.tokenRequired !== undefined
      ? missingTokenMessage(options.tokenRequired)
      : undefined;
  if (misconfigured !== undefined) logger.error('refusing to serve', { reason: misconfigured });

  const route = async (request: Request): Promise<Response> => {
    if (misconfigured !== undefined) return json(503, { error: misconfigured });
    if (allowedHosts !== undefined) {
      const rejected = rejectedByHost(request, allowedHosts);
      if (rejected !== undefined) return rejected;
    }
    const url = URL.parse(request.url);
    if (url === null) return json(400, { error: 'Bad request target' });
    const path = url.pathname;
    const health =
      healthPaths.includes(path) || (mcpPaths.includes(path) && url.searchParams.has(HEALTH_QUERY));
    if (health) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json(405, { error: 'Method not allowed' }, { allow: 'GET, HEAD' });
      }
      return json(200, { status: 'ok', server: SERVER_NAME, version: options.version });
    }
    if (!mcpPaths.includes(path)) {
      return json(404, { error: `Not found. The MCP endpoint is ${mcpPaths[0] ?? '/mcp'}` });
    }
    if (token !== undefined) {
      const outcome = checkBearer(request.headers.get('authorization'), token);
      if (outcome !== 'ok') {
        const challenge = bearerChallenge(outcome);
        return json(challenge.status, challenge.body, challenge.headers);
      }
    }
    return withNoStore(await handler.fetch(request));
  };

  return {
    fetch: async (request) => {
      try {
        return await route(request);
      } catch (error) {
        logger.error('http handler failed', { error });
        return json(500, { error: 'Internal error' });
      }
    },
    close: () => handler.close(),
  };
}
