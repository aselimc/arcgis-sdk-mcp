import { describe, expect, it } from 'vitest';
import {
  isIndexCanary,
  probeSource,
  readHtmlPage,
  renderMeta,
  renderOptionsOf,
  symbolTarget,
} from '../../../src/adapters/kit/index.js';
import { bindSource } from '../../../src/core/adapter-helpers.js';
import type { Probe } from '../../../src/core/types.js';
import { makeLine, makeProduct, makeRecord, makeSource } from '../../support/builders.js';
import { fakePolicy } from '../../support/fake-policy.js';
import { makeCtx, type TestCtx } from '../../support/make-ctx.js';
import { rendererOf } from '../contract-kit.js';

const PAGE = 'https://developers.arcgis.com/widgets/overview/';
const source = makeSource(
  'astro',
  { base: '/widgets/' },
  { id: 'guide', probe: { url: PAGE, expect: 'html', family: 'astro' } },
);
const product = makeProduct({ sources: [source] });
const line = makeLine();
const bound = () => bindSource(product, source, line);
const body = `<main><h1>Overview</h1><p>${'Widgets do things. '.repeat(20)}</p></main>`;
const ctxOf = (): TestCtx => {
  const ctx = makeCtx();
  ctx.http.on(PAGE, { body });
  return ctx;
};

describe('adapter kit: render options and metadata', () => {
  const url = new URL(`${PAGE}#usage`);

  it('asks the renderer for nothing when the target asks for nothing', () => {
    expect(renderOptionsOf({})).toBeUndefined();
    expect(renderOptionsOf({}, { select: undefined })).toBeUndefined();
  });

  it('forwards the selector, the detail and the focused-code flag of every target', () => {
    expect(
      renderOptionsOf({ select: { section: 'usage' }, detail: 'summary', focusedCode: true }),
    ).toEqual({ select: { section: 'usage' }, detail: 'summary', focusedCode: true });
  });

  it('puts what the adapter adds on top, leaving the target alone where it adds nothing', () => {
    expect(renderOptionsOf({ select: { section: 'usage' } }, { verbatim: true })).toEqual({
      select: { section: 'usage' },
      verbatim: true,
    });
    expect(
      renderOptionsOf({ select: { section: 'usage' } }, { select: { member: 'spin' } }),
    ).toEqual({ select: { member: 'spin' } });
    expect(renderOptionsOf({ select: { section: 'usage' } }, { select: undefined })).toEqual({
      select: { section: 'usage' },
    });
  });

  it('describes a page by its source, and by the record that led to it', () => {
    expect(renderMeta(bound(), {}, url.href)).toEqual({
      url: url.href,
      product: 'widgets-sdk',
      source: 'guide',
      line: 'latest',
      kind: 'api',
      license: product.licenseTier,
    });
    expect(renderMeta(bound(), {}, url.href, undefined, 'guide').kind).toBe('guide');
    const record = makeRecord({ ref: url.href, kind: 'tutorial' });
    expect(renderMeta(bound(), { record }, url.href, undefined, 'guide').kind).toBe('tutorial');
  });

  it('selects a member by its anchor only when the record is a member', () => {
    const member = makeRecord({
      ref: 'https://developers.arcgis.com/w/T.html#go(int)',
      parent: 'T',
    });
    const broken = makeRecord({
      ref: 'https://developers.arcgis.com/w/T.html#%E0%A4%A',
      parent: 'T',
    });
    const type = makeRecord({ ref: 'https://developers.arcgis.com/w/T.html#top' });

    expect(symbolTarget(member, 'summary')).toMatchObject({
      select: { member: 'go(int)' },
      detail: 'summary',
      record: member,
    });
    expect(symbolTarget(broken, 'full').select).toEqual({ member: '%E0%A4%A' });
    expect(symbolTarget(type, 'full').select).toBeUndefined();
  });
});

describe('adapter kit: readHtmlPage', () => {
  it('requests the page without its fragment and renders it with the family of the source', async () => {
    const ctx = ctxOf();
    const page = await readHtmlPage(
      ctx,
      bound(),
      { url: new URL(`${PAGE}#usage`), focusedCode: true },
      { kind: 'guide' },
    );

    expect(ctx.http.requests.map((request) => request.url)).toEqual([PAGE]);
    expect(page.ref).toBe(`${PAGE}#usage`);
    expect(page.kind).toBe('guide');
    expect(rendererOf(ctx).calls).toMatchObject([
      { kind: 'html', input: { familyHint: 'astro' }, opts: { focusedCode: true } },
    ]);
  });

  it('lets the caller name the family, and reads nothing of a link-only line', async () => {
    const ctx = ctxOf();
    await readHtmlPage(ctx, bound(), { url: new URL(PAGE) }, { family: 'dokka' });
    expect(rendererOf(ctx).calls[0]?.input).toMatchObject({ familyHint: 'dokka' });
    expect(rendererOf(ctx).calls[0]?.meta.kind).toBe('api');

    const archived = bindSource(product, source, { ...line, access: 'link-only' });
    await expect(readHtmlPage(ctx, archived, { url: new URL(PAGE) })).rejects.toMatchObject({
      code: 'LINK_ONLY',
    });
    expect(ctx.http.count()).toBe(1);
  });
});

describe('adapter kit: probeSource', () => {
  const probing = (probe: Probe) => bindSource(product, { ...source, probe }, line);

  it('measures a page: length and detected family', async () => {
    const ctx = ctxOf();
    rendererOf(ctx).family = 'astro';
    const result = await probeSource(ctx, bound());
    expect(result).toMatchObject({ ok: true, family: 'astro', ms: 0 });
    expect(result.chars).toBeGreaterThan(100);
    expect(result.records).toBeUndefined();
  });

  it.each<[string, Probe, string]>([
    [
      'a page shorter than promised',
      { url: PAGE, expect: 'html', minChars: 10_000 },
      'Expected at least 10000 characters, found ',
    ],
    [
      'a page of another family',
      { url: PAGE, expect: 'html', family: 'gatsby' },
      'Expected page family gatsby, detected generic',
    ],
    [
      'a missing marker',
      { url: PAGE, expect: 'html', mustContain: 'data-widget' },
      'The response does not contain "data-widget"',
    ],
    [
      'too few records',
      { url: PAGE, expect: 'html', minRecords: 1 },
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

  it('counts the pages of a sitemap', async () => {
    const ctx = makeCtx();
    ctx.http.on('https://developers.arcgis.com/widgets/sitemap.xml', {
      body: `<urlset><url><loc>${PAGE}</loc></url><url><loc>${PAGE}more/</loc></url></urlset>`,
    });
    const result = await probeSource(ctx, probing({ url: 'sitemap.xml', expect: 'xml' }));
    expect(result).toMatchObject({ ok: true, records: 2 });
  });

  it('uses the caller-supplied counter for bodies it cannot read itself', async () => {
    const ctx = makeCtx();
    ctx.http.on('https://developers.arcgis.com/widgets/list.txt', { body: 'a\nb\nc' });
    const result = await probeSource(
      ctx,
      probing({ url: '/widgets/list.txt', expect: 'text', minRecords: 3 }),
      { count: (text) => text.split('\n').length },
    );
    expect(result).toMatchObject({ ok: true, records: 3 });
  });

  it('requests an index canary only while site-index is on, and only when told it is one', async () => {
    const index = probing({ url: '/widgets/index.json', expect: 'json' });
    const off = (): TestCtx => {
      const ctx = makeCtx({ policy: fakePolicy({ enabled: ['website'] }) });
      ctx.http.on('https://developers.arcgis.com/widgets/index.json', { json: [1] });
      return ctx;
    };

    expect(isIndexCanary(index)).toBe(true);
    expect(isIndexCanary(bound())).toBe(false);

    const gated = off();
    expect(await probeSource(gated, index, { siteIndex: isIndexCanary(index) })).toMatchObject({
      ok: false,
      error: 'Capability "site-index" is switched off',
    });
    expect(gated.http.count()).toBe(0);
    // An API description or a registry answer is JSON too, and needs no such capability.
    expect((await probeSource(off(), index)).ok).toBe(true);
  });

  it('asks a package registry on any version line, without keeping the answer for long', async () => {
    const registry = 'https://registry.npmjs.org/-/package/@arcgis%2fwidgets/dist-tags';
    const src = bindSource(
      product,
      { ...source, probe: { url: registry, expect: 'json' } },
      { ...line, access: 'link-only' },
    );
    const ctx = makeCtx();
    ctx.http.on(registry, { json: { latest: '1.0.0' } });
    const ttls: Array<string | undefined> = [];
    const get = ctx.http.get.bind(ctx.http);
    ctx.http.get = (request) => {
      ttls.push(request.ttl);
      return get(request);
    };

    expect((await probeSource(ctx, src)).error).toMatch(/^LINK_ONLY: /);
    const result = await probeSource(ctx, src, { ttl: 'volatile', versionAddressed: true });
    expect(result).toMatchObject({ ok: true, records: 1 });
    expect(ttls).toEqual(['volatile']);
  });

  it('turns any failure into ok: false with the code and the cause', async () => {
    const ctx = ctxOf();
    ctx.http.fail(PAGE, 403);
    expect(await probeSource(ctx, bound())).toMatchObject({
      ok: false,
      error:
        'UPSTREAM_BLOCKED: developers.arcgis.com refused the request (The server answered 403)',
    });

    // Even a defect (here: a request the fake does not know) is reported, not thrown.
    const unknown = await probeSource(makeCtx(), bound());
    expect(unknown).toMatchObject({ ok: false });
    expect(unknown.error).toMatch(/^INTERNAL: /);
  });
});
