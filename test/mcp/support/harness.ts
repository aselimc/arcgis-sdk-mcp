/**
 * Test harness of the MCP surface: a container made of the shared fakes and the scripted
 * services, and clients connected to `createServer` in either protocol era.
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler, InMemoryTransport } from '@modelcontextprotocol/server';
import type { Services } from '../../../src/core/ports.js';
import type { McpContainer } from '../../../src/mcp/container.js';
import { createServer } from '../../../src/mcp/server.js';
import { fakeRegistry } from '../../support/fake-registry.js';
import { makeCtx, type MakeCtxOptions, type TestCtx } from '../../support/make-ctx.js';
import { BRIEFS, PRODUCTS } from './catalogue.js';
import { makeFakeServices } from './fake-services.js';

/** A container whose parts are fakes a test can script and inspect. */
export interface Harness extends McpContainer {
  ctx: TestCtx;
  services: Services;
}

/** Builds a container over the test catalogue ({@link PRODUCTS}, {@link BRIEFS}). */
export function makeHarness(options: MakeCtxOptions = {}): Harness {
  const ctx = makeCtx({
    registry: fakeRegistry({ products: PRODUCTS, briefs: BRIEFS }),
    ...options,
  });
  return { ctx, services: makeFakeServices(ctx) };
}

/** A connected client and the function that tears the connection down. */
export interface Connection {
  client: Client;
  close(): Promise<void>;
}

const CLIENT_INFO = { name: 'arcgis-sdk-mcp-tests', version: '0.0.0' };

/** Connects with the 2025 `initialize` handshake over a linked in-memory transport pair. */
export async function connectLegacy(container: McpContainer): Promise<Connection> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createServer(container);
  const client = new Client(CLIENT_INFO);
  await server.server.connect(serverSide);
  await client.connect(clientSide);
  return {
    client,
    close: async () => {
      await client.close();
      await server.server.close();
    },
  };
}

/**
 * Connects in the 2026-07-28 era: the client negotiates with `server/discover` against the
 * HTTP handler, whose `fetch` is called in process (no socket is opened).
 */
export async function connectModern(container: McpContainer): Promise<Connection> {
  const handler = createMcpHandler(() => createServer(container), { responseMode: 'json' });
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
    fetch: (input, init) => handler.fetch(new Request(input, init)),
  });
  const client = new Client(CLIENT_INFO, { versionNegotiation: { mode: 'auto' } });
  await client.connect(transport);
  return {
    client,
    close: async () => {
      await client.close();
      await handler.close();
    },
  };
}

/** The text of the first content block of a tool result. */
export function firstText(result: { content: Array<{ type: string; text?: string }> }): string {
  const block = result.content[0];
  if (block?.type !== 'text' || block.text === undefined) {
    throw new Error('expected the first content block to be text');
  }
  return block.text;
}
