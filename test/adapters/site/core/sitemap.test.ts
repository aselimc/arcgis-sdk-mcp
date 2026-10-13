import { describe, expect, it } from 'vitest';
import { readSitemap, sitemapAdapter } from '../../../../src/adapters/site/sitemap.js';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import { newBudget } from '../../../../src/core/async.js';
import { makeLine, makeProduct, makeSource } from '../../../support/builders.js';
import { loadCassette } from '../../../support/fixtures.js';
import { makeCtx, type TestCtx } from '../../../support/make-ctx.js';
import { describeSiteAdapterContract, replaceResponses } from '../contract.js';

const KB = 'https://support.esri.com/en-us/knowledge-base/';
const SITEMAP = `${KB}sitemap-articles.xml`;

const articles = makeSource(
  'sitemap',
  { url: SITEMAP, titleFrom: 'slug', kind: 'troubleshooting', exclude: ['^archive/'] },
  {
    id: 'articles',
    title: 'Knowledge base',
    kinds: ['troubleshooting'],
    probe: { url: SITEMAP, expect: 'xml', minRecords: 3 },
  },
);
const product = makeProduct({
  id: 'support-kb',
  name: 'Support knowledge base',
  homepage: KB,
  sources: [articles],
});
const cassette = () => loadCassette('cassettes', 'site', 'core', 'sitemap.json');
const ctxOf = (): TestCtx => makeCtx({ cassette: cassette() });
const indexCtx = (): TestCtx =>
  makeCtx({ cassette: loadCassette('cassettes', 'site', 'core', 'sitemap-index.json') });
const bound = () => bindSource(product, articles, makeLine());

describeSiteAdapterContract('sitemap (floor)', () => ({
  adapter: sitemapAdapter,
  product,
  source: articles,
  ctx: ctxOf,
  allowedHosts: ['support.esri.com'],
  minRecords: 4,
  readRef: `${KB}how-to-reset-a-widget-000010001`,
  failures: {
    renamedField: {
      // A sitemap whose entries are no longer <loc> elements reads as empty.
      arrange: (ctx) =>
        replaceResponses(ctx, cassette(), {
          [SITEMAP]: { body: `<urlset><url><location>${KB}a-000000001</location></url></urlset>` },
        }),
      outcome: 'typed-failure',
      codes: ['UPSTREAM_UNAVAILABLE'],
    },
    missingFile: {
      arrange: (ctx) => ctx.http.fail(SITEMAP, 404),
      outcome: 'typed-failure',
      codes: ['DOC_NOT_FOUND'],
    },
    emptyIndex: {
      arrange: (ctx) => replaceResponses(ctx, cassette(), { [SITEMAP]: { body: '<urlset/>' } }),
      outcome: 'typed-failure',
      codes: ['UPSTREAM_UNAVAILABLE'],
    },
    htmlInsteadOfJson: {
      // The catch-all page of a host arrives where XML was asked for.
      arrange: (ctx) => ctx.http.fail(SITEMAP, 'html'),
      outcome: 'typed-failure',
      codes: ['DOC_NOT_FOUND'],
    },
  },
}));

describe('sitemap: enumerate', () => {
  it('lists the pages under the sitemap directory with slug titles and the configured kind', async () => {
    const ctx = ctxOf();
    const records = await sitemapAdapter.enumerate!(ctx, bound());

    expect(records.map((record) => [record.ref, record.title, record.kind])).toEqual([
      [
        `${KB}how-to-reset-a-widget-000010001`,
        'How to reset a widget 000010001',
        'troubleshooting',
      ],
      [
        `${KB}error-widget-failed-to-load-000010002`,
        'Error widget failed to load 000010002',
        'troubleshooting',
      ],
      [
        `${KB}deprecation-widget-classic-000010003`,
        'Deprecation widget classic 000010003',
        'troubleshooting',
      ],
      // A plain-http entry is listed under https, the only scheme that is ever fetched.
      [`${KB}faq-plain-http-link-000010004`, 'Faq plain http link 000010004', 'troubleshooting'],
    ]);
    expect(records[0]).toMatchObject({ product: 'support-kb', source: 'articles', line: 'latest' });
    expect(ctx.http.count()).toBe(1);
  });

  it('classifies by rule before falling back to the configured kind', async () => {
    const classified = makeSource('sitemap', {
      url: SITEMAP,
      classify: [['^deprecation-', 'release-notes']],
    });
    const records = await sitemapAdapter.enumerate!(
      ctxOf(),
      bindSource(makeProduct({ sources: [classified] }), classified, makeLine()),
    );
    expect(records.map((record) => record.kind)).toEqual([
      'guide',
      'guide',
      'release-notes',
      'guide',
      'guide',
    ]);
  });

  it('follows a sitemap index one level and reads as many files as the budget allows', async () => {
    const ctx = indexCtx();
    const records = await sitemapAdapter.enumerate!(ctx, bound());

    expect(records.map((record) => record.ref)).toEqual([
      `${KB}how-to-reset-a-widget-000010001`,
      `${KB}error-widget-failed-to-load-000010002`,
      `${KB}deprecation-widget-classic-000010003`,
      `${KB}faq-third-file-000010005`,
    ]);
    // The index plus three of its four files: the fourth is beyond the per-sitemap allowance.
    expect(ctx.http.count()).toBe(4);
    expect(ctx.http.unrecorded).toEqual([]);
    expect(ctx.logger.messages('warn')).toEqual([
      'Sitemap index is larger than the request budget; reading its first files',
    ]);
  });

  it('skips a failing file of a sitemap index while another one answers', async () => {
    const ctx = indexCtx();
    ctx.http.fail(/sitemap-a\.xml$/, 503);
    const records = await sitemapAdapter.enumerate!(ctx, bound());
    expect(records).toHaveLength(3);
  });

  it('fails with the first error when no file of a sitemap index answers', async () => {
    const ctx = indexCtx();
    ctx.http.fail(/sitemap-[a-d]\.xml$/, 404);
    await expect(sitemapAdapter.enumerate!(ctx, bound())).rejects.toMatchObject({
      code: 'DOC_NOT_FOUND',
      details: { url: `${KB}sitemap-a.xml` },
    });
  });

  it('reports an index of empty files as an empty sitemap', async () => {
    const ctx = indexCtx();
    replaceResponses(ctx, loadCassette('cassettes', 'site', 'core', 'sitemap-index.json'), {
      [`${KB}sitemap-a.xml`]: { body: '<urlset/>' },
      [`${KB}sitemap-b.xml`]: { body: '<sitemapindex/>' },
      [`${KB}sitemap-c.xml`]: { body: '<urlset/>' },
    });
    await expect(readSitemap(ctx, bound(), SITEMAP)).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      details: { url: SITEMAP, retryable: false },
    });
  });

  it('reads several sitemaps and survives the loss of one', async () => {
    const two = makeSource('sitemap', { urls: [SITEMAP, `${KB}extra/sitemap.xml`, SITEMAP] });
    const ctx = ctxOf();
    ctx.http.on(`${KB}extra/sitemap.xml`, {
      body: `<urlset><url><loc>${KB}extra/one-more-article</loc></url></urlset>`,
    });
    const src = bindSource(makeProduct({ sources: [two] }), two, makeLine());
    expect(await sitemapAdapter.enumerate!(ctx, src)).toHaveLength(6);
    expect(ctx.http.count()).toBe(2);

    ctx.http.fail(SITEMAP, 503);
    const degraded = await sitemapAdapter.enumerate!(ctx, src);
    expect(degraded.map((record) => record.title)).toEqual(['One more article']);
  });

  it('is a typed failure when the filter leaves nothing', async () => {
    const none = makeSource('sitemap', { url: SITEMAP, include: ['^nothing-matches/'] });
    const src = bindSource(makeProduct({ sources: [none] }), none, makeLine());
    await expect(sitemapAdapter.enumerate!(ctxOf(), src)).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      details: { url: SITEMAP, retryable: false },
    });
  });

  it('is a typed failure for a source without a sitemap URL', async () => {
    const empty = makeSource('sitemap', {});
    const src = bindSource(makeProduct({ sources: [empty] }), empty, makeLine());
    await expect(sitemapAdapter.enumerate!(makeCtx(), src)).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
    });
  });

  it('rejects rather than list half a sitemap index when the budget runs out', async () => {
    const ctx = indexCtx();
    const src = bindSource(
      product,
      articles,
      makeLine(),
      undefined,
      newBudget(2, 60_000, ctx.clock),
    );
    await expect(sitemapAdapter.enumerate!(ctx, src)).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
    });
  });
});

describe('sitemap: read and probe', () => {
  it('reads a page with the kind its path classifies to', async () => {
    const ctx = ctxOf();
    const page = await sitemapAdapter.read(ctx, bound(), {
      url: new URL(`${KB}how-to-reset-a-widget-000010001#cause`),
    });
    expect(page).toMatchObject({
      kind: 'troubleshooting',
      ref: `${KB}how-to-reset-a-widget-000010001#cause`,
      source: 'articles',
    });
    expect(page.sections.length).toBeGreaterThan(0);
  });

  it('prefers the kind of the record that led to the read', async () => {
    const ctx = ctxOf();
    const [record] = await sitemapAdapter.enumerate!(ctx, bound());
    const page = await sitemapAdapter.read(ctx, bound(), {
      url: new URL(record!.ref),
      record: { ...record!, kind: 'release-notes' },
    });
    expect(page.kind).toBe('release-notes');
  });

  it('reads a URL outside its base as the fallback kind', async () => {
    const ctx = ctxOf();
    ctx.http.on('https://support.esri.com/en-us/other/page', {
      body: '<main><h1>Other</h1></main>',
    });
    const page = await sitemapAdapter.read(ctx, bound(), {
      url: new URL('https://support.esri.com/en-us/other/page'),
    });
    expect(page.kind).toBe('troubleshooting');
  });

  it('probes by counting sitemap entries', async () => {
    expect(await sitemapAdapter.probe(ctxOf(), bound())).toMatchObject({ ok: true, records: 6 });
  });
});
