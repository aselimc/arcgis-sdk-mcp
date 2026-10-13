import { describe, expect, it } from 'vitest';
import { createAdapterRegistry, missingAdapterTypes } from '../../src/app/adapter-registry.js';
import { buildContainer, type Factories } from '../../src/app/container.js';
import type { CreateHttpClient } from '../../src/core/factories.js';
import type { Ctx, Services, VersionService } from '../../src/core/ports.js';
import { ADAPTER_TYPES } from '../../src/core/types.js';
import { makeConfig } from '../support/builders.js';
import { FakeAdapter } from '../support/fake-adapter.js';
import { FakeClock } from '../support/fake-clock.js';
import { FakeGithub } from '../support/fake-github.js';
import { FakeHttp } from '../support/fake-http.js';
import { FakeLogger } from '../support/fake-logger.js';
import { fakePolicy } from '../support/fake-policy.js';
import { fakeRegistry } from '../support/fake-registry.js';
import { FakeRenderer } from '../support/fake-render.js';
import { MemoryCache } from '../support/memory-cache.js';

/** Fake factories that count their calls and keep what they were given. */
function makeFactories() {
  const created: string[] = [];
  const seen: {
    httpDeps?: Parameters<CreateHttpClient>[0];
    servicesCtx?: Ctx;
    versionsCtx?: Ctx;
    versions?: VersionService;
    workspaceCalls: number;
  } = { workspaceCalls: 0 };
  const versions = { label: async () => '1.0' } as unknown as VersionService;
  const services = { search: {}, docs: {} } as unknown as Omit<Services, 'versions'>;
  const renderer = new FakeRenderer();

  const factories: Factories = {
    createCache: () => {
      created.push('cache');
      return new MemoryCache();
    },
    createPolicy: ({ hosts }) => {
      created.push(`policy:${hosts.length}`);
      return fakePolicy();
    },
    createHttpClient: (deps) => {
      created.push('http');
      seen.httpDeps = deps;
      return new FakeHttp();
    },
    createGithubClient: () => {
      created.push('github');
      return new FakeGithub();
    },
    createRegistry: () => {
      created.push('registry');
      return fakeRegistry();
    },
    createVersionService: (ctx) => {
      created.push('versions');
      seen.versionsCtx = ctx;
      return versions;
    },
    detectWorkspace: async () => {
      seen.workspaceCalls += 1;
      return [{ product: 'widgets-sdk', package: '@widgets/core', version: '1.2.3', file: 'p.json' }];
    },
    createHtmlExtractor: () => {
      created.push('extractor');
      return {
        extract: (input, meta) => renderer.render('html', input, meta),
        detectFamily: () => 'generic',
        detectMetaRefresh: (html, base) => (html.includes('refresh') ? `${base}target` : undefined),
      };
    },
    createRenderer: () => {
      created.push('render');
      return renderer;
    },
    siteAdapters: () => [new FakeAdapter('gatsby'), new FakeAdapter('astro')],
    referenceAdapters: () => [new FakeAdapter('docc')],
    createServices: (ctx, adapters, injected) => {
      created.push(`services:${adapters.types().join(',')}`);
      seen.servicesCtx = ctx;
      seen.versions = injected;
      return services;
    },
  };
  return { factories, created, seen, versions, services };
}

describe('buildContainer', () => {
  it('constructs nothing until a member is read', () => {
    const { factories, created } = makeFactories();
    const container = buildContainer(makeConfig(), factories);
    expect(container.config.mode).toBe('stdio');
    expect(container.logger).toBeDefined();
    expect(container.clock.now()).toBeGreaterThan(0);
    expect(created).toEqual([]);
  });

  it('builds only what a member needs', () => {
    const { factories, created } = makeFactories();
    const container = buildContainer(makeConfig(), factories);
    expect(container.cache).toBeInstanceOf(MemoryCache);
    expect(created).toEqual(['cache']);
    expect(container.registry.all()).toHaveLength(1);
    expect(created).toEqual(['cache', 'registry']);
  });

  it('creates each member once', () => {
    const { factories, created } = makeFactories();
    const container = buildContainer(makeConfig(), factories);
    expect(container.services).toBe(container.services);
    expect(container.ctx).toBe(container.ctx);
    expect(container.http).toBe(container.ctx.http);
    expect(container.cache).toBe(container.ctx.cache);
    expect(container.policy).toBe(container.ctx.policy);
    expect(container.registry).toBe(container.ctx.registry);
    expect(container.github).toBe(container.ctx.github);
    expect(container.render).toBe(container.ctx.render);
    expect(new Set(created).size).toBe(created.length);
  });

  it('gives the policy the host table of the registry', () => {
    const { factories, created } = makeFactories();
    factories.createRegistry = () =>
      fakeRegistry({ hosts: [{ ...hostRow('a.example') }, { ...hostRow('b.example') }] });
    void buildContainer(makeConfig(), factories).policy;
    expect(created).toContain('policy:2');
  });

  it('wires the gateway with cache, policy, clock, logger and the meta-refresh detector', () => {
    const { factories, seen } = makeFactories();
    const logger = new FakeLogger();
    const clock = new FakeClock();
    const config = makeConfig();
    const container = buildContainer(config, factories, { logger, clock });
    void container.http;
    expect(seen.httpDeps).toMatchObject({ config, logger, clock });
    expect(seen.httpDeps?.cache).toBe(container.cache);
    expect(seen.httpDeps?.policy).toBe(container.policy);
    expect(seen.httpDeps?.detectMetaRefresh('<meta refresh>', 'https://x.example/')).toBe(
      'https://x.example/target',
    );
    expect(seen.httpDeps?.detectMetaRefresh('<p>page</p>', 'https://x.example/')).toBeUndefined();
    expect(seen.httpDeps && 'fetchImpl' in seen.httpDeps).toBe(false);
  });

  it('passes a replacement fetch to the gateway', () => {
    const { factories, seen } = makeFactories();
    const fetchImpl: typeof fetch = async () => new Response('ok');
    void buildContainer(makeConfig(), factories, { fetchImpl }).http;
    expect(seen.httpDeps?.fetchImpl).toBe(fetchImpl);
  });

  it('hands services the shared context, the adapters and the version service', () => {
    const { factories, created, seen, versions, services } = makeFactories();
    const container = buildContainer(makeConfig(), factories);
    expect(container.services).toMatchObject(services);
    expect(container.services.versions).toBe(versions);
    expect(seen.versions).toBe(versions);
    expect(seen.servicesCtx).toBe(container.ctx);
    expect(seen.versionsCtx).toBe(container.ctx);
    expect(created).toContain('services:gatsby,astro,docc');
    expect(container.adapters.types()).toEqual(['gatsby', 'astro', 'docc']);
  });

  it('uses the injected logger and clock everywhere', () => {
    const { factories } = makeFactories();
    const logger = new FakeLogger();
    const clock = new FakeClock();
    const container = buildContainer(makeConfig(), factories, { logger, clock });
    expect(container.ctx.logger).toBe(logger);
    expect(container.ctx.clock).toBe(clock);
  });
});

describe('container.workspace', () => {
  it('scans once and shares the result with the context', async () => {
    const { factories, seen } = makeFactories();
    const container = buildContainer(makeConfig(), factories);
    expect(seen.workspaceCalls).toBe(0);
    const [first, second, viaCtx] = await Promise.all([
      container.workspace(),
      container.workspace(),
      container.ctx.workspace(),
    ]);
    expect(first).toEqual([expect.objectContaining({ product: 'widgets-sdk', version: '1.2.3' })]);
    expect(second).toBe(first);
    expect(viaCtx).toBe(first);
    expect(seen.workspaceCalls).toBe(1);
  });

  it('is empty in HTTP mode without scanning', async () => {
    const { factories, seen } = makeFactories();
    const container = buildContainer(makeConfig({ mode: 'http' }), factories);
    expect(await container.workspace()).toEqual([]);
    expect(seen.workspaceCalls).toBe(0);
  });

  it('is empty when capability workspace is off', async () => {
    const { factories, seen } = makeFactories();
    const config = makeConfig({ capabilities: new Set(['website', 'github']) });
    expect(await buildContainer(config, factories).workspace()).toEqual([]);
    expect(seen.workspaceCalls).toBe(0);
  });

  it('logs a failed scan and answers with no SDKs', async () => {
    const { factories } = makeFactories();
    factories.detectWorkspace = async () => {
      throw new Error('EACCES');
    };
    const logger = new FakeLogger();
    const container = buildContainer(makeConfig(), factories, { logger });
    expect(await container.workspace()).toEqual([]);
    expect(logger.entries).toEqual([
      expect.objectContaining({ level: 'warn', msg: 'workspace detection failed' }),
    ]);
  });
});

describe('createAdapterRegistry', () => {
  it('finds adapters by type across the lists', () => {
    const gatsby = new FakeAdapter('gatsby');
    const docc = new FakeAdapter('docc');
    const registry = createAdapterRegistry([gatsby], [docc]);
    expect(registry.get('gatsby')).toBe(gatsby);
    expect(registry.get('docc')).toBe(docc);
    expect(registry.types()).toEqual(['gatsby', 'docc']);
  });

  it('refuses two adapters of one type', () => {
    expect(() =>
      createAdapterRegistry([new FakeAdapter('sitemap')], [new FakeAdapter('sitemap')]),
    ).toThrow(/Two source adapters .* "sitemap"/);
  });

  it('answers INTERNAL for a type it does not have', () => {
    const registry = createAdapterRegistry([new FakeAdapter('gatsby')]);
    expect(() => registry.get('pkgdown')).toThrow(
      expect.objectContaining({ code: 'INTERNAL', message: expect.stringContaining('pkgdown') }),
    );
  });

  it('lists the adapter types that are missing', () => {
    const registry = createAdapterRegistry(ADAPTER_TYPES.slice(2).map((type) => new FakeAdapter(type)));
    expect(missingAdapterTypes(registry)).toEqual(ADAPTER_TYPES.slice(0, 2));
    expect(missingAdapterTypes(createAdapterRegistry())).toEqual([...ADAPTER_TYPES]);
  });
});

function hostRow(host: string) {
  return {
    host,
    capability: 'website' as const,
    robotsDisallow: [],
    revalidate: 'etag' as const,
    ratePerSec: 2,
    maxConcurrent: 2,
  };
}
