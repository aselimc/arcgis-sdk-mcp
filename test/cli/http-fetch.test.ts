import { describe, expect, it } from 'vitest';
import {
  FETCH_HEALTH_PATHS,
  FETCH_MCP_PATHS,
  HEALTH_QUERY,
  createFetchApp,
  type FetchAppOptions,
} from '../../src/cli/http-fetch.js';
import { SERVER_NAME, TOOLS } from '../../src/core/names.js';
import { FakeLogger } from '../support/fake-logger.js';
import { makeEchoServer } from './helpers.js';

const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';
const HOST = 'arcgis-sdk-mcp.vercel.app';
const BASE = `https://${HOST}`;

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'fetch-test', version: '0.0.0' },
  },
};

const callSearch = {
  jsonrpc: '2.0',
  id: 7,
  method: 'tools/call',
  params: { name: TOOLS.search, arguments: { query: 'web map' } },
};

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      host: HOST,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const get = (path: string, headers: Record<string, string> = {}): Request =>
  new Request(`${BASE}${path}`, { headers: { host: HOST, ...headers } });

/** The JSON-RPC message of a reply, whether it came as JSON or as one SSE event. */
async function rpc(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  const data = text.startsWith('{')
    ? text
    : (text.split('\n').find((line) => line.startsWith('data:')) ?? '').slice(5);
  return JSON.parse(data) as Record<string, unknown>;
}

function makeApp(overrides: Partial<FetchAppOptions> = {}) {
  let created = 0;
  const logger = new FakeLogger();
  const app = createFetchApp({
    factory: () => {
      created += 1;
      return makeEchoServer();
    },
    logger,
    version: '1.2.3',
    token: TOKEN,
    tokenRequired: 'it runs on Vercel',
    allowedHosts: [HOST, 'localhost'],
    ...overrides,
  });
  return { app, logger, created: () => created };
}

const bearer = { authorization: `Bearer ${TOKEN}` };

describe('createFetchApp: authentication', () => {
  it('serves an MCP request that carries the token', async () => {
    const { app, created } = makeApp();
    const response = await app.fetch(post('/api/mcp', callSearch, bearer));
    expect(response.status).toBe(200);
    expect(await rpc(response)).toMatchObject({
      result: { content: [{ type: 'text', text: 'echo: web map' }] },
    });
    expect(created()).toBe(1);
    await app.close();
  });

  it('answers 401 with a challenge when the token is missing, and creates no server', async () => {
    const { app, created } = makeApp();
    const response = await app.fetch(post('/api/mcp', initialize));
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe(`Bearer realm="${SERVER_NAME}"`);
    expect(((await response.json()) as { error: string }).error).toMatch(/Authorization: Bearer/);
    expect(created()).toBe(0);
  });

  it('answers 401 invalid_token for a wrong token or scheme', async () => {
    const { app, created } = makeApp();
    for (const authorization of [`Bearer ${TOKEN}x`, `Basic ${TOKEN}`, 'Bearer short']) {
      const response = await app.fetch(post('/mcp', initialize, { authorization }));
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toMatch(/error="invalid_token"/);
    }
    expect(created()).toBe(0);
  });

  it('serves without a token check when none is configured or required', async () => {
    const { app } = makeApp({ token: undefined, tokenRequired: undefined });
    const response = await app.fetch(post('/mcp', initialize));
    expect(response.status).toBe(200);
  });

  it('refuses everything with 503 when a token is required and missing (fail closed)', async () => {
    const { app, logger, created } = makeApp({ token: undefined });
    for (const request of [
      post('/api/mcp', initialize),
      post('/api/mcp', initialize, bearer),
      get('/healthz'),
    ]) {
      const response = await app.fetch(request);
      expect(response.status).toBe(503);
      expect(((await response.json()) as { error: string }).error).toMatch(
        /^ARCGIS_DOCS_HTTP_TOKEN is not set and it runs on Vercel/,
      );
    }
    expect(created()).toBe(0);
    expect(logger.entries.some((entry) => entry.msg === 'refusing to serve')).toBe(true);
  });
});

describe('createFetchApp: Host and Origin', () => {
  it('rejects a foreign Host before authentication or routing', async () => {
    const { app, created } = makeApp();
    for (const request of [
      post('/api/mcp', initialize, { ...bearer, host: 'attacker.example' }),
      get('/healthz', { host: 'attacker.example' }),
      get('/nowhere', { host: 'attacker.example' }),
    ]) {
      const response = await app.fetch(request);
      expect(response.status).toBe(403);
      expect(((await response.json()) as { error: string }).error).toMatch(
        /ARCGIS_DOCS_HTTP_ALLOWED_HOSTS/,
      );
    }
    expect(created()).toBe(0);
  });

  it('accepts an allowed Host with a port, and rejects a cross-site Origin', async () => {
    const { app } = makeApp();
    expect((await app.fetch(get('/healthz', { host: 'localhost:3000' }))).status).toBe(200);
    const foreign = await app.fetch(
      post('/api/mcp', initialize, { ...bearer, origin: 'https://attacker.example' }),
    );
    expect(foreign.status).toBe(403);
    const same = await app.fetch(post('/api/mcp', initialize, { ...bearer, origin: BASE }));
    expect(same.status).toBe(200);
  });

  it('checks neither header when no allow-list is given', async () => {
    const { app } = makeApp({ allowedHosts: undefined });
    const response = await app.fetch(get('/healthz', { host: 'anything.example' }));
    expect(response.status).toBe(200);
  });
});

describe('createFetchApp: routing', () => {
  it('serves the MCP endpoint at /mcp and /api/mcp', async () => {
    const { app } = makeApp();
    expect(FETCH_MCP_PATHS).toEqual(['/mcp', '/api/mcp']);
    for (const path of FETCH_MCP_PATHS) {
      const response = await app.fetch(post(path, initialize, bearer));
      expect(response.status).toBe(200);
      expect(await rpc(response)).toMatchObject({ result: { serverInfo: { name: 'echo' } } });
    }
  });

  it('answers the health check without a token on its paths and on the rewrite flag', async () => {
    const { app, created } = makeApp();
    for (const path of [...FETCH_HEALTH_PATHS, `/api/mcp?${HEALTH_QUERY}=1`]) {
      const response = await app.fetch(get(path));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        status: 'ok',
        server: SERVER_NAME,
        version: '1.2.3',
      });
    }
    const head = new Request(`${BASE}/healthz`, { method: 'HEAD', headers: { host: HOST } });
    expect((await app.fetch(head)).status).toBe(200);
    // A request without a Host header names no deployment.
    expect((await app.fetch(new Request(`${BASE}/healthz`))).status).toBe(403);
    expect(created()).toBe(0);
  });

  it('allows only GET and HEAD on the health check', async () => {
    const { app } = makeApp();
    const response = await app.fetch(post('/healthz', {}));
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });

  it('answers 404 elsewhere, naming the endpoint', async () => {
    const { app } = makeApp();
    const response = await app.fetch(get('/api/other'));
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toContain('/mcp');
  });

  it('answers 400 for a request whose URL does not parse', async () => {
    const { app } = makeApp({ allowedHosts: undefined });
    // A platform hands over a real Request; a hand-built object stands in for a broken one.
    const broken = { url: 'not a url', method: 'GET', headers: new Headers() } as Request;
    expect((await app.fetch(broken)).status).toBe(400);
  });

  it('marks every answer no-store, the MCP ones included', async () => {
    const { app } = makeApp();
    for (const request of [
      post('/api/mcp', initialize, bearer),
      post('/api/mcp', initialize),
      get('/healthz'),
      get('/x'),
    ]) {
      const response = await app.fetch(request);
      expect(response.headers.get('cache-control')).toMatch(/^no-store(, no-transform)?$/);
      expect(response.headers.get('x-robots-tag')).toBe('noindex');
    }
  });

  it('answers 500 and keeps serving when the handler throws', async () => {
    const { app, logger } = makeApp({
      factory: () => {
        throw new Error('boom');
      },
    });
    const failed = await app.fetch(post('/api/mcp', initialize, bearer));
    expect(failed.status).toBeGreaterThanOrEqual(500);
    const throwing = { url: `${BASE}/healthz`, method: 'GET' } as Request;
    const crashed = await app.fetch(throwing);
    expect(crashed.status).toBe(500);
    expect(await crashed.json()).toEqual({ error: 'Internal error' });
    expect(logger.entries.some((entry) => entry.msg === 'http handler failed')).toBe(true);
    expect((await app.fetch(get('/healthz'))).status).toBe(200);
  });
});
