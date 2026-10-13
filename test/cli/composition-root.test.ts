import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { missingAdapterTypes } from '../../src/app/adapter-registry.js';
import { createContainer, FACTORIES } from '../../src/app/composition-root.js';
import { runCall } from '../../src/cli/call.js';
import { withInProcessClient } from '../../src/cli/in-process-client.js';
import { selectProbeTargets } from '../../src/cli/doctor-probes.js';
import { TOOLS, TOOL_ORDER } from '../../src/core/names.js';
import { ADAPTER_TYPES } from '../../src/core/types.js';
import * as library from '../../src/index.js';
import { createServer } from '../../src/mcp/server.js';
import { makeConfig } from '../support/builders.js';
import { FakeLogger } from '../support/fake-logger.js';
import { MemoryCache } from '../support/memory-cache.js';

/**
 * The real factories, wired. Nothing here reaches the network: the unit project replaces the
 * global `fetch` with a guard, and the tests that fetch pass their own `fetchImpl`.
 */
describe('createContainer with the real factories', () => {
  let cacheDir: string;

  beforeAll(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'arcgis-sdk-mcp-root-'));
  });

  afterAll(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  const container = (overrides: Parameters<typeof makeConfig>[0] = {}, fetchImpl?: typeof fetch) =>
    createContainer(makeConfig({ cacheDir, ...overrides }), {
      logger: new FakeLogger(),
      ...(fetchImpl === undefined ? {} : { fetchImpl }),
    });

  it('registers exactly one adapter per adapter type', () => {
    const { adapters } = container();
    expect([...adapters.types()].sort()).toEqual([...ADAPTER_TYPES].sort());
    expect(missingAdapterTypes(adapters)).toEqual([]);
    for (const type of ADAPTER_TYPES) expect(adapters.get(type).type).toBe(type);
  });

  it('builds the context and every service without touching the network', () => {
    const built = container();
    expect(built.ctx.registry.all().length).toBeGreaterThan(100);
    expect(Object.keys(built.services).sort()).toEqual(
      ['catalog', 'docs', 'index', 'samples', 'search', 'symbols', 'versions'].sort(),
    );
    expect(built.ctx.http.hostStates()).toEqual([]);
  });

  it('builds the policy from the host table of the registry', () => {
    const { policy } = container();
    expect(
      policy.check(new URL('https://developers.arcgis.com/javascript/latest/')).capability,
    ).toBe('website');
    expect(() => policy.check(new URL('https://example.com/'))).toThrow(
      expect.objectContaining({ code: 'HOST_NOT_ALLOWED' }),
    );
    expect(policy.summary().preset).toBe('standard');
  });

  it('selects one floor source per developer product for doctor', () => {
    const { registry } = container();
    const targets = selectProbeTargets(registry, { tier: 'developer' });
    const products = new Set(targets.map((target) => target.product.id));
    expect(products.size).toBe(targets.length);
    expect(targets.length).toBeGreaterThan(40);
    expect(targets.every((target) => target.product.tier === 'developer')).toBe(true);
  });

  it('routes requests through the gateway with the injected fetch and the extractor', async () => {
    const requested: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      requested.push(url);
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
      return new Response(
        '<html><head><title>Widgets</title></head><body><main><h1>Widgets</h1>' +
          `<p>${'A paragraph of our own prose about widgets. '.repeat(12)}</p></main></body></html>`,
        { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    };
    const built = container({}, fetchImpl);
    const url = 'https://developers.arcgis.com/widgets-for-the-wiring-test/';
    const res = await built.http.get({ url, expect: 'html' });
    expect(res.status).toBe(200);
    expect(requested).toContain(url);
    expect(requested.every((entry) => new URL(entry).host === 'developers.arcgis.com')).toBe(true);

    const page = built.render.render(
      'html',
      { html: res.text },
      { url, kind: 'guide', license: 'esri-website-terms', res },
    );
    expect(page.title).toBe('Widgets');
    expect(page.attribution).toContain(url);
  });

  it('replaces a single factory on request', async () => {
    const cache = new MemoryCache();
    const built = createContainer(makeConfig(), { factories: { createCache: () => cache } });
    expect(built.cache).toBe(cache);
    expect(built.ctx.cache).toBe(cache);
    expect(FACTORIES.createCache).not.toBe(undefined);
  });

  it('serves the six tools in their fixed order', async () => {
    const listed = (await withInProcessClient(createServer(container()), '0.0.0', (request) =>
      request('tools/list'),
    )) as { tools: Array<{ name: string }> };
    expect(listed.tools.map((tool) => tool.name)).toEqual([...TOOL_ORDER]);
  });

  it('answers arcgis_docs_list_products offline, from registry data alone', async () => {
    const server = createServer(container({ offline: true }));
    const outcome = await runCall(server, TOOLS.listProducts, { query: 'kotlin' }, '0.0.0');
    expect(outcome.isError).toBe(false);
    expect(outcome.text).toContain('kotlin-maps-sdk');
  });

  it('exposes the public entry points from the library module', () => {
    expect(library.createContainer).toBe(createContainer);
    expect(library.createServer).toBe(createServer);
    expect(typeof library.loadConfig).toBe('function');
    expect(typeof library.readPackageInfo).toBe('function');
    expect(library.TOOL_ORDER).toBe(TOOL_ORDER);
  });
});
