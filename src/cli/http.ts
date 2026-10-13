/**
 * HTTP serving (`--http`): stateless MCP at `/mcp` and a health check at `/healthz` on
 * `node:http`. Meant for one machine: it binds loopback and validates `Host` and `Origin`,
 * which is what stops a web page in the user's browser from reaching the server through DNS
 * rebinding (risk R13). There is no authentication, sessions, or subscriptions.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  hostHeaderValidation,
  localhostHostValidation,
  localhostOriginValidation,
  originValidation,
  toNodeHandler,
} from '@modelcontextprotocol/node';
import { createMcpHandler, type McpServerFactory } from '@modelcontextprotocol/server';
import { SERVER_NAME } from '../core/names.js';
import type { Logger } from '../core/ports.js';
import { isLoopbackHost } from './args.js';

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

const LOOPBACK_NAMES = ['localhost', '127.0.0.1', '[::1]'];

/** True for an address that binds every interface, where no `Host` value can be expected. */
function isWildcardHost(host: string): boolean {
  return host === '0.0.0.0' || host === '::' || host === '[::]';
}

const bracketed = (host: string): string =>
  host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;

/**
 * The `Host` and `Origin` guards for a bind address: loopback names only for a loopback
 * bind; the named host plus loopback for a specific remote address; none for a wildcard
 * bind, where the caller has opted out of the protection with `--allow-remote`.
 */
export function guardsFor(host: string): Guard[] {
  if (isLoopbackHost(host)) return [localhostHostValidation(), localhostOriginValidation()];
  if (isWildcardHost(host)) return [];
  const names = [bracketed(host), ...LOOPBACK_NAMES];
  return [hostHeaderValidation(names), originValidation(names)];
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

/**
 * Builds the request listener and its shutdown function without opening a socket.
 *
 * The MCP handler answers each request with a single JSON body (`responseMode: 'json'`): the
 * tools are request/response only, so there is nothing to stream. 2025-era clients are served
 * by the SDK's stateless fallback from the same factory.
 */
export function createHttpApp(options: HttpAppOptions): {
  listener: (req: IncomingMessage, res: ServerResponse) => void;
  close(): Promise<void>;
} {
  const { logger } = options;
  const onerror = (error: Error): void => {
    logger.warn('http request error', { error });
  };
  const handler = createMcpHandler(options.factory, { responseMode: 'json', onerror });
  const mcp = toNodeHandler(handler, { onerror });
  const guards = guardsFor(options.host);

  const listener = (req: IncomingMessage, res: ServerResponse): void => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path !== MCP_PATH && path !== HEALTH_PATH) {
      sendJson(res, 404, { error: `Not found. The MCP endpoint is ${MCP_PATH}` });
      return;
    }
    // The health check is guarded too: it must not confirm the server to a rebinding page.
    for (const guard of guards) {
      if (!guard(req, res)) return;
    }
    if (path === HEALTH_PATH) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'Method not allowed' }, { allow: 'GET, HEAD' });
        return;
      }
      sendJson(res, 200, { status: 'ok', server: SERVER_NAME, version: options.version });
      return;
    }
    mcp(req, res).catch((error: unknown) => {
      logger.error('http handler failed', { error });
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal error' });
      else res.end();
    });
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
