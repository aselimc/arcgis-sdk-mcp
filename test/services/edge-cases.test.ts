import { describe, expect, it } from 'vitest';
import { McpDocError } from '../../src/core/errors.js';
import type { AdapterRegistry } from '../../src/core/ports.js';
import { createServices } from '../../src/services/index.js';
import { createIndexService } from '../../src/services/index/service.js';
import { makeLine, makeProduct, makeRecord, makeSource } from '../support/builders.js';
import { fakeRegistry } from '../support/fake-registry.js';
import { makeCall, makeCtx } from '../support/make-ctx.js';
import { fakeVersions, makeHarness } from './support/harness.js';
import { adapterRegistry, TestAdapter } from './support/test-adapter.js';

/** Failures that are nobody's upstream: missing adapters, crashes, broken collaborators. */
describe('services: internal failures', () => {
  const product = makeProduct();

  it('creates the services without any I/O', () => {
    const ctx = makeCtx({ registry: fakeRegistry({ products: [product] }) });
    const services = createServices(
      ctx,
      adapterRegistry([new TestAdapter('gatsby')]),
      fakeVersions(),
    );
    expect(Object.keys(services).sort()).toEqual([
      'catalog',
      'docs',
      'index',
      'samples',
      'search',
      'symbols',
    ]);
    expect(ctx.http.requests).toEqual([]);
    expect(ctx.cache.reads).toEqual({ http: 0, derived: 0 });
    expect(ctx.cache.writes).toEqual({ http: 0, derived: 0 });
  });

  it('indexes the entry links of a source whose adapter is not registered', async () => {
    const ctx = makeCtx({ registry: fakeRegistry({ products: [product] }) });
    const index = createIndexService(ctx, adapterRegistry([]));
    const [state] = await index.ensure(product, undefined, makeLine(), makeCall(ctx));
    expect(state).toMatchObject({ state: 'ready', records: 1 });
  });

  it('reports a source as unavailable when its build crashes outside the adapter', async () => {
    const ctx = makeCtx({ registry: fakeRegistry({ products: [product] }) });
    const broken: AdapterRegistry = {
      get: () => {
        throw new Error('registry exploded');
      },
      types: () => [],
    };
    ctx.policy.enabled = () => {
      throw new Error('policy exploded');
    };
    const index = createIndexService(ctx, broken);
    const [state] = await index.ensure(product, undefined, makeLine(), makeCall(ctx));
    expect(state).toMatchObject({ state: 'unavailable', records: 0 });
    expect(ctx.logger.messages('error')).toEqual(['index build crashed']);
  });

  it('wraps a crash while reading an unregistered page as INTERNAL', async () => {
    const h = makeHarness();
    const url = 'https://developers.arcgis.com/unlisted/page/';
    h.ctx.http.on(url, () => {
      throw new TypeError('renderer exploded');
    });
    await expect(
      h.services.docs.read({ ref: url, view: 'auto', maxTokens: 6000 }, h.call()),
    ).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(h.ctx.logger.messages('error')).toEqual(['document read failed unexpectedly']);
  });

  it('treats a source without an owner-side adapter claim as the registry decided', async () => {
    const twoSources = makeProduct({
      sources: [
        makeSource('gatsby', { base: '/widgets/' }),
        makeSource(
          'astro',
          { base: '/widgets/ref/' },
          { id: 'ref', floor: false, lines: ['other'] },
        ),
      ],
    });
    const ctx = makeCtx({ registry: fakeRegistry({ products: [twoSources] }) });
    const gatsby = new TestAdapter('gatsby');
    // The second adapter would claim everything, but its source does not exist on this line.
    const astro = new TestAdapter('astro', { owns: () => true });
    const services = createServices(ctx, adapterRegistry([gatsby, astro]), fakeVersions());
    await expect(
      services.docs.read(
        { ref: 'https://developers.arcgis.com/widgets/a/', view: 'auto', maxTokens: 6000 },
        makeCall(ctx),
      ),
    ).rejects.toBeInstanceOf(McpDocError);
    expect(gatsby.count('read')).toBe(1);
    expect(astro.count('read')).toBe(0);
  });

  it('keeps a failing symbol lookup error typed when the registry has no such version', async () => {
    const h = makeHarness({
      products: [product],
      records: [makeRecord({ kind: 'api', symbol: 'Widget', qualified: 'Widget' })],
    });
    await expect(
      h.services.symbols.lookup(
        {
          symbol: 'Widget',
          product: 'widgets-sdk',
          version: '0.1',
          detail: 'summary',
          maxTokens: 3000,
        },
        h.call(),
      ),
    ).rejects.toMatchObject({ code: 'VERSION_UNAVAILABLE' });
  });
});
