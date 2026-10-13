import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  guardsFor,
  HEALTH_PATH,
  MCP_PATH,
  startHttp,
  type HttpHandle,
} from '../../src/cli/http.js';
import { SERVER_NAME, TOOLS } from '../../src/core/names.js';
import { FakeLogger } from '../support/fake-logger.js';
import { makeEchoServer } from './helpers.js';

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/**
 * A raw request to the loopback server. `node:http` is used instead of `fetch` because the
 * tests must send `Host` and `Origin` values a browser-style client refuses to forge.
 */
function send(
  port: number,
  options: { method?: string; path: string; headers?: Record<string, string>; body?: unknown },
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: options.path,
        method: options.method ?? 'GET',
        headers: {
          ...(payload === undefined
            ? {}
            : {
                'content-type': 'application/json',
                accept: 'application/json, text/event-stream',
                'content-length': Buffer.byteLength(payload),
              }),
          ...options.headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

/** The JSON-RPC message of a reply, whether it came as JSON or as one SSE event. */
function rpc(reply: Reply): { result?: Record<string, unknown>; error?: { message: string } } {
  const data = reply.body.startsWith('{')
    ? reply.body
    : (reply.body.split('\n').find((line) => line.startsWith('data:')) ?? '').slice(5);
  return JSON.parse(data) as ReturnType<typeof rpc>;
}

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'http-test', version: '0.0.0' },
  },
};

describe('startHttp', () => {
  let handle: HttpHandle | undefined;
  const logger = new FakeLogger();
  let created = 0;

  const start = async (host = '127.0.0.1'): Promise<HttpHandle> => {
    created = 0;
    handle = await startHttp({
      factory: () => {
        created += 1;
        return makeEchoServer();
      },
      logger,
      version: '1.2.3',
      host,
      port: 0,
    });
    return handle;
  };

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
  });

  it('listens on an ephemeral loopback port and reports its URL', async () => {
    const { url, port } = await start();
    expect(port).toBeGreaterThan(0);
    expect(url).toBe(`http://127.0.0.1:${port}${MCP_PATH}`);
  });

  it('answers the health check without creating a server instance', async () => {
    const { port } = await start();
    const reply = await send(port, { path: HEALTH_PATH });
    expect(reply.status).toBe(200);
    expect(reply.headers['content-type']).toBe('application/json');
    expect(JSON.parse(reply.body)).toEqual({ status: 'ok', server: SERVER_NAME, version: '1.2.3' });
    expect(created).toBe(0);
  });

  it('allows only GET and HEAD on the health check', async () => {
    const { port } = await start();
    const reply = await send(port, { path: HEALTH_PATH, method: 'POST', body: {} });
    expect(reply.status).toBe(405);
    expect(reply.headers.allow).toBe('GET, HEAD');
  });

  it('answers 404 for any other path', async () => {
    const { port } = await start();
    const reply = await send(port, { path: '/admin' });
    expect(reply.status).toBe(404);
    expect(reply.body).toContain(MCP_PATH);
  });

  it('serves the 2025 handshake statelessly at /mcp', async () => {
    const { port } = await start();
    const reply = await send(port, { path: MCP_PATH, method: 'POST', body: initialize });
    expect(reply.status).toBe(200);
    expect(rpc(reply).result).toMatchObject({ serverInfo: { name: 'echo' } });
    expect(reply.headers['mcp-session-id']).toBeUndefined();
    expect(created).toBe(1);
  });

  it('runs a tool call on a fresh instance per request', async () => {
    const { port } = await start();
    const call = {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: TOOLS.search, arguments: { query: 'web map' } },
    };
    const first = await send(port, { path: MCP_PATH, method: 'POST', body: call });
    const second = await send(port, { path: MCP_PATH, method: 'POST', body: call });
    expect(first.status).toBe(200);
    expect(rpc(first).result).toMatchObject({ content: [{ type: 'text', text: 'echo: web map' }] });
    expect(rpc(second).result).toMatchObject({
      content: [{ type: 'text', text: 'echo: web map' }],
    });
    expect(created).toBe(2);
  });

  it('rejects a foreign Host header on /mcp and on the health check', async () => {
    const { port } = await start();
    for (const path of [MCP_PATH, HEALTH_PATH]) {
      const reply = await send(port, {
        path,
        method: path === MCP_PATH ? 'POST' : 'GET',
        headers: { host: 'attacker.example' },
        ...(path === MCP_PATH ? { body: initialize } : {}),
      });
      expect(reply.status).toBe(403);
    }
    expect(created).toBe(0);
  });

  it('rejects a cross-site Origin and accepts a loopback one', async () => {
    const { port } = await start();
    const foreign = await send(port, {
      path: MCP_PATH,
      method: 'POST',
      headers: { origin: 'https://attacker.example' },
      body: initialize,
    });
    expect(foreign.status).toBe(403);
    expect(created).toBe(0);

    const local = await send(port, {
      path: MCP_PATH,
      method: 'POST',
      headers: { origin: `http://localhost:${port}` },
      body: initialize,
    });
    expect(local.status).toBe(200);
  });

  it('accepts localhost as the Host name', async () => {
    const { port } = await start();
    const reply = await send(port, { path: HEALTH_PATH, headers: { host: `localhost:${port}` } });
    expect(reply.status).toBe(200);
  });

  it('stops accepting connections after close', async () => {
    const { port } = await start();
    await handle?.close();
    handle = undefined;
    await expect(send(port, { path: HEALTH_PATH })).rejects.toThrow(/ECONNREFUSED/);
  });

  it('rejects when the port is already taken', async () => {
    const { port } = await start();
    await expect(
      startHttp({ factory: makeEchoServer, logger, version: '1', host: '127.0.0.1', port }),
    ).rejects.toThrow(/EADDRINUSE/);
  });
});

describe('guardsFor', () => {
  it('validates Host and Origin for loopback and named hosts, and nothing for a wildcard bind', () => {
    expect(guardsFor('127.0.0.1')).toHaveLength(2);
    expect(guardsFor('localhost')).toHaveLength(2);
    expect(guardsFor('docs.internal.example')).toHaveLength(2);
    expect(guardsFor('0.0.0.0')).toEqual([]);
    expect(guardsFor('::')).toEqual([]);
  });
});
