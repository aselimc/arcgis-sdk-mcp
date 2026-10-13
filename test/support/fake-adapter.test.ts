import { describe, expect, it } from 'vitest';
import { bindSource } from '../../src/core/adapter-helpers.js';
import { ConfigSchema } from '../../src/core/config.js';
import { McpDocError, isMcpDocError, type ErrorCode } from '../../src/core/errors.js';
import {
  makeConfig,
  makeDocPage,
  makeLine,
  makeProduct,
  makeRecord,
  makeSource,
} from './builders.js';
import { FakeAdapter, fakeAdapterRegistry } from './fake-adapter.js';
import { FAKE_NOW, FakeClock, HOUR } from './fake-clock.js';
import { FakeGithub } from './fake-github.js';
import { FakeLogger } from './fake-logger.js';
import { fakePolicy } from './fake-policy.js';
import { FakeRenderer } from './fake-render.js';
import { makeCall, makeCtx } from './make-ctx.js';
import { MemoryCache } from './memory-cache.js';

async function codeOf(run: () => unknown): Promise<ErrorCode | 'no error' | 'other error'> {
  try {
    await run();
    return 'no error';
  } catch (error) {
    return isMcpDocError(error) ? error.code : 'other error';
  }
}

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
