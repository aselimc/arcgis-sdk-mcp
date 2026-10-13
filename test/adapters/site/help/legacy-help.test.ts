import { describe, expect, it } from 'vitest';
import { legacyHelpAdapter } from '../../../../src/adapters/site/legacy-help.js';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import { newBudget } from '../../../../src/core/async.js';
import { makeLine, makeProduct, makeSource } from '../../../support/builders.js';
import { readFixture } from '../../../support/fixtures.js';
import { makeCtx } from '../../../support/make-ctx.js';
import { describeSiteAdapterContract, replaceResponses } from '../contract.js';
import {
  API,
  API_SCRIPT,
  BASE,
  HOST,
  START,
  START_SCRIPT,
  bound,
  cassette,
  ctxOf,
  help,
  product,
  urls,
  withoutSiteIndex,
} from './legacy-setup.js';

describeSiteAdapterContract('legacy-help', () => ({
  adapter: legacyHelpAdapter,
  product,
  source: help,
  ctx: ctxOf,
  allowedHosts: ['doc.arcgis.com'],
  minRecords: 10,
  readRef: `${START}what-is-widget-earth.htm`,
  siteIndexFiles: [/\/\d+\.js$/],
  failures: {
    renamedField: {
      // Nodes without `label` and `url` name no topic; the link list answers instead.
      arrange: (ctx) =>
        replaceResponses(ctx, cassette(), {
          [API_SCRIPT]: {
            body: readFixture('cassettes', 'site', 'help', 'legacy-4101.js')
              .replaceAll('"label"', '"title"')
              .replaceAll('"url"', '"href"'),
          },
        }),
      outcome: 'degraded',
      minRecords: 10,
    },
    missingFile: {
      arrange: (ctx) => ctx.http.fail(/widget-earth/, 404),
      outcome: 'typed-failure',
      codes: ['DOC_NOT_FOUND'],
    },
    emptyIndex: {
      arrange: (ctx) => ctx.http.fail(API_SCRIPT, 'empty'),
      outcome: 'degraded',
      minRecords: 10,
    },
    htmlInsteadOfJson: {
      // The host's catch-all page arrives where the script was asked for.
      arrange: (ctx) => ctx.http.fail(API_SCRIPT, 'html'),
      outcome: 'degraded',
      minRecords: 10,
    },
  },
}));

describe('legacy-help: enumerate', () => {
  it('lists a book from its named script: titles, headings, reading order', async () => {
    const ctx = ctxOf();
    const records = await legacyHelpAdapter.enumerate!(ctx, bound());

    expect(
      records
        .filter((record) => record.ref.startsWith(API))
        .map((record) => [record.ref.slice(API.length), record.title, record.breadcrumb]),
    ).toEqual([
      ['get-started.htm', 'Get started with the Automation API', 'Automation > Overview'],
      ['release-notes.htm', 'Release notes & known limits', 'Automation > Overview'],
      ['camera.htm', 'Camera {requests}', 'Automation > API reference'],
      ['get-camera.htm', 'Get Camera', 'Automation > API reference > Camera {requests}'],
      // The script spells the release number and a fragment; the ref is the book's own URL.
      ['set-camera.htm', 'Set Camera', 'Automation > API reference'],
      ['add-layer.htm', 'Add Layer', 'Automation > API reference'],
      ['samples.htm', 'Samples', 'Automation'],
    ]);
    expect(records[0]).toEqual({
      ref: `${API}get-started.htm`,
      product: 'widget-earth',
      source: 'help',
      line: 'latest',
      kind: 'help',
      title: 'Get started with the Automation API',
      breadcrumb: 'Automation > Overview',
      license: 'esri-website-terms',
    });
  });

  it('finds the script of a book without a named one from a topic page', async () => {
    const ctx = ctxOf();
    const records = await legacyHelpAdapter.enumerate!(ctx, bound());

    expect(
      records
        .filter((record) => record.ref.startsWith(START))
        .map((record) => [record.ref.slice(START.length), record.title, record.breadcrumb]),
    ).toEqual([
      ['what-is-widget-earth.htm', 'What is Widget Earth?', 'Get started > Essentials'],
      ['install.htm', 'Install Widget Earth', 'Get started > Essentials'],
      // A live topic the script omits keeps its place at the end, titled from its slug.
      ['faq.htm', 'Faq', 'Get started'],
    ]);
    expect(urls(ctx)).toEqual([
      '/en/widget-earth/3.1/automation/4101.js',
      '/en/widget-earth/latest/get-started/flisting.htm',
      '/en/widget-earth/latest/get-started/what-is-widget-earth.htm',
      // Of the two numbered scripts on the page, the one in the book's directory.
      '/en/widget-earth/3.1/get-started/4102.js',
    ]);
  });

  it('lists from the link lists alone while site-index is off', async () => {
    const ctx = withoutSiteIndex(ctxOf());
    const records = await legacyHelpAdapter.enumerate!(ctx, bound());

    expect(records.map((record) => [record.title, record.breadcrumb])).toEqual([
      ['Get started', 'Automation'],
      ['Release notes', 'Automation'],
      ['Camera', 'Automation'],
      ['Get Camera', 'Automation'],
      ['Set Camera', 'Automation'],
      ['Add Layer', 'Automation'],
      ['Samples', 'Automation'],
      ['What is widget earth', 'Get started'],
      ['Install', 'Get started'],
      ['Faq', 'Get started'],
    ]);
    expect(urls(ctx)).toEqual([
      '/en/widget-earth/latest/automation/flisting.htm',
      '/en/widget-earth/latest/get-started/flisting.htm',
    ]);
  });

  it('rediscovers a script whose name has changed', async () => {
    const ctx = ctxOf();
    const renamed = `${HOST}/en/widget-earth/3.2/automation/4177.js`;
    replaceResponses(ctx, cassette(), {
      [API_SCRIPT]: { status: 404 },
      [`${API}get-started.htm`]: {
        body: '<html><head><script src="/en/widget-earth/3.2/automation/4177.js"></script></head><body><main>Topic</main></body></html>',
      },
      [renamed]: { body: readFixture('cassettes', 'site', 'help', 'legacy-4101.js') },
    });
    const records = await legacyHelpAdapter.enumerate!(ctx, bound());

    expect(records.find((record) => record.ref === `${API}get-camera.htm`)?.breadcrumb).toBe(
      'Automation > API reference > Camera {requests}',
    );
    expect(urls(ctx).slice(0, 4)).toEqual([
      '/en/widget-earth/3.1/automation/4101.js',
      '/en/widget-earth/latest/automation/flisting.htm',
      '/en/widget-earth/latest/automation/get-started.htm',
      '/en/widget-earth/3.2/automation/4177.js',
    ]);
    expect(ctx.http.count()).toBeLessThanOrEqual(legacyHelpAdapter.maxEnumerateRequests);
  });

  it('does not request a failed script a second time when the page names the same one', async () => {
    const ctx = ctxOf();
    ctx.http.fail(API_SCRIPT, 503);
    const records = await legacyHelpAdapter.enumerate!(ctx, bound());
    expect(records.filter((record) => record.ref.startsWith(API))).toHaveLength(7);
    expect(ctx.http.count(API_SCRIPT)).toBe(1);
  });

  it('uses the book sitemap when the link list is gone, then looks for the script', async () => {
    const ctx = ctxOf();
    ctx.http.fail(`${START}flisting.htm`, 404);
    const records = await legacyHelpAdapter.enumerate!(ctx, bound());

    expect(
      records.filter((record) => record.ref.startsWith(START)).map((record) => record.title),
    ).toEqual(['What is Widget Earth?', 'Install Widget Earth']);
    expect(urls(ctx).slice(1)).toEqual([
      '/en/widget-earth/latest/get-started/flisting.htm',
      '/en/widget-earth/latest/get-started/sitemap.xml',
      '/en/widget-earth/latest/get-started/install.htm',
      '/en/widget-earth/3.1/get-started/4102.js',
    ]);
  });

  it('titles sitemap topics from their slugs and keeps only those of the book', async () => {
    const ctx = withoutSiteIndex(ctxOf());
    ctx.http.fail(/flisting\.htm$/, 'html');
    const records = await legacyHelpAdapter.enumerate!(ctx, bound());
    expect(records.map((record) => [record.ref.slice(BASE.length), record.title])).toEqual([
      ['automation/add-layer.htm', 'Add layer'],
      ['automation/get-camera.htm', 'Get camera'],
      // Listed with a plain-http URL; refs are always https.
      ['automation/set-camera.htm', 'Set camera'],
      ['get-started/install.htm', 'Install'],
      ['get-started/what-is-widget-earth.htm', 'What is widget earth'],
    ]);
  });

  it('keeps the link list when the topic page names no script or the script is unreadable', async () => {
    const noScript = ctxOf();
    replaceResponses(noScript, cassette(), {
      [`${START}what-is-widget-earth.htm`]: {
        body: '<html><body><main>Topic</main></body></html>',
      },
    });
    const first = await legacyHelpAdapter.enumerate!(noScript, bound());
    expect(
      first.filter((record) => record.ref.startsWith(START)).map((record) => record.title),
    ).toEqual(['What is widget earth', 'Install', 'Faq']);
    expect(noScript.http.count()).toBe(3);

    const broken = ctxOf();
    broken.http.fail(START_SCRIPT, 'truncated');
    broken.http.fail(`${START}what-is-widget-earth.htm`, 503, { times: 0 });
    const second = await legacyHelpAdapter.enumerate!(broken, bound());
    expect(second.filter((record) => record.ref.startsWith(START))).toHaveLength(3);
  });

  it('lists the remaining books when one book is unavailable', async () => {
    const ctx = ctxOf();
    ctx.http.fail(/get-started\/(?:flisting\.htm|sitemap\.xml)$/, 404);
    const records = await legacyHelpAdapter.enumerate!(ctx, bound());
    expect(records).toHaveLength(7);
    expect(ctx.logger.messages('warn')).toContain(
      `Book ${START} is unavailable; enumerating without it`,
    );
  });

  it('fails with the first error when no book can be listed', async () => {
    const ctx = ctxOf();
    ctx.http.fail(/.*/, 503);
    await expect(legacyHelpAdapter.enumerate!(ctx, bound())).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      details: { url: API_SCRIPT, retryable: true },
    });
  });

  it('expands the version line into the book directory and the script path', async () => {
    const versioned = makeSource('legacy-help', {
      host: 'pro.arcgis.com',
      base: '/en/widget-app/{line}/',
      books: [
        { path: '/tool-reference/', tocScript: '/en/widget-app/{line}/tool-reference/77.js' },
      ],
      lines: ['3.6', '3.5'],
      enumerate: 'on-demand',
    });
    const src = bindSource(
      makeProduct({ sources: [versioned] }),
      versioned,
      makeLine({ id: '3.6' }),
    );
    const ctx = makeCtx();
    ctx.http.on('https://pro.arcgis.com/en/widget-app/3.6/tool-reference/77.js', {
      body: [
        'treedata.data["77_1"] = { "label": "Buffer", "url": "/en/widget-app/3.6/tool-reference/analysis/buffer.htm" };',
        // Another release of the same book is not this line's page.
        'treedata.data["77_2"] = { "label": "Old", "url": "/en/widget-app/3.5/tool-reference/analysis/old.htm" };',
        'treedata.data["77_3"] = { "label": "Away", "url": "https://example.com/en/widget-app/3.6/tool-reference/x.htm" };',
        'treedata.data["77_4"] = { "label": "Bad", "url": "http://[" };',
      ].join('\n'),
    });
    const records = await legacyHelpAdapter.enumerate!(ctx, src);
    expect(records.map((record) => [record.ref, record.line, record.breadcrumb])).toEqual([
      [
        'https://pro.arcgis.com/en/widget-app/3.6/tool-reference/analysis/buffer.htm',
        '3.6',
        undefined,
      ],
    ]);
  });

  it('is a typed failure for a source without books', async () => {
    const empty = makeSource('legacy-help', {
      host: 'doc.arcgis.com',
      base: '/en/none/',
      books: [],
    });
    const src = bindSource(makeProduct({ sources: [empty] }), empty, makeLine());
    await expect(legacyHelpAdapter.enumerate!(makeCtx(), src)).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      details: { why: 'The source names no book', url: 'https://doc.arcgis.com/en/none/' },
    });
  });

  it('stops at its request allowance when a source has more books than it covers', async () => {
    const books = Array.from({ length: 30 }, (_, index) => ({
      path: `book-${index}`,
      tocScript: `/en/many/book-${index}/${index + 1}.js`,
    }));
    const many = makeSource('legacy-help', { host: 'doc.arcgis.com', base: '/en/many/', books });
    const src = bindSource(makeProduct({ sources: [many] }), many, makeLine());
    const ctx = makeCtx();
    ctx.http.fail(/.*/, 404);
    await expect(legacyHelpAdapter.enumerate!(ctx, src)).rejects.toMatchObject({
      code: 'DOC_NOT_FOUND',
    });
    // Script, link list and sitemap for 28 books.
    expect(ctx.http.count()).toBe(legacyHelpAdapter.maxEnumerateRequests);
    expect(ctx.logger.messages('warn')).toContain(
      'The source has more books than one enumeration may request',
    );
  });

  it('rejects rather than list part of a source when the request budget runs out', async () => {
    const ctx = ctxOf();
    const src = bindSource(product, help, makeLine(), undefined, newBudget(1, 60_000, ctx.clock));
    await expect(legacyHelpAdapter.enumerate!(ctx, src)).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
    });
    expect(ctx.http.count()).toBe(2);
  });

  it('does not list a link-only line', async () => {
    const ctx = ctxOf();
    const src = bindSource(product, help, makeLine({ access: 'link-only' }));
    await expect(legacyHelpAdapter.enumerate!(ctx, src)).rejects.toMatchObject({
      code: 'LINK_ONLY',
      details: { url: BASE },
    });
    expect(ctx.http.count()).toBe(0);
  });
});
