import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Config } from '../../src/core/config.js';
import { PACKAGE_NAME, SERVER_NAME, TOOLS, TOOL_ORDER } from '../../src/core/names.js';
import {
  HOSTED_CACHE_MAX_MB,
  createHostedHandler,
  hostedCacheDir,
  hostedEnv,
  type HostedApp,
} from '../../src/cli/http-hosted.js';
import { makeContainer, makeEchoServer } from './helpers.js';

const TOKEN = 'hosted-test-token-0123456789abcdef';
const HOST = 'arcgis-sdk-mcp.vercel.app';
const PKG = { version: '4.5.6', repoUrl: 'https://github.com/aselimc/arcgis-sdk-mcp' };

const VERCEL_ENV: NodeJS.ProcessEnv = {
  VERCEL: '1',
  VERCEL_PROJECT_PRODUCTION_URL: HOST,
  VERCEL_URL: 'arcgis-sdk-mcp-abc123-aselimc.vercel.app',
  ARCGIS_DOCS_HTTP_TOKEN: TOKEN,
  ARCGIS_DOCS_LOG_LEVEL: 'silent',
};

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'hosted-test', version: '0.0.0' },
  },
};

function post(body: unknown, headers: Record<string, string> = {}, host = HOST): Request {
  return new Request(`https://${host}/api/mcp`, {
    method: 'POST',
    headers: {
      host,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function rpc(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  const data = text.startsWith('{')
    ? text
    : (text.split('\n').find((line) => line.startsWith('data:')) ?? '').slice(5);
  return JSON.parse(data) as Record<string, unknown>;
}

/** A handler over the CLI test fakes that records what it was configured with. */
function makeHosted(env: NodeJS.ProcessEnv) {
  const configs: Config[] = [];
  let loads = 0;
  let servers = 0;
  const app: HostedApp = {
    createContainer: (config) => {
      configs.push(config);
      return makeContainer();
    },
    createServer: () => {
      servers += 1;
      return makeEchoServer();
    },
  };
  const handler = createHostedHandler({
    env,
    pkg: PKG,
    loadApp: async () => {
      loads += 1;
      return app;
    },
  });
  return { handler, configs, loads: () => loads, servers: () => servers };
}

describe('hostedEnv', () => {
  it('puts the cache in the temporary directory, capped, unless the deployment says otherwise', () => {
    expect(hostedCacheDir()).toBe(join(tmpdir(), PACKAGE_NAME));
    expect(hostedEnv({ A: '1' })).toEqual({
      A: '1',
      ARCGIS_DOCS_CACHE_DIR: hostedCacheDir(),
      ARCGIS_DOCS_CACHE_MAX_MB: String(HOSTED_CACHE_MAX_MB),
    });
    expect(
      hostedEnv({ ARCGIS_DOCS_CACHE_DIR: '/data/cache', ARCGIS_DOCS_CACHE_MAX_MB: '50' }),
    ).toEqual({ ARCGIS_DOCS_CACHE_DIR: '/data/cache', ARCGIS_DOCS_CACHE_MAX_MB: '50' });
    expect(hostedEnv({ ARCGIS_DOCS_CACHE_DIR: ' ' }).ARCGIS_DOCS_CACHE_DIR).toBe(hostedCacheDir());
  });
});

describe('createHostedHandler', () => {
  it('builds one container per instance, in HTTP mode, on the first request', async () => {
    const hosted = makeHosted(VERCEL_ENV);
    expect(hosted.loads()).toBe(0);
    const bearer = { authorization: `Bearer ${TOKEN}` };
    const first = await hosted.handler(post(initialize, bearer));
    const second = await hosted.handler(post(initialize, bearer));
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(await rpc(first)).toMatchObject({ result: { serverInfo: { name: 'echo' } } });
    expect(hosted.loads()).toBe(1);
    expect(hosted.configs).toHaveLength(1);
    // One server instance per request, over the one container.
    expect(hosted.servers()).toBe(2);

    const [config] = hosted.configs;
    expect(config?.mode).toBe('http');
    expect(config?.version).toBe('4.5.6');
    expect(config?.capabilities.has('workspace')).toBe(false);
    expect(config?.capabilities.has('local-packages')).toBe(false);
    expect(config?.cacheDir).toBe(hostedCacheDir());
    expect(config?.cacheMaxMb).toBe(HOSTED_CACHE_MAX_MB);
  });

  it('requires the token', async () => {
    const hosted = makeHosted(VERCEL_ENV);
    const missing = await hosted.handler(post(initialize));
    expect(missing.status).toBe(401);
    expect(missing.headers.get('www-authenticate')).toMatch(/^Bearer realm=/);
    const wrong = await hosted.handler(post(initialize, { authorization: 'Bearer nope' }));
    expect(wrong.status).toBe(401);
    expect(hosted.servers()).toBe(0);
  });

  it('answers only to the deployment host names and the configured ones', async () => {
    const hosted = makeHosted({
      ...VERCEL_ENV,
      ARCGIS_DOCS_HTTP_ALLOWED_HOSTS: 'docs.example.com',
    });
    const bearer = { authorization: `Bearer ${TOKEN}` };
    for (const host of [HOST, 'arcgis-sdk-mcp-abc123-aselimc.vercel.app', 'docs.example.com']) {
      expect((await hosted.handler(post(initialize, bearer, host))).status).toBe(200);
    }
    expect((await hosted.handler(post(initialize, bearer, 'attacker.example'))).status).toBe(403);
  });

  it('fails closed without a token, on Vercel and on an unknown platform alike', async () => {
    for (const env of [
      { ...VERCEL_ENV, ARCGIS_DOCS_HTTP_TOKEN: undefined },
      { ARCGIS_DOCS_LOG_LEVEL: 'silent' },
    ]) {
      const hosted = makeHosted(env);
      const request = new Request('http://localhost/healthz', { headers: { host: 'localhost' } });
      const response = await hosted.handler(request);
      expect(response.status).toBe(503);
      expect(((await response.json()) as { error: string }).error).toMatch(
        /ARCGIS_DOCS_HTTP_TOKEN is not set and it runs (on Vercel|as a hosted function)/,
      );
    }
  });

  it('answers 500 naming the variable when the configuration is invalid, and logs it', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const hosted = makeHosted({ ...VERCEL_ENV, ARCGIS_DOCS_HTTP_TOKEN: 'short' });
    const response = await hosted.handler(post(initialize));
    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const { error } = (await response.json()) as { error: string };
    expect(error).toMatch(/^Configuration error: ARCGIS_DOCS_HTTP_TOKEN: expected at least 32/);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('hosted handler failed to start'));
    expect(hosted.loads()).toBe(0);
  });

  it('answers 500 without detail when the application fails to load', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const handler = createHostedHandler({
      env: VERCEL_ENV,
      pkg: PKG,
      loadApp: async () => {
        throw new Error('Cannot find module /var/task/src/secret/path.js');
      },
    });
    const response = await handler(post(initialize));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal error' });
  });

  it('reads the package manifest when no package info is given', async () => {
    const handler = createHostedHandler({
      env: VERCEL_ENV,
      loadApp: async () => ({
        createContainer: () => makeContainer(),
        createServer: makeEchoServer,
      }),
    });
    const response = await handler(
      new Request(`https://${HOST}/healthz`, { headers: { host: HOST } }),
    );
    const body = (await response.json()) as { server: string; version: string };
    expect(body.server).toBe(SERVER_NAME);
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('api/mcp.ts (the Vercel function entry)', () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'arcgis-sdk-mcp-api-'));
  afterAll(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('exports a web-standard handler per method that serves the real server', async () => {
    for (const [name, value] of Object.entries({
      ...VERCEL_ENV,
      ARCGIS_DOCS_CACHE_DIR: cacheDir,
    })) {
      vi.stubEnv(name, value);
    }
    const entry = await import('../../api/mcp.js');
    expect(Object.keys(entry).sort()).toEqual(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'POST']);
    expect(new Set([entry.GET, entry.HEAD, entry.POST, entry.DELETE, entry.OPTIONS]).size).toBe(1);

    const bearer = { authorization: `Bearer ${TOKEN}` };
    expect((await entry.POST(post(initialize))).status).toBe(401);
    const listed = await entry.POST(
      post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, bearer),
    );
    expect(listed.status).toBe(200);
    expect(listed.headers.get('cache-control')).toMatch(/^no-store/);
    const { result } = (await rpc(listed)) as { result: { tools: Array<{ name: string }> } };
    expect(result.tools.map((tool) => tool.name)).toEqual([...TOOL_ORDER]);
    expect(result.tools.map((tool) => tool.name)).toContain(TOOLS.read);

    const health = await entry.GET(
      new Request(`https://${HOST}/healthz`, { headers: { host: HOST } }),
    );
    expect(await health.json()).toMatchObject({ status: 'ok', server: SERVER_NAME });
    // Importing the whole server through the test transform takes several seconds.
  }, 60_000);
});
