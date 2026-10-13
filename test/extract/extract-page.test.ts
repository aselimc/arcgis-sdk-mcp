import { describe, expect, it } from 'vitest';
import type { CreateHtmlExtractor } from '../../src/core/factories.js';
import type { RenderMeta } from '../../src/core/ports.js';
import { createHtmlExtractor, detectFamily, detectMetaRefresh } from '../../src/extract/index.js';
import { makeResponse } from '../support/builders.js';
import {
  caseOf,
  extractFixture,
  extractHtml,
  fixtureHtml,
  metaFor,
  pageMarkdown,
  sharedExtractor,
} from './support.js';

describe('createHtmlExtractor', () => {
  it('has the factory signature of the core contracts', () => {
    const factory: CreateHtmlExtractor = createHtmlExtractor;
    const extractor = factory();
    expect(extractor.detectFamily).toBe(detectFamily);
    expect(extractor.detectMetaRefresh).toBe(detectMetaRefresh);
  });

  it('is stateless between calls', () => {
    const first = extractFixture('gatsby-rest');
    extractFixture('astro-js-ref');
    expect(extractFixture('gatsby-rest')).toEqual({
      ...first,
      diagnostics: expect.anything() as unknown,
    });
  });
});

describe('provenance and diagnostics', () => {
  const { url, kind } = caseOf('astro');

  it('takes the provenance fields from the render metadata', () => {
    const meta: RenderMeta = {
      url: `${url}#steps`,
      kind,
      license: 'esri-website-terms',
      product: 'harbor-sdk',
      source: 'guide',
      line: 'latest',
      version: '2.1',
      res: makeResponse({
        url,
        cache: 'revalidated',
        fetchedAt: '2026-10-13T08:00:00.000Z',
        aliasChain: ['https://docs.example.com/harbor/latest/tutorials/old-name/'],
      }),
    };
    const page = sharedExtractor().extract({ html: fixtureHtml('astro') }, meta);
    expect(page).toMatchObject({
      ref: `${url}#steps`,
      url,
      kind: 'tutorial',
      product: 'harbor-sdk',
      source: 'guide',
      line: 'latest',
      version: '2.1',
      license: 'esri-website-terms',
      retrievedAt: '2026-10-13T08:00:00.000Z',
      cache: 'revalidated',
      redirectedFrom: ['https://docs.example.com/harbor/latest/tutorials/old-name/'],
      notices: [],
    });
    expect(page.attribution).toContain(url);
    expect(page.diagnostics.redirectHops).toBe(1);
  });

  it('resolves links against the URL without its fragment', () => {
    const page = sharedExtractor().extract(
      { html: fixtureHtml('astro') },
      metaFor(`${url}#steps`, kind),
    );
    expect(pageMarkdown(page)).toContain(
      '(https://docs.example.com/harbor/latest/tutorials/animate-tides/)',
    );
  });

  it('counts fences, table strategies and unknown islands', () => {
    expect(extractFixture('astro').diagnostics).toMatchObject({
      family: 'astro',
      renderer: 'html',
      fences: 1,
      fencesWithLanguage: 1,
      tablesByStrategy: {},
      unknownIslands: ['PricingCalculator'],
      leftoverHtmlTags: 0,
      redirectHops: 0,
    });
    expect(extractFixture('gatsby-rest').diagnostics.tablesByStrategy).toEqual({
      gfm: 1,
      definition: 1,
      records: 1,
    });
    expect(extractFixture('qdoc').diagnostics.tablesByStrategy).toEqual({ 'key-value': 1 });
    expect(extractFixture('astro').diagnostics.ms).toBeGreaterThanOrEqual(0);
  });
});

describe('fallback to the generic extractor', () => {
  const article = `<article><h1>Harbour notes</h1><p>${'Tide tables are published every morning. '.repeat(8)}</p><h2 id="more">More</h2><p>See the pier office.</p></article>`;

  it('converts a page of no known family and says so', () => {
    const page = extractHtml(
      `<html><head><title>Notes | Site</title></head><body><header><nav><a href="/">Home</a></nav></header>${article}<footer>Contact us</footer></body></html>`,
    );
    expect(page.diagnostics.family).toBe('generic');
    expect(page.degraded).toEqual({
      level: 'generic-extractor',
      reason: 'No known page family matched; converted with the generic extractor.',
    });
    expect(page.title).toBe('Harbour notes');
    expect(page.sections.map((section) => section.id)).toEqual(['harbour-notes', 'more']);
    expect(pageMarkdown(page)).not.toContain('Contact us');
    expect(pageMarkdown(page)).not.toContain('Home');
  });

  // Regression: notebook pages of the Python guide, whose body is a fragment taken out of
  // page-data, were labelled "degraded" although the generic profile was asked for.
  it('does not call it a fallback when the caller asked for the generic profile', () => {
    const page = createHtmlExtractor().extract(
      { html: `<html><body><main>${article}</main></body></html>`, familyHint: 'generic' },
      metaFor('https://docs.example.com/notes/'),
    );
    expect(page.diagnostics.family).toBe('generic');
    expect(page.degraded).toBeUndefined();
    expect(page.title).toBe('Harbour notes');
  });

  it('takes the title from <title> when the page has no h1, and prefers the richest container', () => {
    const page = extractHtml(
      `<html><head><title> Pier  office </title></head><body><main><p>short</p></main><div role="main"><p>${'The pier office opens at six. '.repeat(10)}</p></div></body></html>`,
    );
    expect(page.title).toBe('Pier office');
    expect(pageMarkdown(page)).toContain('# Pier office\n\nThe pier office opens at six.');
    expect(pageMarkdown(page)).not.toContain('short');
  });

  it('returns an empty page for an empty document', () => {
    const page = extractHtml('');
    expect(page.sections).toEqual([]);
    expect(page.title).toBe('');
    expect(page.degraded?.level).toBe('generic-extractor');
  });

  it('falls back when a hinted or detected family has no content root', () => {
    const page = sharedExtractor().extract(
      { html: `<html><body>${article}</body></html>`, familyHint: 'dokka' },
      metaFor('https://docs.example.com/x/'),
    );
    expect(page.diagnostics.family).toBe('generic');
    expect(page.degraded?.reason).toBe(
      'Page layout drift: the page has no dokka content root; converted with the generic extractor.',
    );
    expect(page.title).toBe('Harbour notes');
  });

  it('falls back when a profile yields almost nothing from a large page', () => {
    // The Astro shell is there, but the content moved out of the root the profile knows.
    const html = `<html><head><title>Moved</title><link href="/_astro/a.css"></head><body><main id="main"><header class="page-header"><h1 class="page-title">Moved</h1></header><div id="skip-to-content" class="page-content"><p>Loading</p></div><section class="new-layout"><h2 id="real">Real content</h2><p>${'This paragraph lives outside the old content root. '.repeat(500)}</p></section></main></body></html>`;
    expect(html.length).toBeGreaterThan(20_000);
    const page = extractHtml(html);
    expect(page.diagnostics.family).toBe('generic');
    expect(page.degraded?.reason).toMatch(
      /^Page layout drift: the astro profile produced \d+ characters from \d+ bytes of HTML; converted with the generic extractor\.$/,
    );
    expect(page.sections.map((section) => section.id)).toContain('real');
  });

  it('does not treat a short page or a small slice as drift', () => {
    const short = extractHtml(
      '<html><head><link href="/_astro/a.css"></head><body><main id="main"><header class="page-header"><h1 class="page-title">Tiny</h1></header><div id="skip-to-content" class="page-content"><p>One line.</p></div></main></body></html>',
    );
    expect(short.diagnostics.family).toBe('astro');
    expect(short.degraded).toBeUndefined();

    const padded = fixtureHtml('astro').replace(
      '</body>',
      `<script>${'/* padding */'.repeat(2000)}</script></body>`,
    );
    const slice = sharedExtractor().extract({ html: padded }, metaFor(caseOf('astro').url), {
      select: { section: 'whats-next' },
    });
    expect(slice.diagnostics.family).toBe('astro');
    expect(slice.degraded).toBeUndefined();
    expect(pageMarkdown(slice).length).toBeLessThan(200);
  });
});
