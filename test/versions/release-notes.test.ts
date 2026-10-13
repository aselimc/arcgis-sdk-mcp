import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../src/registry/index.js';
import {
  expandReleaseNotesPattern,
  isTemplatePattern,
  locateReleaseNotes,
  pagesByPattern,
} from '../../src/versions/release-notes.js';
import {
  readProductSitemap,
  readSitemapUrls,
  versionedPages,
  defaultSitemapUrl,
} from '../../src/versions/sitemap-versions.js';
import { SITES } from './cassettes-sites.js';
import { LINE_200, dotnetProduct, jsProduct, pythonProduct } from './products.js';
import { makeProduct } from '../support/builders.js';
import { makeCall, makeCtx } from '../support/make-ctx.js';

const D = 'https://developers.arcgis.com';
const sites = () => makeCtx({ cassette: SITES });

describe('release-notes patterns', () => {
  it('tells a URL template from a regular expression', () => {
    expect(isTemplatePattern(`${D}/arcgis-urban-api/release-notes/{version}/`)).toBe(true);
    expect(isTemplatePattern('/release-notes-for-(\\d+-\\d+)/$')).toBe(false);
    expect(isTemplatePattern('/changelogs/(\\d{1,3}\\.\\d+)/$')).toBe(false);
  });

  it('fills version placeholders and line variables of a template', () => {
    expect(
      expandReleaseNotesPattern(
        '/net/{prefix}release-notes/release-notes-for-{major}-{minor}/',
        '200.8.3',
        LINE_200,
      ),
    ).toBe(`${D}/net/v200/release-notes/release-notes-for-200-8/`);
    expect(
      expandReleaseNotesPattern('/x/{version}/{dashed}/{compact}/{patch}/', 'v2.4', undefined),
    ).toBe(`${D}/x/v2.4/2-4/24/0/`);
  });

  it('reads the version slug captured by a regular expression', () => {
    const pages = pagesByPattern(
      [
        `${D}/python/latest/guide/release-notes-243/`,
        `${D}/python/latest/guide/release-notes-244/`,
        `${D}/python/latest/guide/overview244/`,
      ],
      /\/guide\/release-notes-(\d+)\/$/,
    );
    expect(pages).toEqual([
      { version: '2.4.4', url: `${D}/python/latest/guide/release-notes-244/` },
      { version: '2.4.3', url: `${D}/python/latest/guide/release-notes-243/` },
    ]);
  });

  it('finds the JavaScript release pages, which are named by the version alone after 4.10', () => {
    const config = createRegistry().get('js-maps-sdk')?.releaseNotes;
    const filter = new RegExp(config?.sitemapFilter ?? '^$');
    const urls = [
      `${D}/javascript/latest/release-notes/`,
      `${D}/javascript/latest/release-notes/4.9/`,
      `${D}/javascript/latest/release-notes/4.10/`,
      `${D}/javascript/latest/4.33/`,
      `${D}/javascript/latest/4.34/`,
      `${D}/javascript/latest/references/core/views/2d/`,
      `${D}/javascript/latest/breaking-changes/`,
    ].filter((url) => filter.test(url));
    expect(pagesByPattern(urls, new RegExp(config?.pattern ?? '^$'))).toEqual([
      { version: '4.34', url: `${D}/javascript/latest/4.34/` },
      { version: '4.33', url: `${D}/javascript/latest/4.33/` },
      { version: '4.10', url: `${D}/javascript/latest/release-notes/4.10/` },
      { version: '4.9', url: `${D}/javascript/latest/release-notes/4.9/` },
    ]);
  });

  it('prefers the v<major>-<minor> JavaScript page over its dotted redirect stub and finds 5.0', () => {
    const config = createRegistry().get('js-maps-sdk')?.releaseNotes;
    const filter = new RegExp(config?.sitemapFilter ?? '^$');
    const urls = [
      `${D}/javascript/latest/4.24/`,
      `${D}/javascript/latest/4.34/`,
      `${D}/javascript/latest/v4-34/`,
      `${D}/javascript/latest/v5-0/`,
      `${D}/javascript/latest/vector-tiles-v2-0/`,
    ].filter((url) => filter.test(url));
    expect(pagesByPattern(urls, new RegExp(config?.pattern ?? '^$'))).toEqual([
      { version: '5.0', url: `${D}/javascript/latest/v5-0/` },
      { version: '4.34', url: `${D}/javascript/latest/v4-34/` },
      { version: '4.24', url: `${D}/javascript/latest/4.24/` },
    ]);
  });

  it('keeps the first URL of a version and sorts newest first', () => {
    const urls = [
      `${D}/x/release-notes/release-notes-for-300-0/`,
      `${D}/x/release-notes/release-notes-for-300-1/`,
      `${D}/x/release-notes/prior-releases/release-notes-for-300-1/`,
      `${D}/x/guide/unrelated-2-0/`,
    ];
    expect(versionedPages(urls, /release-notes/)).toEqual([
      { version: '300.1', url: urls[1] },
      { version: '300.0', url: urls[0] },
    ]);
  });
});

describe('sitemap reading', () => {
  it('derives the sitemap of a line from the home page', () => {
    expect(defaultSitemapUrl(dotnetProduct, undefined)).toBe(`${D}/net/sitemap-0.xml`);
    expect(defaultSitemapUrl(dotnetProduct, LINE_200)).toBe(`${D}/net/v200/sitemap-0.xml`);
  });

  it('follows a sitemap index and counts every request against the budget', async () => {
    const ctx = sites();
    const call = makeCall(ctx);
    const urls = await readSitemapUrls(ctx, `${D}/indexed/sitemap-0.xml`, call);
    expect(urls).toEqual([`${D}/indexed/release-notes/release-notes-2-4-0/`]);
    expect(call.budget.used).toBe(2);
  });

  it('looks for the sitemap at the host root when a site outside developers.arcgis.com has none beside its entry page', async () => {
    const ctx = makeCtx();
    const product = makeProduct({ homepage: 'https://location.arcgis.com/help/' });
    ctx.http
      .on('https://location.arcgis.com/help/sitemap-0.xml', { status: 404 })
      .on('https://location.arcgis.com/sitemap-0.xml', {
        body: '<urlset><url><loc>https://location.arcgis.com/help/release-notes/2026-07/</loc></url></urlset>',
      });
    expect(await readProductSitemap(ctx, product, undefined, undefined)).toEqual([
      'https://location.arcgis.com/help/release-notes/2026-07/',
    ]);

    // On developers.arcgis.com the root sitemap belongs to the whole site: no second try.
    const developers = makeCtx();
    developers.http.on(/./, { status: 404 });
    await expect(
      readProductSitemap(developers, dotnetProduct, undefined, undefined),
    ).rejects.toMatchObject({ code: 'DOC_NOT_FOUND' });
    expect(developers.http.count()).toBe(1);
  });
});

describe('locateReleaseNotes', () => {
  it('returns the current page first and older versions from the sitemap', async () => {
    const ctx = sites();
    const { refs, notices } = await locateReleaseNotes(ctx, dotnetProduct, { current: '300.1' });
    expect(notices).toEqual([]);
    expect(refs).toEqual([
      // The stub stands for 300.1; the sitemap page of 300.1 is not listed a second time.
      { version: '300.1', ref: `${D}/net/release-notes/` },
      { version: '300.0', ref: `${D}/net/release-notes/prior-releases/release-notes-for-300-0/` },
      { version: '200.8', ref: `${D}/net/release-notes/prior-releases/release-notes-for-200-8/` },
    ]);
  });

  it('puts the requested version first', async () => {
    const ctx = sites();
    const { refs } = await locateReleaseNotes(ctx, dotnetProduct, {
      version: '300.0.2',
      current: '300.1',
    });
    expect(refs[0]).toEqual({
      version: '300.0.2',
      ref: `${D}/net/release-notes/prior-releases/release-notes-for-300-0/`,
    });
    expect(refs).toHaveLength(3);
  });

  it('reads compact slugs through the product pattern', async () => {
    const ctx = sites();
    const { refs } = await locateReleaseNotes(ctx, pythonProduct, { current: '2.4.4' });
    expect(refs.map((ref) => ref.version)).toEqual(['2.4.4', '2.4.3', '1.0.0']);
  });

  it('builds the page of a requested version from a template without any request', async () => {
    const ctx = makeCtx({ config: { capabilities: new Set(['registries'] as const) } });
    const product = makeProduct({
      releaseNotes: { pattern: `${D}/arcgis-urban-api/release-notes/{version}/` },
    });
    const { refs } = await locateReleaseNotes(ctx, product, { version: '2026-07-21' });
    expect(refs).toEqual([
      { version: '2026-07-21', ref: `${D}/arcgis-urban-api/release-notes/2026-07-21/` },
    ]);
    expect(ctx.http.count()).toBe(0);
  });

  it('labels the current page "current" when no version is known, without listing anything', async () => {
    const ctx = sites();
    const { refs } = await locateReleaseNotes(ctx, jsProduct, {});
    expect(refs).toEqual([{ version: 'current', ref: `${D}/javascript/latest/release-notes/` }]);
    expect(ctx.http.count()).toBe(0);
  });

  it('still returns the current page when the sitemap cannot be read', async () => {
    const ctx = sites();
    ctx.http.fail(/sitemap-0\.xml$/, 'timeout');
    const { refs, notices } = await locateReleaseNotes(ctx, dotnetProduct, { current: '300.1' });
    expect(refs).toEqual([{ version: '300.1', ref: `${D}/net/release-notes/` }]);
    expect(notices).toEqual([
      'Per-version release notes could not be listed (UPSTREAM_UNAVAILABLE).',
    ]);
  });

  it('returns nothing for a product without release-notes configuration', async () => {
    expect(await locateReleaseNotes(makeCtx(), makeProduct(), {})).toEqual({
      refs: [],
      notices: [],
    });
  });
});
