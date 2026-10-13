import { describe, expect, it } from 'vitest';
import { bindSource } from '../../src/core/adapter-helpers.js';
import { ConfigSchema } from '../../src/core/config.js';
import { McpDocError, isMcpDocError, type ErrorCode } from '../../src/core/errors.js';
import type { CachedHttpEntry } from '../../src/core/ports.js';
import {
  makeConfig,
  makeDocPage,
  makeHost,
  makeLine,
  makeProduct,
  makeRecord,
  makeResponse,
  makeSource,
} from './builders.js';
import { FakeAdapter, fakeAdapterRegistry } from './fake-adapter.js';
import { DAY, FAKE_NOW, FakeClock, HOUR, MINUTE, SECOND } from './fake-clock.js';
import { FakeGithub } from './fake-github.js';
import { FakeLogger } from './fake-logger.js';
import { fakePolicy, permissiveHost } from './fake-policy.js';
import { FakeRenderer } from './fake-render.js';
import { makeCall, makeCtx } from './make-ctx.js';
import { MemoryCache } from './memory-cache.js';
import { Prng, forSeeds } from './prng.js';

async function codeOf(run: () => unknown): Promise<ErrorCode | 'no error' | 'other error'> {
  try {
    await run();
    return 'no error';
  } catch (error) {
    return isMcpDocError(error) ? error.code : 'other error';
  }
}

describe('FakeClock', () => {
  it('moves only when told to', () => {
    const clock = new FakeClock();
    expect(clock.now()).toBe(FAKE_NOW);
    expect(clock.iso()).toBe('2026-10-13T12:00:00.000Z');
    expect(clock.today()).toBe('2026-10-13');
    expect(clock.advance(12 * HOUR)).toBe(FAKE_NOW + 12 * HOUR);
    expect(clock.today()).toBe('2026-10-14');
    clock.set('2027-01-01T00:00:00Z');
    expect(clock.today()).toBe('2027-01-01');
    clock.set(0);
    expect(clock.iso()).toBe('1970-01-01T00:00:00.000Z');
    expect(new FakeClock('2026-01-02T03:04:05Z').iso()).toBe('2026-01-02T03:04:05.000Z');
    expect([SECOND, MINUTE, HOUR, DAY]).toEqual([1000, 60_000, 3_600_000, 86_400_000]);
  });
});

describe('FakeLogger', () => {
  it('captures entries by level', () => {
    const logger = new FakeLogger();
    logger.debug('d');
    logger.info('i', { n: 1 });
    logger.warn('w');
    logger.error('e');
    expect(logger.messages()).toEqual(['d', 'i', 'w', 'e']);
    expect(logger.messages('warn')).toEqual(['w']);
    expect(logger.entries[1]).toEqual({ level: 'info', msg: 'i', fields: { n: 1 } });
    expect(logger.entries[0]).not.toHaveProperty('fields');
    logger.clear();
    expect(logger.entries).toEqual([]);
  });
});

describe('MemoryCache', () => {
  const entry: CachedHttpEntry = {
    url: 'https://h.example/a',
    finalUrl: 'https://h.example/a',
    aliasChain: [],
    status: 200,
    contentType: 'text/html',
    body: '<p>a</p>',
    fetchedAt: FAKE_NOW,
    freshUntil: FAKE_NOW + DAY,
    staleUntil: FAKE_NOW + 30 * DAY,
    ttl: 'page',
  };

  it('stores HTTP entries by value and patches them on touch', async () => {
    const cache = new MemoryCache();
    expect(await cache.getHttp('k')).toBeUndefined();
    await cache.putHttp('k', entry);
    const read = await cache.getHttp('k');
    expect(read).toEqual(entry);
    expect(read).not.toBe(entry);
    await cache.touchHttp('k', { freshUntil: 1, staleUntil: 2, etag: '"v2"' });
    expect(await cache.getHttp('k')).toMatchObject({
      freshUntil: 1,
      staleUntil: 2,
      etag: '"v2"',
      body: '<p>a</p>',
    });
    await cache.touchHttp('missing', { freshUntil: 1, staleUntil: 2 });
    expect(cache.httpKeys()).toEqual(['k']);
    expect(cache.reads.http).toBe(3);
    expect(cache.writes.http).toBe(2);
  });

  it('stores derived values per namespace as JSON', async () => {
    const cache = new MemoryCache();
    await cache.putDerived('catalog', 'k', { records: [1, 2], dropped: undefined });
    await cache.putDerived('symbols', 'k', 'other namespace');
    expect(await cache.getDerived('catalog', 'k')).toEqual({ records: [1, 2] });
    expect(await cache.getDerived('symbols', 'k')).toBe('other namespace');
    expect(await cache.getDerived('doc', 'k')).toBeUndefined();
    expect(cache.derivedKeys()).toEqual([
      ['catalog', 'k'],
      ['symbols', 'k'],
    ]);
    await cache.deleteDerived('catalog', 'k');
    expect(await cache.getDerived('catalog', 'k')).toBeUndefined();
    expect(cache.writes.derived).toBe(2);
    expect(cache.reads.derived).toBe(4);
  });

  it('memoises per key, shares in-flight work and forgets failures', async () => {
    const cache = new MemoryCache();
    let computes = 0;
    const compute = async () => ({ value: ++computes, bytes: 100 });
    const [a, b] = await Promise.all([cache.memo('k', compute), cache.memo('k', compute)]);
    expect([a, b]).toEqual([1, 1]);
    expect(await cache.memo('other', compute)).toBe(2);
    expect(cache.memoComputes).toBe(2);
    expect(cache.memoSize()).toBe(200);

    await expect(
      cache.memo('bad', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await cache.memo('bad', async () => ({ value: 'ok', bytes: 1 }))).toBe('ok');

    cache.evictMemo();
    expect(cache.memoSize()).toBe(0);
    expect(await cache.memo('k', compute)).toBe(3);
  });

  it('reports size and clears by scope', async () => {
    const cache = new MemoryCache();
    await cache.putHttp('h', entry);
    await cache.putDerived('misc', 'd', { a: 1 });
    await cache.memo('m', async () => ({ value: 1, bytes: 10 }));
    const info = await cache.info();
    expect(info.entries).toBe(2);
    expect(info.bytes).toBeGreaterThan(0);
    expect(info.dir).toBe('(memory)');

    await cache.clear('http');
    expect(cache.httpKeys()).toEqual([]);
    expect(cache.derivedKeys()).toHaveLength(1);
    expect(cache.memoSize()).toBe(10);
    await cache.putHttp('h', entry);
    await cache.clear('derived');
    expect(cache.httpKeys()).toEqual(['h']);
    expect(cache.derivedKeys()).toEqual([]);
    await cache.clear();
    expect((await cache.info()).entries).toBe(0);
    expect(cache.memoSize()).toBe(0);
  });
});

describe('FakeGithub', () => {
  const github = () =>
    new FakeGithub({
      'Esri/example': {
        defaultBranch: 'master',
        files: {
          '*': { 'README.md': '# Example', 'docs/a.md': 'A' },
          'v1.0.0': { 'README.md': '# Example 1.0' },
        },
        wiki: { Home: '# Wiki home' },
        release: { tag: 'v1.0.0', publishedAt: '2026-09-01T00:00:00Z' },
      },
      'Esri/bare': {},
    });

  it('serves metadata, trees, raw files, wiki pages and releases', async () => {
    const gh = github();
    expect(await gh.repoMeta('Esri/example')).toEqual({
      defaultBranch: 'master',
      license: 'apache-2.0',
      archived: false,
    });
    expect(await gh.repoMeta('Esri/bare')).toMatchObject({ defaultBranch: 'main' });
    expect(await gh.tree('Esri/example', 'master')).toEqual([
      { path: 'README.md', size: 9 },
      { path: 'docs/a.md', size: 1 },
    ]);
    expect((await gh.raw('Esri/example', 'v1.0.0', 'README.md')).text).toBe('# Example 1.0');
    expect((await gh.raw('Esri/example', 'master', 'docs/a.md')).url).toBe(
      'https://raw.githubusercontent.com/Esri/example/master/docs/a.md',
    );
    expect((await gh.wikiRaw('Esri/example', 'Home.md')).text).toBe('# Wiki home');
    expect(await gh.latestRelease('Esri/example')).toEqual({
      tag: 'v1.0.0',
      publishedAt: '2026-09-01T00:00:00Z',
    });
    expect(await gh.latestRelease('Esri/bare')).toBeUndefined();
    expect(gh.count()).toBe(8);
    expect(gh.count('raw')).toBe(2);
    expect(gh.calls[2]).toEqual({ method: 'tree', repo: 'Esri/example', ref: 'master' });
  });

  it('answers DOC_NOT_FOUND for unknown repos, refs, paths and wiki pages', async () => {
    const gh = github();
    expect(await codeOf(() => gh.repoMeta('Esri/missing'))).toBe('DOC_NOT_FOUND');
    expect(await codeOf(() => gh.raw('Esri/example', 'v1.0.0', 'docs/a.md'))).toBe('DOC_NOT_FOUND');
    expect(await codeOf(() => gh.tree('Esri/bare', 'main'))).toBe('DOC_NOT_FOUND');
    expect(await codeOf(() => gh.wikiRaw('Esri/example', 'Missing'))).toBe('DOC_NOT_FOUND');
  });

  it('rate-limits the API but not raw content once the quota is exhausted', async () => {
    const gh = github().exhaustQuota('2026-10-13T13:00:00Z');
    expect(gh.quota()).toEqual({
      authenticated: false,
      remaining: 0,
      resetAt: '2026-10-13T13:00:00Z',
    });
    expect(await codeOf(() => gh.repoMeta('Esri/example'))).toBe('RATE_LIMITED_GITHUB');
    expect(await codeOf(() => gh.tree('Esri/example', 'master'))).toBe('RATE_LIMITED_GITHUB');
    expect(await codeOf(() => gh.latestRelease('Esri/example'))).toBe('RATE_LIMITED_GITHUB');
    expect((await gh.raw('Esri/example', 'master', 'README.md')).status).toBe(200);

    gh.restoreQuota({ authenticated: true });
    expect(gh.quota()).toEqual({ authenticated: true, remaining: 5000 });
    await gh.repoMeta('Esri/example');
    expect(gh.quota().remaining).toBe(4999);
    expect(gh.restoreQuota({ remaining: 3 }).quota().remaining).toBe(3);
    expect(new FakeGithub().addRepo('Esri/x', {}).restoreQuota().quota().remaining).toBe(60);
  });
});

describe('fakePolicy', () => {
  const url = (text: string): URL => new URL(text);

  it('allows any https host under website when no host table is given', () => {
    const policy = fakePolicy();
    expect(policy.check(url('https://anything.example/x'))).toEqual({
      host: permissiveHost('anything.example'),
      capability: 'website',
    });
    expect(policy.enabled('website')).toBe(true);
    expect(policy.enabled('site-search')).toBe(false);
    expect(policy.checked).toEqual(['https://anything.example/x']);
    expect(policy.summary()).toMatchObject({ preset: 'test', offline: false });
    expect(policy.summary().disabled).toEqual(['site-search', 'lifecycle-api']);
  });

  it('applies allow-list, link-only and capability decisions with a host table', async () => {
    const policy = fakePolicy({
      enabled: ['website'],
      offline: true,
      hosts: [
        makeHost(),
        makeHost({ host: 'archive.developers.arcgis.com', capability: null }),
        makeHost({ host: 'cdn.jsdelivr.net', capability: 'package-cdn' }),
      ],
    });
    expect(policy.check(url('https://developers.arcgis.com/x')).capability).toBe('website');
    expect(await codeOf(() => policy.check(url('https://evil.example/x')))).toBe(
      'HOST_NOT_ALLOWED',
    );
    expect(await codeOf(() => policy.check(url('http://developers.arcgis.com/x')))).toBe(
      'HOST_NOT_ALLOWED',
    );
    expect(await codeOf(() => policy.check(url('https://archive.developers.arcgis.com/x')))).toBe(
      'LINK_ONLY',
    );
    expect(await codeOf(() => policy.check(url('https://cdn.jsdelivr.net/npm/x')))).toBe(
      'SOURCE_DISABLED',
    );
    expect(policy.summary()).toMatchObject({ enabled: ['website'], offline: true });
  });
});

describe('FakeRenderer', () => {
  const meta = {
    url: 'https://developers.arcgis.com/widgets/a/',
    kind: 'guide',
    license: 'esri-website-terms',
  } as const;

  it('renders markdown into sections and copies metadata from meta', () => {
    const renderer = new FakeRenderer();
    const res = makeResponse({
      cache: 'stale',
      aliasChain: ['https://developers.arcgis.com/old/'],
    });
    const page = renderer.render(
      'markdown',
      { markdown: '# Title\n\nBody\n\n## Part\n\nMore' },
      { ...meta, product: 'widgets-sdk', source: 'guide', line: 'latest', version: '5.1', res },
      { detail: 'summary' },
    );
    expect(page).toMatchObject({
      ref: meta.url,
      title: 'Title',
      product: 'widgets-sdk',
      source: 'guide',
      line: 'latest',
      version: '5.1',
      cache: 'stale',
      redirectedFrom: ['https://developers.arcgis.com/old/'],
    });
    expect(page.sections.map((section) => section.id)).toEqual(['title', 'part']);
    expect(page.attribution).toContain('cached, stale');
    expect(page.diagnostics).toMatchObject({
      family: 'structured',
      renderer: 'markdown',
      redirectHops: 1,
    });
    expect(renderer.calls[0]).toMatchObject({ kind: 'markdown', opts: { detail: 'summary' } });
  });

  it('reduces html to text and names the renderer for structured kinds', () => {
    const renderer = new FakeRenderer();
    renderer.family = 'gatsby';
    const html = renderer.render('html', { html: '<main><h1>Hello</h1><p>World</p></main>' }, meta);
    expect(html.sections[0]?.markdown).toBe('Hello World');
    expect(html.diagnostics.family).toBe('gatsby');
    expect(html).not.toHaveProperty('product');
    expect(renderer.calls[0]).not.toHaveProperty('opts');
    expect(renderer.render('docc', { json: {} }, meta).title).toBe('Rendered by docc');
    expect(renderer.detectFamily()).toBe('gatsby');
  });

  it('returns canned pages and per-kind handlers', () => {
    const canned = makeDocPage({ title: 'Canned' });
    const handled = makeDocPage({ title: 'Handled' });
    const renderer = new FakeRenderer().when('cem', () => handled);
    expect(renderer.render('cem', { manifest: {}, tag: 'x-y', packageName: 'p' }, meta)).toBe(
      handled,
    );
    expect(
      renderer.returns(canned).render('cem', { manifest: {}, tag: 'x-y', packageName: 'p' }, meta),
    ).toBe(canned);
    expect(renderer.calls).toHaveLength(2);
  });

  it('detects a meta-refresh stub', () => {
    const renderer = new FakeRenderer();
    expect(
      renderer.detectMetaRefresh(
        '<html><head><meta http-equiv="refresh" content="0; url=../new/"></head></html>',
        'https://doc.arcgis.com/en/x/old/',
      ),
    ).toBe('https://doc.arcgis.com/en/x/new/');
    expect(
      renderer.detectMetaRefresh('<html><body>page</body></html>', 'https://h.example/'),
    ).toBeUndefined();
  });
});

describe('FakeAdapter', () => {
  const product = makeProduct();
  const source = makeSource('gatsby', { base: '/widgets/' });
  const src = bindSource(product, source, makeLine());
  const member = makeRecord({
    ref: 'https://developers.arcgis.com/widgets/api/Widget/#render',
    kind: 'api',
    symbol: 'render',
    qualified: 'Widget.render',
    parent: 'Widget',
  });
  const page = makeDocPage({ title: 'Widget' });
  const adapter = () =>
    new FakeAdapter('gatsby', {
      records: [
        makeRecord(),
        member,
        makeRecord({ ref: 'https://developers.arcgis.com/widgets/v1/x/', line: 'v1' }),
      ],
      pages: { 'https://developers.arcgis.com/widgets/api/Widget/': page },
    });

  it('enumerates the records of the bound line and logs calls', async () => {
    const fake = adapter();
    const ctx = makeCtx();
    expect((await fake.enumerate?.(ctx, src))?.map((record) => record.title)).toEqual([
      'Get started',
      'Get started',
    ]);
    expect(fake.calls).toEqual([
      { method: 'enumerate', product: 'widgets-sdk', source: 'guide', line: 'latest' },
    ]);
    fake.setRecords([]);
    expect(await fake.enumerate?.(ctx, src)).toEqual([]);
    expect(fake.count('enumerate')).toBe(2);
    expect(fake.maxEnumerateRequests).toBe(5);
    expect(
      new FakeAdapter('static', { noEnumerate: true, maxEnumerateRequests: 1 }).enumerate,
    ).toBeUndefined();
  });

  it('reads pages ignoring the fragment, and resolves symbols through read', async () => {
    const fake = adapter();
    const ctx = makeCtx();
    expect(await fake.read(ctx, src, { url: new URL(member.ref) })).toBe(page);
    expect(await fake.symbol(ctx, src, member, 'signature')).toBe(page);
    expect(fake.calls.map((call) => call.method)).toEqual(['read', 'symbol', 'read']);
    expect(fake.calls[2]?.target?.select).toEqual({ member: 'render' });
    expect(fake.calls[1]).toMatchObject({ ref: member.ref, detail: 'signature' });
    expect(
      await codeOf(() =>
        fake.read(ctx, src, { url: new URL('https://developers.arcgis.com/widgets/none/') }),
      ),
    ).toBe('DOC_NOT_FOUND');
    fake.addPage(makeRecord().ref, page);
    expect(await fake.sample(ctx, src, makeRecord())).toBe(page);
    expect(await fake.probe(ctx, src)).toEqual({ ok: true, ms: 1 });
  });

  it('fails on request, a limited number of times, and heals', async () => {
    const fake = adapter();
    const ctx = makeCtx();
    const down = new McpDocError('UPSTREAM_UNAVAILABLE', 'down');
    fake.failOn('enumerate', down, 1);
    await expect(fake.enumerate?.(ctx, src)).rejects.toBe(down);
    await expect(fake.enumerate?.(ctx, src)).resolves.toHaveLength(2);
    fake.failOn('probe', new Error('boom'));
    await expect(fake.probe(ctx, src)).rejects.toThrow('boom');
    await expect(fake.probe(ctx, src)).rejects.toThrow('boom');
    await expect(fake.heal().probe(ctx, src)).resolves.toMatchObject({ ok: true });
  });

  it('blocks a method until released', async () => {
    const fake = adapter();
    const ctx = makeCtx();
    const release = fake.block('enumerate');
    let settled = false;
    const pending = fake.enumerate?.(ctx, src).then((records) => {
      settled = true;
      return records;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(fake.count('enumerate')).toBe(1);
    release();
    await expect(pending).resolves.toHaveLength(2);
  });

  it('builds an adapter registry', () => {
    const gatsby = adapter();
    const registry = fakeAdapterRegistry([gatsby, new FakeAdapter('static')]);
    expect(registry.get('gatsby')).toBe(gatsby);
    expect(registry.types()).toEqual(['gatsby', 'static']);
    expect(() => registry.get('docc')).toThrow(/no fake adapter registered for type "docc"/);
  });
});

describe('makeCtx and builders', () => {
  it('builds a complete offline context sharing one clock', async () => {
    const ctx = makeCtx();
    expect(ConfigSchema.safeParse(ctx.config).success).toBe(true);
    expect(await ctx.workspace()).toEqual([]);
    expect(ctx.registry.all().map((product) => product.id)).toEqual(['widgets-sdk']);
    expect(ctx.policy.enabled('website')).toBe(true);

    ctx.http.on('https://developers.arcgis.com/widgets/', { body: '<main>x</main>' });
    ctx.clock.advance(HOUR);
    const res = await ctx.http.get({
      url: 'https://developers.arcgis.com/widgets/',
      expect: 'html',
    });
    expect(res.fetchedAt).toBe('2026-10-13T13:00:00.000Z');
    expect(
      (await ctx.github.raw('Esri/x', 'main', 'a').catch((error: unknown) => error)) instanceof
        McpDocError,
    ).toBe(true);
  });

  it('accepts overrides and shorthands', async () => {
    const clock = new FakeClock('2027-01-01T00:00:00Z');
    const product = makeProduct({ id: 'other-sdk', aliases: [] });
    const sdk = {
      product: 'other-sdk',
      package: '@example/other',
      version: '1.0.0',
      file: 'package.json',
    };
    const ctx = makeCtx({
      clock,
      products: [product],
      workspace: [sdk],
      config: { mode: 'http', capabilities: new Set(['github']) },
      cassette: { interactions: [{ url: 'https://h.example/a', response: { body: 'a' } }] },
      render: new FakeRenderer(),
      logger: new FakeLogger(),
      cache: new MemoryCache(),
      github: new FakeGithub(),
    });
    expect(ctx.clock).toBe(clock);
    expect(ctx.config.mode).toBe('http');
    expect(ctx.policy.enabled('website')).toBe(false);
    expect(ctx.registry.get('other-sdk')).toBe(product);
    expect(await ctx.workspace()).toEqual([sdk]);
    expect((await ctx.http.get({ url: 'https://h.example/a', expect: 'text' })).fetchedAt).toBe(
      '2027-01-01T00:00:00.000Z',
    );
    const policy = fakePolicy();
    expect(makeCtx({ policy }).policy).toBe(policy);
  });

  it('creates call options from the configured limits', () => {
    const ctx = makeCtx({ config: { limits: { ...makeConfig().limits, requestsPerCall: 3 } } });
    const call = makeCall(ctx);
    expect(call.budget).toEqual({ maxRequests: 3, used: 0, deadline: FAKE_NOW + 25_000 });
    const signal = new AbortController().signal;
    expect(makeCall(ctx, { signal }).signal).toBe(signal);
  });

  it('builds a page whose attribution follows its licence tier', () => {
    expect(makeDocPage().attribution).toMatch(
      /^Source: Esri, https:\/\/developers\.arcgis\.com\/widgets\/get-started\//,
    );
    expect(makeDocPage({ license: 'project' }).attribution).toBe('');
    expect(makeDocPage({ markdown: '' })).toMatchObject({ title: 'Untitled', sections: [] });
    expect(makeDocPage({ ref: 'https://h.example/x' }).url).toBe('https://h.example/x');
    expect(makeDocPage().sections.map((section) => section.id)).toEqual([
      'get-started',
      'install',
      'options',
    ]);
  });
});

describe('Prng', () => {
  it('is deterministic per seed and stays in range', () => {
    const draw = (seed: number): number[] => {
      const rng = new Prng(seed);
      return Array.from({ length: 5 }, () => rng.int(1, 6));
    };
    expect(draw(7)).toEqual(draw(7));
    expect(draw(7)).not.toEqual(draw(8));
    const rng = new Prng(1);
    for (let i = 0; i < 500; i++) {
      const float = rng.next();
      expect(float >= 0 && float < 1).toBe(true);
      const int = rng.int(-2, 2);
      expect(int >= -2 && int <= 2 && Number.isInteger(int)).toBe(true);
    }
    expect(rng.string(8, 'ab')).toMatch(/^[ab]{8}$/);
    expect(rng.words(3).split(' ')).toHaveLength(3);
    expect(['x', 'y']).toContain(rng.pick(['x', 'y']));
    expect(typeof rng.chance()).toBe('boolean');
    expect(() => rng.pick([])).toThrow(/non-empty/);
  });

  it('names the failing seed', () => {
    const seeds: number[] = [];
    forSeeds(3, (_rng, seed) => seeds.push(seed));
    expect(seeds).toEqual([1, 2, 3]);
    expect(() =>
      forSeeds(5, (_rng, seed) => {
        if (seed === 4) throw new Error('nope');
      }),
    ).toThrow('property failed for seed 4');
  });
});
