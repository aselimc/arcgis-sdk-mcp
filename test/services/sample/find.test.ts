import { describe, expect, it } from 'vitest';
import { McpDocError } from '../../../src/core/errors.js';
import type { SamplesRequest } from '../../../src/core/ports.js';
import type { CatalogRecord, DocPage } from '../../../src/core/types.js';
import { MAX_METADATA_FETCHES } from '../../../src/services/sample/service.js';
import { makeDocPage, makeProduct, makeRecord, makeSource } from '../../support/builders.js';
import { makeHarness, type Harness, type HarnessOptions } from '../support/harness.js';

const JS_SAMPLES = 'https://developers.arcgis.com/javascript/latest/sample-code';
const samplePage = (
  slug: string,
  overrides: Partial<DocPage> & { code?: string } = {},
): DocPage => {
  const { code = 'const view = new MapView();', ...rest } = overrides;
  const url = `${JS_SAMPLES}/${slug}/`;
  return makeDocPage({
    url,
    kind: 'sample',
    product: 'js-maps-sdk',
    source: 'samples',
    markdown: `# ${slug}\n\nThis sample shows ${slug}. It has a second sentence.`,
    files: [
      { name: 'index.html', language: 'html', text: code, ref: `${url}live/`, bytes: code.length },
      { name: 'style.css', language: 'css', text: 'body{}', ref: `${url}style.css`, bytes: 6 },
    ],
    ...rest,
  });
};

function harness(options: HarnessOptions = {}): Harness {
  const h = makeHarness(options);
  h.adapter('docc')
    .addPage(
      samplePage('featurereduction-cluster', {
        relevantApis: ['FeatureLayer', 'FeatureReductionCluster'],
      }),
    )
    .addPage(
      samplePage('editing-applyedits', {
        relevantApis: ['FeatureLayer.applyEdits'],
        code: 'layer.applyEdits({ addFeatures });',
      }),
    )
    .addPage(samplePage('layers-scenelayer', { relevantApis: ['SceneLayer'] }))
    .addPage(
      samplePage('widgets-legacy', {
        code: 'const layer = new FeatureLayer(); layer.applyEdits(edits);',
      }),
    );
  return h;
}

const find = (h: Harness, request: Partial<SamplesRequest> & { query: string }) =>
  h.services.samples.find({ withCode: false, limit: 5, maxTokens: 4000, ...request }, h.call());

describe('find samples', () => {
  it('ranks samples for a task and loads their metadata', async () => {
    const h = harness();
    const response = await find(h, { query: 'cluster points', product: 'js-maps-sdk' });
    expect(response.scope).toEqual({ product: 'js-maps-sdk', line: 'latest' });
    expect(response.hits[0]).toMatchObject({
      record: { ref: `${JS_SAMPLES}/featurereduction-cluster/` },
      summary: 'Clusters earthquake points and shows a popup for each cluster.',
      relevantApis: ['FeatureLayer', 'FeatureReductionCluster'],
      files: [
        { name: 'index.html', ref: `${JS_SAMPLES}/featurereduction-cluster/live/`, bytes: 27 },
        { name: 'style.css', ref: `${JS_SAMPLES}/featurereduction-cluster/style.css`, bytes: 6 },
      ],
      origin: 'esri-site',
    });
    expect(response.hits[0]).not.toHaveProperty('apiConfirmed');
    expect(response.code).toBeUndefined();
    expect(response.total).toBe(response.hits.length);
  });

  it('only searches sample sources and returns only samples', async () => {
    const h = harness();
    const response = await find(h, { query: 'feature', product: 'js-maps-sdk', limit: 10 });
    expect(new Set(response.hits.map((hit) => hit.record.kind))).toEqual(new Set(['sample']));
    expect(h.adapter('gatsby').count('enumerate')).toBe(0);
    expect(h.adapter('docc').count('enumerate')).toBe(1);
  });

  it('marks legacy patterns and respects the limit while reporting the total', async () => {
    const h = harness();
    const response = await find(h, { query: 'editing features', product: 'js-maps-sdk', limit: 1 });
    expect(response.hits).toHaveLength(1);
    expect(response.total).toBeGreaterThan(1);
    const all = await find(h, { query: 'editing features', product: 'js-maps-sdk', limit: 10 });
    expect(all.hits.find((hit) => hit.record.ref.endsWith('/widgets-legacy/'))?.legacyPattern).toBe(
      true,
    );
    expect(all.hits[0]?.legacyPattern).toBeUndefined();
  });

  it('returns the main source file of the top hit with with_code, within the budget', async () => {
    const h = harness();
    const response = await find(h, {
      query: 'apply edits',
      product: 'js-maps-sdk',
      withCode: true,
    });
    expect(response.code).toEqual({
      ref: `${JS_SAMPLES}/editing-applyedits/live/`,
      file: 'index.html',
      language: 'html',
      text: 'layer.applyEdits({ addFeatures });',
      truncated: false,
    });

    h.adapter('docc').addPage(
      samplePage('editing-applyedits', {
        code: Array.from({ length: 800 }, (_, i) => `line ${i};`).join('\n'),
      }),
    );
    const cut = await find(h, {
      query: 'apply edits',
      product: 'js-maps-sdk',
      withCode: true,
      maxTokens: 500,
      limit: 1,
    });
    expect(cut.code?.truncated).toBe(true);
    expect(cut.code?.text.length).toBeLessThan(1400);
  });

  it('falls back to the first sentence of the page for a summary', async () => {
    const product = makeProduct({
      sources: [
        makeSource('docc', { base: '/widgets/samples/' }, { id: 'samples', kinds: ['sample'] }),
      ],
    });
    const ref = 'https://developers.arcgis.com/widgets/samples/spin/';
    const h = makeHarness({
      products: [product],
      records: [makeRecord({ ref, source: 'samples', kind: 'sample', title: 'Spin a widget' })],
    });
    h.adapter('docc').addPage(
      makeDocPage({
        url: ref,
        markdown: '# Spin a widget\n\nRotates the widget on click. More detail follows.',
      }),
    );
    const response = await find(h, { query: 'spin', product: 'widgets-sdk' });
    expect(response.hits[0]?.summary).toBe('Rotates the widget on click.');
  });

  // Regression: sample pages that open with a notice were summarised by the notice
  // ("> **Warning:** > > This sample uses legacy programming patterns."), links included.
  it('summarises a page by its first paragraph of prose, as plain text', async () => {
    const product = makeProduct({
      sources: [
        makeSource('docc', { base: '/widgets/samples/' }, { id: 'samples', kinds: ['sample'] }),
      ],
    });
    const ref = 'https://developers.arcgis.com/widgets/samples/spin/';
    const h = makeHarness({
      products: [product],
      records: [makeRecord({ ref, source: 'samples', kind: 'sample', title: 'Spin a widget' })],
    });
    h.adapter('docc').addPage(
      makeDocPage({
        url: ref,
        markdown: [
          '# Spin a widget',
          '> **Warning:**\n>\n> This sample uses an old pattern.',
          '![Screenshot](https://developers.arcgis.com/widgets/spin.png)',
          'Rotates a [widget](https://developers.arcgis.com/widgets/api/widget/) when its **handle** is clicked. More follows.',
        ].join('\n\n'),
      }),
    );
    const response = await find(h, { query: 'spin', product: 'widgets-sdk' });
    expect(response.hits[0]?.summary).toBe('Rotates a widget when its handle is clicked.');
  });
});

describe('find samples: uses_api', () => {
  it('puts confirmed samples first and marks unconfirmed mentions', async () => {
    const h = harness();
    const response = await find(h, {
      query: 'edit features',
      product: 'js-maps-sdk',
      usesApi: 'FeatureLayer.applyEdits',
    });
    expect(
      response.hits.map((hit) => [hit.record.ref.split('/').at(-2), hit.apiConfirmed]),
    ).toEqual([
      ['editing-applyedits', true],
      ['widgets-legacy', true],
    ]);
    expect(response.total).toBe(2);
  });

  it('confirms through metadata for samples whose text does not name the API', async () => {
    const h = harness();
    const response = await find(h, {
      query: 'cluster',
      product: 'js-maps-sdk',
      usesApi: 'FeatureReductionCluster',
    });
    expect(
      response.hits.map((hit) => [hit.record.ref.split('/').at(-2), hit.apiConfirmed]),
    ).toEqual([['featurereduction-cluster', true]]);
  });

  it('lists samples that only mention the API after confirmed ones, as unconfirmed', async () => {
    const h = harness();
    // The metadata of the mentioned sample cannot be read: it stays, unconfirmed.
    h.adapter('docc').failOn(
      'sample',
      new McpDocError('UPSTREAM_UNAVAILABLE', 'github is not responding'),
      1,
    );
    const response = await find(h, {
      query: 'edit features',
      product: 'js-maps-sdk',
      usesApi: 'FeatureLayer.applyEdits',
    });
    expect(
      response.hits.map((hit) => [hit.record.ref.split('/').at(-2), hit.apiConfirmed]),
    ).toEqual([
      ['widgets-legacy', true],
      ['editing-applyedits', false],
    ]);
    expect(response.notes).toContainEqual(
      expect.stringMatching(
        /^degraded: metadata of 1 sample\(s\) could not be read \(UPSTREAM_UNAVAILABLE/,
      ),
    );
  });

  it('says when nothing uses the API, or nothing could be confirmed', async () => {
    const h = harness();
    const none = await find(h, {
      query: 'cluster',
      product: 'js-maps-sdk',
      usesApi: 'ImageryTileLayer',
    });
    expect(none).toMatchObject({ total: 0, hits: [] });
    // The note says what was checked and gives the way back to the unfiltered list.
    expect(none.notes).toContainEqual(
      expect.stringContaining('No sample of js-maps-sdk was found that uses ImageryTileLayer'),
    );
    expect(none.notes.join('\n')).toContain(
      'arcgis_docs_find_samples({"query":"cluster","product":"js-maps-sdk"})',
    );

    h.adapter('docc').failOn('sample', new McpDocError('UPSTREAM_UNAVAILABLE', 'down'));
    const unconfirmed = await find(h, {
      query: 'edits',
      product: 'js-maps-sdk',
      usesApi: 'applyEdits',
    });
    expect(unconfirmed.hits.length).toBeGreaterThan(0);
    expect(unconfirmed.hits.every((hit) => hit.apiConfirmed === false)).toBe(true);
    expect(unconfirmed.notes).toContainEqual(
      'No sample was confirmed to use applyEdits: the hits match the query or mention the API, and their use of it is not verified.',
    );
  });

  // Regression (README workflow): "point clustering" with uses_api "FeatureLayer" dropped
  // "Intro to clustering", whose code uses the class, because ten samples that name
  // FeatureLayer in their title were checked first and query hits beyond them were left out.
  it('checks the best matches for the task first and keeps unchecked ones as unverified', async () => {
    const product = makeProduct({
      sources: [
        makeSource('docc', { base: '/widgets/samples/' }, { id: 'samples', kinds: ['sample'] }),
      ],
    });
    const base = 'https://developers.arcgis.com/widgets/samples';
    const naming = Array.from({ length: 12 }, (_, i) =>
      makeRecord({
        ref: `${base}/tide-layer-${i}/`,
        source: 'samples',
        kind: 'sample',
        title: `TideLayer option ${i}`,
      }),
    );
    const wanted = makeRecord({
      ref: `${base}/intro-to-grouping/`,
      source: 'samples',
      kind: 'sample',
      title: 'Intro to grouping',
      description: 'Group gauges that are close together.',
    });
    const h = makeHarness({ products: [product], records: [...naming, wanted] });
    const page = (record: CatalogRecord, code: string): DocPage => ({
      ...makeDocPage({ url: record.ref, kind: 'sample', markdown: `# ${record.title}\n\nText.` }),
      files: [{ name: 'main.js', language: 'js', text: code, ref: `${record.ref}main.js`, bytes: 1 }],
    });
    h.adapter('docc').addPage(page(wanted, 'const layer = new TideLayer({ grouping: true });'));
    for (const record of naming) h.adapter('docc').addPage(page(record, 'new TideLayer();'));

    const response = await find(h, {
      query: 'grouping gauges',
      product: 'widgets-sdk',
      usesApi: 'TideLayer',
      limit: 20,
    });
    expect(response.hits[0]?.record.ref).toBe(wanted.ref);
    expect(response.hits[0]?.apiConfirmed).toBe(true);
    // Twelve more name the API; nine were checked, three were not and say so.
    expect(response.hits.filter((hit) => hit.apiConfirmed === true)).toHaveLength(10);
    expect(response.hits.filter((hit) => hit.apiConfirmed === false)).toHaveLength(3);
    expect(response.notes.join('\n')).toContain('the others were not checked');
  });

  it('fetches metadata for at most ten candidates and stops when the budget is spent', async () => {
    const product = makeProduct({
      sources: [
        makeSource('docc', { base: '/widgets/samples/' }, { id: 'samples', kinds: ['sample'] }),
      ],
    });
    const records = Array.from({ length: 25 }, (_, i) =>
      makeRecord({
        ref: `https://developers.arcgis.com/widgets/samples/s${i}/`,
        source: 'samples',
        kind: 'sample',
        title: `Widget sample ${i}`,
      }),
    );
    const h = makeHarness({ products: [product], records });
    for (const record of records)
      h.adapter('docc').addPage(makeDocPage({ url: record.ref, relevantApis: ['Widget'] }));

    await find(h, { query: 'widget sample', product: 'widgets-sdk', usesApi: 'Widget', limit: 10 });
    expect(h.adapter('docc').count('sample')).toBe(MAX_METADATA_FETCHES);

    const call = h.call();
    call.budget.used = call.budget.maxRequests;
    const starved = await h.services.samples.find(
      { query: 'widget sample', product: 'widgets-sdk', withCode: true, limit: 3, maxTokens: 4000 },
      call,
    );
    expect(h.adapter('docc').count('sample')).toBe(MAX_METADATA_FETCHES);
    expect(starved.hits).toHaveLength(3);
    expect(starved.hits[0]?.relevantApis).toBeUndefined();
    expect(starved.notes).toContainEqual(
      expect.stringContaining('The source of the top hit is not available here'),
    );
  });
});
