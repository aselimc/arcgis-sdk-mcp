import { describe, expect, it } from 'vitest';
import {
  absoluteUrl,
  continueWithout,
  probeSource,
  staticAdapter,
} from '../../../../src/adapters/site/static.js';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import { newBudget } from '../../../../src/core/async.js';
import { McpDocError } from '../../../../src/core/errors.js';
import type { Probe } from '../../../../src/core/types.js';
import { makeLine, makeProduct, makeSource } from '../../../support/builders.js';
import { loadCassette } from '../../../support/fixtures.js';
import { makeCtx, type TestCtx } from '../../../support/make-ctx.js';
import { describeSiteAdapterContract, rendererOf } from '../contract.js';

const OVERVIEW = 'https://location.arcgis.com/help/widgets-overview/';
const MIGRATE = 'https://developers.arcgis.com/widgets/v2/migrate/';

const card = makeSource(
  'static',
  {
    entries: [
      { url: OVERVIEW, title: 'Widgets overview', kind: 'help' },
      { url: '/widgets/{prefix}migrate/', title: 'Migrate to version 2', kind: 'guide' },
      { url: OVERVIEW, title: 'Listed twice', kind: 'guide' },
    ],
  },
  {
    id: 'card',
    title: 'Entry pages',
    kinds: ['help', 'guide'],
    probe: { url: OVERVIEW, expect: 'html', minChars: 100 },
  },
);
const product = makeProduct({ sources: [card] });
const line = makeLine({ vars: { prefix: 'v2/' } });
const ctxOf = (): TestCtx =>
  makeCtx({ cassette: loadCassette('cassettes', 'site', 'core', 'static.json') });
const bound = () => bindSource(product, card, line);

describeSiteAdapterContract('static (fixed entries)', () => ({
  adapter: staticAdapter,
  product: makeProduct({ sources: [card], lines: [line] }),
  source: card,
  ctx: ctxOf,
  allowedHosts: ['location.arcgis.com', 'developers.arcgis.com'],
  minRecords: 2,
  readRef: OVERVIEW,
  failures: {
    renamedField: { notApplicable: 'the catalogue is registry data' },
    missingFile: { notApplicable: 'enumeration requests nothing' },
    emptyIndex: { notApplicable: 'enumeration requests nothing' },
    htmlInsteadOfJson: { notApplicable: 'the source reads no JSON' },
  },
}));

describe('static: enumerate and read', () => {
  it('lists its entries from the registry without a request', async () => {
    const ctx = ctxOf();
    const records = await staticAdapter.enumerate!(ctx, bound());
    expect(records.map((record) => [record.ref, record.title, record.kind])).toEqual([
      [OVERVIEW, 'Widgets overview', 'help'],
      [MIGRATE, 'Migrate to version 2', 'guide'],
    ]);
    expect(ctx.http.count()).toBe(0);
  });

  it('still lists entries of a link-only line, which are answered as links when read', async () => {
    const src = bindSource(product, card, { ...line, access: 'link-only' });
    expect(await staticAdapter.enumerate!(ctxOf(), src)).toHaveLength(2);
    await expect(
      staticAdapter.read(ctxOf(), src, { url: new URL(OVERVIEW) }),
    ).rejects.toMatchObject({
      code: 'LINK_ONLY',
      details: { url: OVERVIEW, host: 'location.arcgis.com' },
    });
  });

  it('reads an entry with the kind the registry gives it', async () => {
    const ctx = ctxOf();
    expect((await staticAdapter.read(ctx, bound(), { url: new URL(OVERVIEW) })).kind).toBe('help');
    expect(
      (await staticAdapter.read(ctx, bound(), { url: new URL(`${MIGRATE}#steps`) })).kind,
    ).toBe('guide');
  });

  it('reads an unlisted URL as the first kind of the source', async () => {
    const ctx = ctxOf();
    ctx.http.on('https://location.arcgis.com/help/other/', { body: '<main><h1>Other</h1></main>' });
    const page = await staticAdapter.read(ctx, bound(), {
      url: new URL('https://location.arcgis.com/help/other/'),
    });
    expect(page.kind).toBe('help');
  });

  it('passes the request budget of the bound source to the gateway', async () => {
    const ctx = ctxOf();
    const budget = newBudget(1, 60_000, ctx.clock);
    const src = bindSource(product, card, line, undefined, budget);
    await staticAdapter.read(ctx, src, { url: new URL(OVERVIEW) });
    expect(budget.used).toBe(1);
    await expect(staticAdapter.read(ctx, src, { url: new URL(MIGRATE) })).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
    });
  });
});

describe('site helpers: absoluteUrl', () => {
  it('keeps full URLs, puts rooted paths on developers.arcgis.com and joins the rest to the source', () => {
    const src = bindSource(product, makeSource('astro', { base: '/widgets/{prefix}' }), line);
    expect(absoluteUrl('https://example.com/a', src)).toBe('https://example.com/a');
    expect(absoluteUrl('/gadgets/{prefix}x/', src)).toBe(
      'https://developers.arcgis.com/gadgets/v2/x/',
    );
    expect(absoluteUrl('sitemap-0.xml', src)).toBe(
      'https://developers.arcgis.com/widgets/v2/sitemap-0.xml',
    );
  });
});

describe('site helpers: probeSource', () => {
  const probing = (probe: Probe) => bindSource(product, { ...card, probe }, line);

  it('measures a page: length and detected family', async () => {
    const ctx = ctxOf();
    rendererOf(ctx).family = 'astro';
    const result = await probeSource(
      ctx,
      probing({ url: OVERVIEW, expect: 'html', family: 'astro' }),
    );
    expect(result).toMatchObject({ ok: true, family: 'astro', ms: 0 });
    expect(result.chars).toBeGreaterThan(100);
    expect(result.records).toBeUndefined();
  });

  it.each<[string, Probe, string]>([
    [
      'a page shorter than promised',
      { url: OVERVIEW, expect: 'html', minChars: 10_000 },
      'Expected at least 10000 characters, found ',
    ],
    [
      'a page of another family',
      { url: OVERVIEW, expect: 'html', family: 'gatsby' },
      'Expected page family gatsby, detected generic',
    ],
    [
      'a missing marker',
      { url: OVERVIEW, expect: 'html', mustContain: 'data-widget' },
      'The response does not contain "data-widget"',
    ],
    [
      'too few records',
      { url: OVERVIEW, expect: 'html', minRecords: 1 },
      'Expected at least 1 records, found 0',
    ],
  ])('fails on %s', async (_, probe, message) => {
    const result = await probeSource(ctxOf(), probing(probe));
    expect(result.ok).toBe(false);
    expect(result.error).toContain(message);
  });

  it.each<[string, unknown, number | undefined]>([
    ['an array', [1, 2, 3], 3],
    ['an object', { a: 1, b: 2 }, 2],
    ['an OpenAPI document', { openapi: '3.0.0', paths: { '/a': {}, '/b': {}, '/c': {} } }, 3],
    ['a search file', { index: JSON.stringify({ storedFields: { 0: {}, 1: {} } }) }, 2],
    ['a search file with a broken index', { index: '{"storedFields"' }, undefined],
  ])('counts the records of %s', async (_, json, records) => {
    const ctx = makeCtx();
    ctx.http.on('https://developers.arcgis.com/widgets/index.json', { json });
    const result = await probeSource(ctx, probing({ url: '/widgets/index.json', expect: 'json' }));
    expect(result.ok).toBe(true);
    expect(result.records).toBe(records);
  });

  it('uses the caller-supplied counter for bodies it cannot read itself', async () => {
    const ctx = makeCtx();
    ctx.http.on('https://developers.arcgis.com/widgets/list.txt', { body: 'a\nb\nc' });
    const result = await probeSource(
      ctx,
      probing({ url: '/widgets/list.txt', expect: 'text', minRecords: 3 }),
      {
        count: (text) => text.split('\n').length,
      },
    );
    expect(result).toMatchObject({ ok: true, records: 3 });
  });

  it('turns any failure into ok: false with the code and the cause', async () => {
    const ctx = ctxOf();
    ctx.http.fail(OVERVIEW, 403);
    const blocked = await probeSource(ctx, probing({ url: OVERVIEW, expect: 'html' }));
    expect(blocked).toMatchObject({
      ok: false,
      error: 'UPSTREAM_BLOCKED: location.arcgis.com refused the request (The server answered 403)',
    });

    const linkOnly = bindSource(product, card, { ...line, access: 'link-only' });
    expect((await probeSource(ctxOf(), linkOnly)).error).toMatch(/^LINK_ONLY: /);

    // Even a defect (here: a request the cassette does not know) is reported, not thrown.
    const unknown = await probeSource(makeCtx(), probing({ url: OVERVIEW, expect: 'html' }));
    expect(unknown).toMatchObject({ ok: false });
    expect(unknown.error).toMatch(/^INTERNAL: /);
  });
});

describe('site helpers: continueWithout', () => {
  const notFound = new McpDocError('DOC_NOT_FOUND', 'gone', { url: 'https://example.com/x' });

  it('logs an upstream failure and returns', () => {
    const ctx = makeCtx();
    continueWithout(ctx, bound(), notFound, 'The index');
    expect(ctx.logger.entries).toEqual([
      {
        level: 'warn',
        msg: 'The index is unavailable; enumerating without it',
        fields: {
          product: 'widgets-sdk',
          source: 'card',
          line: 'latest',
          code: 'DOC_NOT_FOUND',
          url: 'https://example.com/x',
        },
      },
    ]);
  });

  it('rethrows when the request budget is spent, and wraps anything that is not a typed error', () => {
    const ctx = makeCtx();
    const spent = bindSource(product, card, line, undefined, newBudget(0, 60_000, ctx.clock));
    expect(() => continueWithout(ctx, spent, notFound, 'The index')).toThrow(notFound);
    expect(() => continueWithout(ctx, bound(), new TypeError('boom'), 'The index')).toThrow(
      expect.objectContaining({ code: 'INTERNAL' }),
    );
    expect(ctx.logger.entries).toEqual([]);
  });
});
