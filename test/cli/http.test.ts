import { createServer, request } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createHttpApp,
  guardsFor,
  HEALTH_PATH,
  MCP_PATH,
  MissingTokenError,
  requestPath,
  startHttp,
  type HttpHandle,
  type HttpServeOptions,
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

/**
 * Sends one request line exactly as given and resolves with the status code of the answer.
 * `node:http` normalises or refuses some request targets; a socket sends what an attacker can.
 */
function sendRaw(port: number, requestLine: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    let answer = '';
    socket.on('connect', () => {
      socket.write(`${requestLine}\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
    });
    socket.on('data', (chunk: Buffer) => (answer += chunk.toString('latin1')));
    socket.on('error', reject);
    socket.on('close', () => {
      const status = /^HTTP\/1\.1 (\d{3})/.exec(answer)?.[1];
      if (status === undefined) reject(new Error(`no HTTP answer: ${JSON.stringify(answer)}`));
      else resolve(Number(status));
    });
  });
}

/** The JSON-RPC message of a reply, whether it came as JSON or as one SSE event. */
function rpc(reply: Reply): { result?: Record<string, unknown>; error?: { message: string } } {
  const data = reply.body.startsWith('{')
    ? reply.body
    : (reply.body.split('\n').find((line) => line.startsWith('data:')) ?? '').slice(5);
  return JSON.parse(data) as ReturnType<typeof rpc>;
}

const TOKEN = 'node-http-test-token-0123456789abcdef';

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

  it('answers a request target that is not a URL and keeps serving (regression: `GET //[` ended the process)', async () => {
    const { port } = await start();
    // "//[" resolves, as a relative reference, to the unparsable host "[".
    expect(await sendRaw(port, 'GET //[ HTTP/1.1')).toBe(404);
    expect(await sendRaw(port, 'GET //[::1/mcp HTTP/1.1')).toBe(404);
    expect(await sendRaw(port, 'OPTIONS * HTTP/1.1')).toBe(400);
    expect(await sendRaw(port, 'GET http://[/mcp HTTP/1.1')).toBe(400);
    expect((await send(port, { path: HEALTH_PATH })).status).toBe(200);
    expect(created).toBe(0);
  });

  it('routes on the path of the target, with or without a query, in either form', async () => {
    const { port } = await start();
    expect(await sendRaw(port, `GET ${HEALTH_PATH}?probe=1 HTTP/1.1`)).toBe(200);
    expect(await sendRaw(port, `GET http://127.0.0.1:${port}${HEALTH_PATH} HTTP/1.1`)).toBe(200);
    // A second slash is part of the path, not the start of a host name.
    expect(await sendRaw(port, `GET //attacker.example${HEALTH_PATH} HTTP/1.1`)).toBe(404);
  });

  it('serves the 2025 handshake statelessly at /mcp', async () => {
    const { port } = await start();
    const reply = await send(port, { path: MCP_PATH, method: 'POST', body: initialize });
    expect(reply.status).toBe(200);
    expect(rpc(reply).result).toMatchObject({ serverInfo: { name: 'echo' } });
    expect(reply.headers['mcp-session-id']).toBeUndefined();
    expect(created).toBe(1);
  });

  it('answers a 2026-07-28 client with one JSON body per request', async () => {
    const { url } = await start();
    const types: Array<string | null> = [];
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      fetch: async (input, init) => {
        const response = await fetch(input, init);
        if (init?.method === 'POST') types.push(response.headers.get('content-type'));
        return response;
      },
    });
    const client = new Client(
      { name: 'http-test', version: '0.0.0' },
      { versionNegotiation: { mode: 'auto' } },
    );
    await client.connect(transport);
    try {
      expect(client.getProtocolEra()).toBe('modern');
      const result = await client.callTool({ name: TOOLS.search, arguments: { query: 'web map' } });
      expect(result.content).toEqual([{ type: 'text', text: 'echo: web map' }]);
      expect(types.length).toBeGreaterThan(1);
      expect(new Set(types)).toEqual(new Set(['application/json']));
    } finally {
      await client.close();
    }
  });

  it('frames the answer to a 2025-era client as one event of an event stream', async () => {
    const { port } = await start();
    const reply = await send(port, { path: MCP_PATH, method: 'POST', body: initialize });
    expect(reply.headers['content-type']).toBe('text/event-stream');
    expect(reply.body.match(/^event: message$/gm)).toHaveLength(1);
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

  it('validates Host before it says anything about the path', async () => {
    const { port } = await start();
    const reply = await send(port, { path: '/admin', headers: { host: 'attacker.example' } });
    expect(reply.status).toBe(403);
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

describe('createHttpApp', () => {
  const options = {
    factory: makeEchoServer,
    logger: new FakeLogger(),
    version: '1',
    host: '::',
    token: TOKEN,
  };

  it('answers 500 and survives when handling a request throws', async () => {
    const app = createHttpApp(options);
    const server = createServer((req, res) => {
      // Stands in for any failure inside the listener: reading the request target throws.
      Object.defineProperty(req, 'url', {
        get: () => {
          throw new Error('boom');
        },
      });
      app.listener(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const first = await send(port, { path: HEALTH_PATH });
      const second = await send(port, { path: HEALTH_PATH });
      expect([first.status, second.status]).toEqual([500, 500]);
      expect(JSON.parse(first.body)).toEqual({ error: 'Internal error' });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await app.close();
    }
  });

  it('prints nothing while it is built (regression: an SDK warning preceded the listening line)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const app = createHttpApp(options);
    await app.close();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('requestPath', () => {
  it('returns the path of an origin-form or absolute-form target and never throws', () => {
    expect(requestPath(undefined)).toBe('/');
    expect(requestPath('/mcp')).toBe('/mcp');
    expect(requestPath('/mcp?session=1#top')).toBe('/mcp');
    expect(requestPath('//[')).toBe('//[');
    expect(requestPath('http://localhost:3333/healthz?x=1')).toBe('/healthz');
    expect(requestPath('*')).toBeUndefined();
    expect(requestPath('http://[/mcp')).toBeUndefined();
    expect(requestPath('')).toBeUndefined();
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

  it('validates a wildcard bind against the configured host names', () => {
    expect(guardsFor('0.0.0.0', ['docs.example.com'])).toHaveLength(2);
    expect(guardsFor('127.0.0.1', ['docs.example.com'])).toHaveLength(2);
  });
});

describe('startHttp with a bearer token', () => {
  let handle: HttpHandle | undefined;
  let created = 0;

  const start = async (overrides: Partial<HttpServeOptions> = {}): Promise<HttpHandle> => {
    created = 0;
    handle = await startHttp({
      factory: () => {
        created += 1;
        return makeEchoServer();
      },
      logger: new FakeLogger(),
      version: '1.2.3',
      host: '127.0.0.1',
      port: 0,
      token: TOKEN,
      ...overrides,
    });
    return handle;
  };

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
  });

  it('serves /mcp with the right token and marks the answer no-store', async () => {
    const { port } = await start();
    const reply = await send(port, {
      path: MCP_PATH,
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
      body: initialize,
    });
    expect(reply.status).toBe(200);
    expect(rpc(reply).result).toMatchObject({ serverInfo: { name: 'echo' } });
    // The SDK's own value for an event stream wins over the default; neither lets a shared
    // cache answer from a stored copy.
    expect(reply.headers['cache-control']).toMatch(/^no-(store|cache)/);
    expect(created).toBe(1);
  });

  it('answers 401 with a challenge for a missing or wrong token, without creating a server', async () => {
    const { port } = await start();
    const missing = await send(port, { path: MCP_PATH, method: 'POST', body: initialize });
    expect(missing.status).toBe(401);
    expect(missing.headers['www-authenticate']).toBe(`Bearer realm="${SERVER_NAME}"`);
    for (const authorization of [`Bearer ${TOKEN.slice(1)}`, `Basic ${TOKEN}`, TOKEN]) {
      const wrong = await send(port, {
        path: MCP_PATH,
        method: 'POST',
        headers: { authorization },
        body: initialize,
      });
      expect(wrong.status).toBe(401);
      expect(wrong.headers['www-authenticate']).toMatch(/error="invalid_token"/);
    }
    expect(created).toBe(0);
  });

  it('leaves the health check open and still validates Host before the token', async () => {
    const { port } = await start();
    expect((await send(port, { path: HEALTH_PATH })).status).toBe(200);
    const foreign = await send(port, {
      path: MCP_PATH,
      method: 'POST',
      headers: { host: 'attacker.example', authorization: `Bearer ${TOKEN}` },
      body: initialize,
    });
    expect(foreign.status).toBe(403);
  });

  it('accepts a configured extra host name', async () => {
    const { port } = await start({ allowedHosts: ['docs.example.com'] });
    const reply = await send(port, { path: HEALTH_PATH, headers: { host: 'docs.example.com' } });
    expect(reply.status).toBe(200);
    expect((await send(port, { path: HEALTH_PATH })).status).toBe(200);
  });

  it('serves a 2026-07-28 client that sends the token as a header', async () => {
    const { url } = await start();
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
    });
    const client = new Client({ name: 'http-test', version: '0.0.0' });
    await client.connect(transport);
    try {
      const result = await client.callTool({ name: TOOLS.search, arguments: { query: 'token' } });
      expect(result.content).toEqual([{ type: 'text', text: 'echo: token' }]);
    } finally {
      await client.close();
    }
  });
});

describe('startHttp fails closed', () => {
  const base = { factory: makeEchoServer, logger: new FakeLogger(), version: '1', port: 0 };

  it.each(['0.0.0.0', '::', '192.168.1.20'])(
    'refuses to bind %s without a token, before opening a socket',
    async (host) => {
      await expect(startHttp({ ...base, host })).rejects.toThrow(MissingTokenError);
      expect(() => createHttpApp({ ...base, host })).toThrow(
        /ARCGIS_DOCS_HTTP_TOKEN is not set and --host .* is not a loopback address/,
      );
    },
  );

  it('refuses to serve on a hosting platform without a token, even on loopback', () => {
    expect(() => createHttpApp({ ...base, host: '127.0.0.1', platform: 'Fly.io' })).toThrow(
      /it runs on Fly\.io/,
    );
  });

  it('keeps serving loopback without a token, as before', async () => {
    const handle = await startHttp({ ...base, host: '127.0.0.1' });
    try {
      const reply = await send(handle.port, { path: MCP_PATH, method: 'POST', body: initialize });
      expect(reply.status).toBe(200);
    } finally {
      await handle.close();
    }
  });
});
