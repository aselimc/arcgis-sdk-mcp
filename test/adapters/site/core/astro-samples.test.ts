import { describe, expect, it } from 'vitest';
import {
  isSamplePath,
  parseSampleCards,
  readSampleCards,
} from '../../../../src/adapters/site/astro-samples.js';
import { astroAdapter } from '../../../../src/adapters/site/astro.js';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import type { CatalogRecord } from '../../../../src/core/types.js';
import { makeLine, makeProduct, makeSource } from '../../../support/builders.js';
import { loadCassette, readFixture } from '../../../support/fixtures.js';
import { makeCtx, type TestCtx } from '../../../support/make-ctx.js';
import { describeSiteAdapterContract, rendererOf, replaceResponses } from '../contract.js';

const BASE = 'https://developers.arcgis.com/widgets/';
const SITEMAP = `${BASE}sitemap-0.xml`;
const INDEX_PAGE = `${BASE}sample-code/`;

const samples = makeSource(
  'astro',
  {
    base: '/widgets/',
    sitemap: 'sitemap-0.xml',
    sampleIndexPage: 'sample-code/',
    include: ['^sample-code/'],
    exclude: ['/live/$', '^sample-code/$'],
  },
  {
    id: 'samples',
    title: 'Samples',
    kinds: ['sample'],
    floor: false,
    probe: { url: 'sample-code/', expect: 'html', mustContain: 'data-sample-id', minChars: 200 },
  },
);
const product = makeProduct({ sources: [samples] });
const cassette = () => loadCassette('cassettes', 'site', 'core', 'astro-samples.json');
const ctxOf = (): TestCtx => makeCtx({ cassette: cassette() });
const bound = () => bindSource(product, samples, makeLine());
const byRef = (records: CatalogRecord[]) => new Map(records.map((record) => [record.ref, record]));

describeSiteAdapterContract('astro samples (sitemap + sample index page)', () => ({
  adapter: astroAdapter,
  product,
  source: samples,
  ctx: ctxOf,
  allowedHosts: ['developers.arcgis.com'],
  minRecords: 4,
  readRef: `${BASE}sample-code/draw-circle/`,
  failures: {
    renamedField: {
      // The cards lose their data attribute: the sitemap still lists the sample pages.
      arrange: (ctx) =>
        replaceResponses(ctx, cassette(), {
          [INDEX_PAGE]: {
            body: '<main><a data-example="draw-circle" href="/widgets/sample-code/draw-circle/">Draw</a></main>',
          },
        }),
      outcome: 'degraded',
      minRecords: 2,
    },
    missingFile: {
      arrange: (ctx) => ctx.http.fail(SITEMAP, 404),
      outcome: 'degraded',
      minRecords: 3,
    },
    emptyIndex: {
      arrange: (ctx) =>
        replaceResponses(ctx, cassette(), {
          [SITEMAP]: { body: '<urlset></urlset>' },
          [INDEX_PAGE]: { body: '<main><h1>Sample code</h1></main>' },
        }),
      outcome: 'typed-failure',
      codes: ['UPSTREAM_UNAVAILABLE'],
    },
    htmlInsteadOfJson: { notApplicable: 'the source reads a sitemap and an HTML page, no JSON' },
  },
}));

describe('astro samples: cards', () => {
  const html = readFixture('cassettes', 'site', 'core', 'sample-index.html');

  it('reads id, title, keywords and the absolute link of every card', () => {
    expect(parseSampleCards(html, INDEX_PAGE)).toEqual([
      {
        id: 'draw-circle',
        title: 'Draw a circle',
        url: `${BASE}sample-code/draw-circle/`,
        keywords: ['2D', 'graphics', 'circle'],
      },
      {
        id: 'add-tile-layer',
        title: 'Add a tile layer',
        url: `${BASE}sample-code/add-tile-layer/`,
        keywords: ['layers', 'tiles'],
      },
      {
        id: 'untitled-card',
        title: 'Card without a title attribute',
        url: `${BASE}sample-code/untitled-card/`,
        keywords: [],
      },
      {
        id: 'elsewhere',
        title: 'A sample of another site',
        url: 'https://developers.arcgis.com/gadgets/sample-code/elsewhere/',
        keywords: [],
      },
    ]);
  });

  it('names a card after its slug when it has neither a title nor text', () => {
    const cards = parseSampleCards(
      '<a data-sample-id="spin-globe" href="spin-globe/"></a>',
      INDEX_PAGE,
    );
    expect(cards).toEqual([
      {
        id: 'spin-globe',
        title: 'Spin globe',
        url: `${BASE}sample-code/spin-globe/`,
        keywords: [],
      },
    ]);
  });

  it('skips a card whose link cannot be resolved', () => {
    expect(
      parseSampleCards('<a data-sample-id="x" href="https://[bad/">x</a>', INDEX_PAGE),
    ).toEqual([]);
  });

  it('turns cards of this source into sample records', async () => {
    const records = await readSampleCards(ctxOf(), bound(), 'sample-code/');
    expect(records.map((record) => record.ref)).toEqual([
      `${BASE}sample-code/draw-circle/`,
      `${BASE}sample-code/add-tile-layer/`,
      `${BASE}sample-code/untitled-card/`,
    ]);
    expect(records[0]).toMatchObject({
      kind: 'sample',
      title: 'Draw a circle',
      keywords: ['2D', 'graphics', 'circle'],
      locator: { sampleId: 'draw-circle' },
      product: 'widgets-sdk',
      source: 'samples',
    });
    expect(records[2]?.keywords).toBeUndefined();
  });

  it('recognises sample page paths, also below a platform directory', () => {
    expect(isSamplePath('sample-code/draw-circle/')).toBe(true);
    expect(isSamplePath('wpf/sample-code/draw-circle')).toBe(true);
    expect(isSamplePath('sample-code/')).toBe(false);
    expect(isSamplePath('sample-code/draw-circle/live/')).toBe(false);
    expect(isSamplePath('guide/sample-code-overview/')).toBe(false);
  });
});

describe('astro samples: enumerate and read', () => {
  it('uses the sitemap as the superset and the cards for titles and keywords', async () => {
    const ctx = ctxOf();
    const records = byRef(await astroAdapter.enumerate!(ctx, bound()));

    expect([...records.keys()].sort()).toEqual([
      `${BASE}sample-code/add-tile-layer/`,
      `${BASE}sample-code/draw-circle/`,
      `${BASE}sample-code/retired-sample/`,
      `${BASE}sample-code/untitled-card/`,
    ]);
    expect(records.get(`${BASE}sample-code/draw-circle/`)).toMatchObject({
      title: 'Draw a circle',
      keywords: ['2D', 'graphics', 'circle'],
    });
    // A sample the index page no longer lists keeps its sitemap entry and a slug title.
    expect(records.get(`${BASE}sample-code/retired-sample/`)).toMatchObject({
      kind: 'sample',
      title: 'Retired sample',
    });
    expect(ctx.http.count()).toBe(2);
  });

  it('still lists the cards when the sample index page is the only input left', async () => {
    const ctx = ctxOf();
    ctx.http.fail(SITEMAP, 503);
    const records = await astroAdapter.enumerate!(ctx, bound());
    expect(records).toHaveLength(3);
    expect(ctx.logger.messages('warn')).toEqual([
      'The sitemap is unavailable; continuing without it',
    ]);
  });

  it('reads the sample page as kind sample for the renderer to split description and source', async () => {
    const ctx = ctxOf();
    const [record] = await readSampleCards(ctx, bound(), 'sample-code/');
    const page = await astroAdapter.sample!(ctx, bound(), record!);

    expect(page).toMatchObject({ kind: 'sample', source: 'samples' });
    expect(rendererOf(ctx).calls.at(-1)).toMatchObject({ kind: 'html', meta: { kind: 'sample' } });
  });

  it('probes the index page for its card marker', async () => {
    expect(await astroAdapter.probe(ctxOf(), bound())).toMatchObject({
      ok: true,
      family: 'generic',
    });

    const ctx = ctxOf();
    replaceResponses(ctx, cassette(), {
      [INDEX_PAGE]: { body: `<main>${'x'.repeat(300)}</main>` },
    });
    expect(await astroAdapter.probe(ctx, bound())).toMatchObject({
      ok: false,
      error: 'The response does not contain "data-sample-id"',
    });
  });
});
