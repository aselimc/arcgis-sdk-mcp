/**
 * stdio serving: the default mode, started by an MCP host as a child process. stdout carries
 * JSON-RPC and nothing else; every diagnostic goes to the logger (stderr).
 */
import type { McpServerFactory } from '@modelcontextprotocol/server';
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import type { Logger } from '../core/ports.js';

/** The SDK entry point, replaceable in tests. */
export type ServeStdio = typeof serveStdio;

/**
 * Serves MCP on the process's stdin and stdout.
 *
 * The SDK entry picks the protocol era from the client's opening message and pins one server
 * instance from `factory` for the connection, so the same factory serves hosts that open
 * with the 2025 `initialize` handshake and hosts that speak the per-request revision. When
 * the host closes stdin the transport closes and the process ends once background index
 * builds have settled.
 *
 * @returns the handle; `close()` ends the connection (used on SIGINT and SIGTERM).
 */
export function startStdio(
  factory: McpServerFactory,
  logger: Logger,
  serve: ServeStdio = serveStdio,
): StdioServerHandle {
  return serve(factory, {
    onerror: (error) => {
      logger.error('stdio transport error', { error });
    },
  });
}
