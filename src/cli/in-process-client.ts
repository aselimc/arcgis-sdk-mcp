/**
 * A minimal MCP client for talking to a server instance inside the same process. The `call`
 * command and the documentation generator use it, so both exercise the server exactly as a
 * host does (schema validation, error rendering) without a client library at run time.
 */
import { InMemoryTransport, type JSONRPCMessage } from '@modelcontextprotocol/server';
import { PACKAGE_NAME } from '../core/names.js';

/** The part of `McpServer` / `Server` this client needs. */
export interface ConnectableServer {
  connect(transport: InMemoryTransport): Promise<void>;
  close(): Promise<void>;
}

/** A JSON-RPC error answered by the server (unknown method, invalid arguments). */
export class RpcError extends Error {
  override readonly name = 'RpcError';

  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

/** Sends one request and resolves with its `result`; rejects with {@link RpcError}. */
export type RpcRequest = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

/**
 * Protocol revision of the opening handshake. Every server release understands the 2025
 * `initialize` exchange, which is all a one-shot in-process caller needs.
 */
const HANDSHAKE_PROTOCOL_VERSION = '2025-06-18';

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

/**
 * Connects to `server` over a linked in-memory transport, performs the handshake, runs
 * `use` and closes the connection, whatever the outcome.
 *
 * @param clientVersion reported in `clientInfo`.
 */
export async function withInProcessClient<T>(
  server: ConnectableServer,
  clientVersion: string,
  use: (request: RpcRequest) => Promise<T>,
): Promise<T> {
  const [client, serverSide] = InMemoryTransport.createLinkedPair();
  const pending = new Map<number, Pending>();
  let nextId = 1;

  const failAll = (error: Error): void => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };
  client.onmessage = (message: JSONRPCMessage) => {
    if (!('id' in message) || typeof message.id !== 'number') return;
    if ('method' in message) {
      // This client offers no capabilities, so a server-to-client request cannot be served.
      void client.send({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: 'Method not found' },
      });
      return;
    }
    const waiter = pending.get(message.id);
    if (waiter === undefined) return;
    pending.delete(message.id);
    if ('error' in message) waiter.reject(new RpcError(message.error.code, message.error.message));
    else waiter.resolve(message.result);
  };
  client.onclose = () => {
    failAll(new Error('The server closed the connection'));
  };

  const request: RpcRequest = (method, params) =>
    new Promise<unknown>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      client
        .send({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })
        .catch((error: unknown) => {
          pending.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    });

  await server.connect(serverSide);
  await client.start();
  try {
    await request('initialize', {
      protocolVersion: HANDSHAKE_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: `${PACKAGE_NAME}-cli`, version: clientVersion },
    });
    await client.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return await use(request);
  } finally {
    client.onclose = undefined;
    await server.close();
    await client.close();
  }
}
