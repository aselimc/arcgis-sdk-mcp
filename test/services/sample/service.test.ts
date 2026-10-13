import { describe, expect, it } from 'vitest';
import { McpDocError } from '../../../src/core/errors.js';
import type { SamplesRequest } from '../../../src/core/ports.js';
import type { DocPage } from '../../../src/core/types.js';
import {
  confirmsApi,
  fitCode,
  matchesPlatform,
  mentionsApi,
  parseApi,
} from '../../../src/services/sample/rank.js';
import { MAX_METADATA_FETCHES } from '../../../src/services/sample/service.js';
import { makeDocPage, makeProduct, makeRecord, makeSource } from '../../support/builders.js';
import { makeHarness, type Harness, type HarnessOptions } from '../support/harness.js';

const JS_SAMPLES = 'https://developers.arcgis.com/javascript/latest/sample-code';
const KT_SAMPLES = 'https://github.com/Esri/arcgis-maps-sdk-kotlin-samples/tree/v300.0.0/samples';

const samplePage = (slug: string, overrides: Partial<DocPage> & { code?: string } = {}): DocPage => {
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
    .addPage(samplePage('featurereduction-cluster', { relevantApis: ['FeatureLayer', 'FeatureReductionCluster'] }))
    .addPage(samplePage('editing-applyedits', { relevantApis: ['FeatureLayer.applyEdits'], code: 'layer.applyEdits({ addFeatures });' }))
    .addPage(samplePage('layers-scenelayer', { relevantApis: ['SceneLayer'] }))
    .addPage(samplePage('widgets-legacy', { code: 'const layer = new FeatureLayer(); layer.applyEdits(edits);' }));
  return h;
}

const find = (h: Harness, request: Partial<SamplesRequest> & { query: string }) =>
  h.services.samples.find({ withCode: false, limit: 5, maxTokens: 4000, ...request }, h.call());

describe('sample rank helpers', () => {
  it('parses uses_api into its names', () => {
    expect(parseApi('FeatureLayer.applyEdits()')).toEqual({ full: 'FeatureLayer.applyEdits', simple: 'applyEdits', type: 'FeatureLayer' });
    expect(parseApi('OGC3DTilesLayer')).toEqual({ full: 'OGC3DTilesLayer', simple: 'OGC3DTilesLayer' });
    expect(parseApi('()')).toBeUndefined();
    expect(parseApi(undefined)).toBeUndefined();
  });

  it('checks whether a record names an API', () => {
    const record = makeRecord({ title: 'Edit sample', description: 'Uses applyEdits on a FeatureLayer.', keywords: ['editing'] });
    expect(mentionsApi(record, { full: 'FeatureLayer.applyEdits', simple: 'applyEdits', type: 'FeatureLayer' })).toBe(true);
    expect(mentionsApi(record, { full: 'applyEdits', simple: 'applyEdits' })).toBe(true);
    expect(mentionsApi(record, { full: 'SceneLayer.applyEdits', simple: 'applyEdits', type: 'SceneLayer' })).toBe(false);
    expect(mentionsApi(makeRecord(), { full: 'X', simple: 'X' })).toBe(false);
  });

  it('confirms from metadata or from the main source file', () => {
    const member = { full: 'FeatureLayer.applyEdits', simple: 'applyEdits', type: 'FeatureLayer' };
    const type = { full: 'FeatureLayer', simple: 'FeatureLayer' };
    expect(confirmsApi(makeDocPage({ relevantApis: ['FeatureLayer.applyEdits'] }), member)).toBe(true);
    expect(confirmsApi(makeDocPage({ relevantApis: ['featurelayer.applyedits'] }), member)).toBe(true);
    expect(confirmsApi(makeDocPage({ relevantApis: ['FeatureLayer'] }), member)).toBe(false);
    expect(confirmsApi(makeDocPage({ relevantApis: ['FeatureLayer'] }), type)).toBe(true);
    expect(confirmsApi(makeDocPage({ relevantApis: ['SceneLayer.applyEdits'] }), member)).toBe(false);
    expect(confirmsApi(makeDocPage({ relevantApis: ['SceneLayer.applyEdits'] }), { full: 'applyEdits', simple: 'applyEdits' })).toBe(true);

    const withCode = (text: string): DocPage =>
      makeDocPage({ files: [{ name: 'a.js', language: 'js', text, ref: 'r', bytes: 1 }] });
    expect(confirmsApi(withCode('const l = new FeatureLayer(); l.applyEdits(e)'), member)).toBe(true);
    expect(confirmsApi(withCode('table.applyEdits(e)'), member)).toBe(false);
    expect(confirmsApi(withCode('layer.applyEditsLater(e)'), { full: 'applyEdits', simple: 'applyEdits' })).toBe(false);
    expect(confirmsApi(makeDocPage(), type)).toBe(false);
  });

  it('matches platforms by field or by path', () => {
    expect(matchesPlatform(makeRecord({ platform: 'MAUI' }), 'maui')).toBe(true);
    expect(matchesPlatform(makeRecord({ platform: 'wpf, winui' }), 'winui')).toBe(true);
    expect(matchesPlatform(makeRecord({ platform: 'wpf' }), 'maui')).toBe(false);
    expect(matchesPlatform(makeRecord({ ref: 'https://github.com/Esri/x/tree/main/src/MAUI/Sample' }), 'maui')).toBe(true);
    expect(matchesPlatform(makeRecord({ ref: 'https://github.com/Esri/x/tree/main/src/WPF/Sample' }), 'maui')).toBe(false);
    expect(matchesPlatform(makeRecord(), ' ')).toBe(true);
  });

  it('cuts code at a line boundary', () => {
    expect(fitCode('a\nb', 100)).toEqual({ text: 'a\nb', truncated: false });
    const long = Array.from({ length: 200 }, (_, i) => `const value${i} = ${i};`).join('\n');
    const cut = fitCode(long, 100);
    expect(cut.truncated).toBe(true);
    expect(cut.text.length).toBeLessThanOrEqual(350);
    expect(long.startsWith(`${cut.text}\n`)).toBe(true);
    expect(fitCode('x'.repeat(2000), 10)).toEqual({ text: 'x'.repeat(35), truncated: true });
  });
});

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
    expect(all.hits.find((hit) => hit.record.ref.endsWith('/widgets-legacy/'))?.legacyPattern).toBe(true);
    expect(all.hits[0]?.legacyPattern).toBeUndefined();
  });

  it('returns the main source file of the top hit with with_code, within the budget', async () => {
    const h = harness();
    const response = await find(h, { query: 'apply edits', product: 'js-maps-sdk', withCode: true });
    expect(response.code).toEqual({
      ref: `${JS_SAMPLES}/editing-applyedits/live/`,
      file: 'index.html',
      language: 'html',
      text: 'layer.applyEdits({ addFeatures });',
      truncated: false,
    });

    h.adapter('docc').addPage(samplePage('editing-applyedits', { code: Array.from({ length: 800 }, (_, i) => `line ${i};`).join('\n') }));
    const cut = await find(h, { query: 'apply edits', product: 'js-maps-sdk', withCode: true, maxTokens: 500, limit: 1 });
    expect(cut.code?.truncated).toBe(true);
    expect(cut.code?.text.length).toBeLessThan(1400);
  });

  it('falls back to the first sentence of the page for a summary', async () => {
    const product = makeProduct({ sources: [makeSource('docc', { base: '/widgets/samples/' }, { id: 'samples', kinds: ['sample'] })] });
    const ref = 'https://developers.arcgis.com/widgets/samples/spin/';
    const h = makeHarness({ products: [product], records: [makeRecord({ ref, source: 'samples', kind: 'sample', title: 'Spin a widget' })] });
    h.adapter('docc').addPage(makeDocPage({ url: ref, markdown: '# Spin a widget\n\nRotates the widget on click. More detail follows.' }));
    const response = await find(h, { query: 'spin', product: 'widgets-sdk' });
    expect(response.hits[0]?.summary).toBe('Rotates the widget on click.');
  });
});

describe('find samples: uses_api', () => {
  it('puts confirmed samples first and marks unconfirmed mentions', async () => {
    const h = harness();
    const response = await find(h, { query: 'edit features', product: 'js-maps-sdk', usesApi: 'FeatureLayer.applyEdits' });
    expect(response.hits.map((hit) => [hit.record.ref.split('/').at(-2), hit.apiConfirmed])).toEqual([
      ['editing-applyedits', true],
      ['widgets-legacy', true],
    ]);
    expect(response.total).toBe(2);
  });

  it('confirms through metadata for samples whose text does not name the API', async () => {
    const h = harness();
    const response = await find(h, { query: 'cluster', product: 'js-maps-sdk', usesApi: 'FeatureReductionCluster' });
    expect(response.hits.map((hit) => [hit.record.ref.split('/').at(-2), hit.apiConfirmed])).toEqual([
      ['featurereduction-cluster', true],
    ]);
  });

  it('lists samples that only mention the API after confirmed ones, as unconfirmed', async () => {
    const h = harness();
    // The metadata of the mentioned sample cannot be read: it stays, unconfirmed.
    h.adapter('docc').failOn('sample', new McpDocError('UPSTREAM_UNAVAILABLE', 'github is not responding'), 1);
    const response = await find(h, { query: 'edit features', product: 'js-maps-sdk', usesApi: 'FeatureLayer.applyEdits' });
    expect(response.hits.map((hit) => [hit.record.ref.split('/').at(-2), hit.apiConfirmed])).toEqual([
      ['widgets-legacy', true],
      ['editing-applyedits', false],
    ]);
    expect(response.notes).toContainEqual(expect.stringMatching(/^degraded: metadata of 1 sample\(s\) could not be read \(UPSTREAM_UNAVAILABLE/));
  });

  it('says when nothing uses the API, or nothing could be confirmed', async () => {
    const h = harness();
    const none = await find(h, { query: 'cluster', product: 'js-maps-sdk', usesApi: 'ImageryTileLayer' });
    expect(none).toMatchObject({ total: 0, hits: [] });
    expect(none.notes).toContainEqual(expect.stringContaining('No sample of js-maps-sdk was found that uses ImageryTileLayer'));

    h.adapter('docc').failOn('sample', new McpDocError('UPSTREAM_UNAVAILABLE', 'down'));
    const unconfirmed = await find(h, { query: 'edits', product: 'js-maps-sdk', usesApi: 'applyEdits' });
    expect(unconfirmed.hits.map((hit) => hit.apiConfirmed)).toEqual([false]);
    expect(unconfirmed.notes).toContainEqual('No sample was confirmed to use applyEdits; the hits only mention it.');
  });

  it('fetches metadata for at most ten candidates and stops when the budget is spent', async () => {
    const product = makeProduct({ sources: [makeSource('docc', { base: '/widgets/samples/' }, { id: 'samples', kinds: ['sample'] })] });
    const records = Array.from({ length: 25 }, (_, i) =>
      makeRecord({ ref: `https://developers.arcgis.com/widgets/samples/s${i}/`, source: 'samples', kind: 'sample', title: `Widget sample ${i}` }),
    );
    const h = makeHarness({ products: [product], records });
    for (const record of records) h.adapter('docc').addPage(makeDocPage({ url: record.ref, relevantApis: ['Widget'] }));

    await find(h, { query: 'widget sample', product: 'widgets-sdk', usesApi: 'Widget', limit: 10 });
    expect(h.adapter('docc').count('sample')).toBe(MAX_METADATA_FETCHES);

    const call = h.call();
    call.budget.used = call.budget.maxRequests;
    const starved = await h.services.samples.find({ query: 'widget sample', product: 'widgets-sdk', withCode: true, limit: 3, maxTokens: 4000 }, call);
    expect(h.adapter('docc').count('sample')).toBe(MAX_METADATA_FETCHES);
    expect(starved.hits).toHaveLength(3);
    expect(starved.hits[0]?.relevantApis).toBeUndefined();
    expect(starved.notes).toContainEqual(expect.stringContaining('The source of the top hit is not available here'));
  });
});

describe('find samples: scope', () => {
  it('reports the pinned tag of GitHub samples and their origin', async () => {
    const h = harness();
    h.adapter('github-repo').addPage(
      makeDocPage({ url: `${KT_SAMPLES}/download-preplanned-map-area`, kind: 'sample', version: 'v300.0.0', license: 'apache-2.0', relevantApis: ['OfflineMapTask'] }),
    );
    const response = await find(h, { query: 'preplanned map area', product: 'kotlin-maps-sdk' });
    expect(response.scope).toEqual({ product: 'kotlin-maps-sdk', line: 'latest', pinnedTo: 'v300.0.0' });
    expect(response.hits[0]).toMatchObject({ origin: 'github', relevantApis: ['OfflineMapTask'] });
  });

  it('narrows by platform and names the known platforms when none fits', async () => {
    const h = harness();
    const android = await find(h, { query: 'feature layers', product: 'kotlin-maps-sdk', platform: 'Android' });
    expect(android.scope.platform).toBe('Android');
    expect(android.hits.length).toBeGreaterThan(0);

    const none = await find(h, { query: 'feature layers', product: 'kotlin-maps-sdk', platform: 'maui' });
    expect(none.total).toBe(0);
    expect(none.notes).toContainEqual('No sample of kotlin-maps-sdk is marked for platform "maui"; known platforms: android.');
  });

  it('uses the SDK of the project, or the product the query names', async () => {
    const detected = harness({ workspace: [{ product: 'kotlin-maps-sdk', package: 'arcgis-maps-kotlin', version: '300.0.0', file: 'build.gradle.kts' }] });
    expect((await find(detected, { query: 'offline' })).scope.product).toBe('kotlin-maps-sdk');
    const routed = harness();
    expect((await find(routed, { query: 'kotlin offline map area' })).scope.product).toBe('kotlin-maps-sdk');
  });

  it('raises UNKNOWN_PRODUCT when no product can be determined', async () => {
    const h = harness();
    await expect(find(h, { query: 'zzzz qqqq' })).rejects.toMatchObject({
      code: 'UNKNOWN_PRODUCT',
      details: { next: 'arcgis_docs_list_products({"query":"zzzz qqqq"})' },
    });
  });

  it('points to search for a product without samples, and for a query without hits', async () => {
    const h = harness();
    const none = await find(h, { query: 'apply edits', product: 'rest-api' });
    expect(none).toMatchObject({ total: 0, hits: [] });
    expect(none.notes[0]).toContain('rest-api has no sample source');
    expect(none.notes[0]).toContain('arcgis_docs_search({"query":"apply edits","product":"rest-api"})');

    const empty = await find(h, { query: 'zebra crossing', product: 'js-maps-sdk' });
    expect(empty.total).toBe(0);
    expect(empty.notes.at(-1)).toContain('No sample matched.');
  });

  it('answers from the index alone when sample pages cannot be read, and says so', async () => {
    const h = harness();
    h.adapter('docc').failOn('sample', new TypeError('crash'));
    const response = await find(h, { query: 'cluster points', product: 'js-maps-sdk', withCode: true });
    expect(response.hits[0]?.record.ref).toBe(`${JS_SAMPLES}/featurereduction-cluster/`);
    expect(response.hits[0]?.files).toBeUndefined();
    expect(response.notes).toContainEqual(expect.stringContaining('internal error'));
    expect(response.code).toBeUndefined();
  });

  it('reports a degraded sample index', async () => {
    const h = harness();
    h.adapter('docc').failOn('enumerate', new McpDocError('UPSTREAM_UNAVAILABLE', 'down'));
    const response = await find(h, { query: 'cluster', product: 'js-maps-sdk' });
    expect(response.total).toBe(0);
    expect(response.notes[0]).toMatch(/^degraded: js-maps-sdk\/samples has no index/);
  });

  it('does not read samples of a source whose adapter has no sample method or whose capability is off', async () => {
    const noSample = harness({ adapters: { docc: { noSample: true } } });
    const response = await find(noSample, { query: 'cluster points', product: 'js-maps-sdk' });
    expect(response.hits[0]?.summary).toContain('Clusters earthquake points');
    expect(response.hits[0]?.relevantApis).toBeUndefined();

    const off = harness({ enabled: ['website', 'site-index'] });
    const kotlin = await find(off, { query: 'feature layers', product: 'kotlin-maps-sdk' });
    expect(kotlin.total).toBe(0);
    expect(off.adapter('github-repo').count()).toBe(0);
  });
});
