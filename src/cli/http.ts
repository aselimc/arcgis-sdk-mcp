/**
 * HTTP serving (`--http`): stateless MCP at `/mcp` and a health check at `/healthz` on
 * `node:http`. By default it is meant for one machine: it binds loopback and validates `Host`
 * and `Origin`, which is what stops a web page in the user's browser from reaching the server
 * through DNS rebinding. With `ARCGIS_DOCS_HTTP_TOKEN` set, every `/mcp` request must carry
 * that bearer token; bound beyond loopback or on a hosting platform the server refuses to
 * start without one (`http-auth.ts`). There are no sessions or subscriptions.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  hostHeaderValidation,
  localhostHostValidation,
  localhostOriginValidation,
  originValidation,
  toNodeHandler,
  type NodeIncomingMessageLike,
} from '@modelcontextprotocol/node';
import type { McpServerFactory } from '@modelcontextprotocol/server';
import { SERVER_NAME } from '../core/names.js';
import type { Logger } from '../core/ports.js';
import { isLoopbackHost } from './args.js';
import {
  allowedHostnames,
  bearerChallenge,
  bracketed,
  checkBearer,
  missingTokenMessage,
  tokenRequirement,
} from './http-auth.js';
import { createStatelessHandler } from './http-fetch.js';

/** Path of the MCP endpoint. */
export const MCP_PATH = '/mcp';

/** Path of the health check. */
export const HEALTH_PATH = '/healthz';

/** Answers whether a request may proceed; when `false`, it has already been answered. */
type Guard = (req: IncomingMessage, res: ServerResponse) => boolean;

/** What {@link createHttpApp} needs. */
export interface HttpAppOptions {
  /** Creates the MCP server; called once per request, so it must be cheap. */
  factory: McpServerFactory;
  logger: Logger;
  /** This package's version, reported by the health check. */
  version: string;
  /** Bind address; decides which `Host` and `Origin` values are accepted. */
  host: string;
  /** Bearer token every `/mcp` request must carry (`ARCGIS_DOCS_HTTP_TOKEN`); none when unset. */
  token?: string | undefined;
  /** Host names accepted in `Host` and `Origin` besides the bind address and loopback. */
  allowedHosts?: readonly string[] | undefined;
  /** Hosting platform detected from the environment; it makes a token mandatory. */
  platform?: string | undefined;
}

/** Thrown when the server would be reachable by others without a token; nothing is bound. */
export class MissingTokenError extends Error {
  override readonly name = 'MissingTokenError';
}

/** {@link HttpAppOptions} plus the port to listen on (`0` picks a free one). */
export interface HttpServeOptions extends HttpAppOptions {
  port: number;
}

/** A listening server. */
export interface HttpHandle {
  /** Base URL of the MCP endpoint. */
  url: string;
  port: number;
  close(): Promise<void>;
}

/**
 * The `Host` and `Origin` guards for a bind address: loopback names for a loopback bind; the
 * named host plus loopback for a specific remote address; for a wildcard bind, the extra
 * names when there are any and no check otherwise (no `Host` value can be expected there;
 * the bearer token a remote bind requires keeps rebinding pages out). `extra`
 * (`ARCGIS_DOCS_HTTP_ALLOWED_HOSTS`) is accepted in every case.
 */
export function guardsFor(host: string, extra: readonly string[] = []): Guard[] {
  if (isLoopbackHost(host) && extra.length === 0) {
    return [localhostHostValidation(), localhostOriginValidation()];
  }
  const names = allowedHostnames(host, extra);
  if (names === undefined) return [];
  return [hostHeaderValidation(names), originValidation(names)];
}

/** The guard that requires the bearer token, answering 401 with a challenge otherwise. */
export function bearerGuard(token: string): Guard {
  return (req, res) => {
    const outcome = checkBearer(req.headers.authorization, token);
    if (outcome === 'ok') return true;
    const challenge = bearerChallenge(outcome);
    sendJson(res, challenge.status, challenge.body, challenge.headers);
    return false;
  };
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

/**
 * The path of a request target, or `undefined` when the target names no path.
 *
 * An origin-form target (`/mcp?x=1`, what every client sends) is cut at the query by hand
 * and never resolved against a base URL: `//[` is a valid origin-form target, but as a
 * relative reference it names the host `[` and `new URL` throws on it. An absolute-form
 * target (`http://host/mcp`, sent through a proxy) is parsed without throwing; `*` and an
 * authority-form target have no path.
 */
export function requestPath(target: string | undefined): string | undefined {
  if (target === undefined) return '/';
  if (target.startsWith('/')) return target.split(/[?#]/, 1)[0];
  return URL.parse(target)?.pathname;
}

/**
 * Builds the request listener and its shutdown function without opening a socket.
 *
 * @throws MissingTokenError when the bind address or the platform requires a token and
 *   none is configured.
 *
 * Each request gets one response. The SDK's default response mode answers a 2026-07-28
 * client with a single JSON body as long as the handler sends nothing before its result,
 * which is the case for every tool here; 2025-era clients are served by the SDK's stateless
 * fallback from the same factory, which frames that one message as a `text/event-stream`
 * event. Both are why a client has to accept both media types.
 */
export function createHttpApp(options: HttpAppOptions): {
  listener: (req: IncomingMessage, res: ServerResponse) => void;
  close(): Promise<void>;
} {
  const { logger, token } = options;
  const required = tokenRequirement(options.host, options.platform);
  if (required !== undefined && token === undefined) {
    throw new MissingTokenError(missingTokenMessage(required));
  }
  const handler = createStatelessHandler(options.factory, logger);
  const mcp = toNodeHandler(handler, {
    onerror: (error: Error) => {
      logger.warn('http request error', { error });
    },
  });
  const guards = guardsFor(options.host, options.allowedHosts);
  const auth = token === undefined ? undefined : bearerGuard(token);

  const fail = (res: ServerResponse, error: unknown): void => {
    logger.error('http handler failed', { error });
    if (!res.headersSent) sendJson(res, 500, { error: 'Internal error' });
    else res.end();
  };

  const route = (req: IncomingMessage, res: ServerResponse): void => {
    // The guards run before anything is read from the request line, and for every path:
    // not even a 404 or the health check may confirm the server to a rebinding page.
    for (const guard of guards) {
      if (!guard(req, res)) return;
    }
    const path = requestPath(req.url);
    if (path === undefined) {
      sendJson(res, 400, { error: 'Bad request target' });
      return;
    }
    if (path !== MCP_PATH && path !== HEALTH_PATH) {
      sendJson(res, 404, { error: `Not found. The MCP endpoint is ${MCP_PATH}` });
      return;
    }
    if (path === HEALTH_PATH) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'Method not allowed' }, { allow: 'GET, HEAD' });
        return;
      }
      sendJson(res, 200, { status: 'ok', server: SERVER_NAME, version: options.version });
      return;
    }
    if (auth !== undefined && !auth(req, res)) return;
    // Merged into the head the adapter writes: no proxy may keep a tool result.
    res.setHeader('cache-control', 'no-store');
    // Node declares optional members as `T | undefined`, the SDK's structural request type
    // as `T`; under exactOptionalPropertyTypes that needs stating, the shapes are the same.
    mcp(req as NodeIncomingMessageLike, res).catch((error: unknown) => {
      fail(res, error);
    });
  };

  // A throw inside a 'request' listener is an uncaught exception, which ends the process:
  // whatever a request manages to break, it gets a 500 and the server keeps serving.
  const listener = (req: IncomingMessage, res: ServerResponse): void => {
    try {
      route(req, res);
    } catch (error) {
      fail(res, error);
    }
  };
  return { listener, close: () => handler.close() };
}

/** Starts listening and resolves once the socket is bound. Rejects when the port is taken. */
export async function startHttp(options: HttpServeOptions): Promise<HttpHandle> {
  const app = createHttpApp(options);
  const server: Server = createServer(app.listener);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host.replace(/^\[|\]$/g, ''), () => {
      server.off('error', reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://${bracketed(options.host)}:${port}${MCP_PATH}`,
    port,
    close: async () => {
      await app.close();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
        // Keep-alive connections would otherwise hold the process open.
        server.closeAllConnections();
      });
    },
  };
}
