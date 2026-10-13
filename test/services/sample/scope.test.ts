import { describe, expect, it } from 'vitest';
import { McpDocError } from '../../../src/core/errors.js';
import type { SamplesRequest } from '../../../src/core/ports.js';
import type { DocPage } from '../../../src/core/types.js';
import { makeDocPage } from '../../support/builders.js';
import { makeHarness, type Harness, type HarnessOptions } from '../support/harness.js';

const JS_SAMPLES = 'https://developers.arcgis.com/javascript/latest/sample-code';
const KT_SAMPLES = 'https://github.com/Esri/arcgis-maps-sdk-kotlin-samples/tree/v300.0.0/samples';

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

describe('find samples: scope', () => {
  it('reports the pinned tag of GitHub samples and their origin', async () => {
    const h = harness();
    h.adapter('github-repo').addPage(
      makeDocPage({
        url: `${KT_SAMPLES}/download-preplanned-map-area`,
        kind: 'sample',
        version: 'v300.0.0',
        license: 'apache-2.0',
        relevantApis: ['OfflineMapTask'],
      }),
    );
    const response = await find(h, { query: 'preplanned map area', product: 'kotlin-maps-sdk' });
    expect(response.scope).toEqual({
      product: 'kotlin-maps-sdk',
      line: 'latest',
      pinnedTo: 'v300.0.0',
    });
    expect(response.hits[0]).toMatchObject({ origin: 'github', relevantApis: ['OfflineMapTask'] });
  });

  it('narrows by platform and names the known platforms when none fits', async () => {
    const h = harness();
    const android = await find(h, {
      query: 'feature layers',
      product: 'kotlin-maps-sdk',
      platform: 'Android',
    });
    expect(android.scope.platform).toBe('Android');
    expect(android.hits.length).toBeGreaterThan(0);

    const none = await find(h, {
      query: 'feature layers',
      product: 'kotlin-maps-sdk',
      platform: 'maui',
    });
    expect(none.total).toBe(0);
    expect(none.notes).toContainEqual(
      'No sample of kotlin-maps-sdk is marked for platform "maui"; known platforms: android.',
    );
  });

  it('uses the SDK of the project, or the product the query names', async () => {
    const detected = harness({
      workspace: [
        {
          product: 'kotlin-maps-sdk',
          package: 'arcgis-maps-kotlin',
          version: '300.0.0',
          file: 'build.gradle.kts',
        },
      ],
    });
    expect((await find(detected, { query: 'offline' })).scope.product).toBe('kotlin-maps-sdk');
    const routed = harness();
    expect((await find(routed, { query: 'kotlin offline map area' })).scope.product).toBe(
      'kotlin-maps-sdk',
    );
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
    expect(none.notes[0]).toContain(
      'arcgis_docs_search({"query":"apply edits","product":"rest-api"})',
    );

    const empty = await find(h, { query: 'zebra crossing', product: 'js-maps-sdk' });
    expect(empty.total).toBe(0);
    expect(empty.notes.at(-1)).toContain('No sample matched.');
  });

  it('answers from the index alone when sample pages cannot be read, and says so', async () => {
    const h = harness();
    h.adapter('docc').failOn('sample', new TypeError('crash'));
    const response = await find(h, {
      query: 'cluster points',
      product: 'js-maps-sdk',
      withCode: true,
    });
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
