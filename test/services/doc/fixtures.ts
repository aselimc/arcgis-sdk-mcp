import { McpDocError } from '../../../src/core/errors.js';
import type { DocPage } from '../../../src/core/types.js';
import { makeDocPage } from '../../support/builders.js';
import { makeHarness, type Harness, type HarnessOptions } from '../support/harness.js';

/**
 * Pages and helpers shared by the document service tests: a guide, an API page with
 * members, a sample with two files, and a guide long enough to page.
 */

export const DEV = 'https://developers.arcgis.com';
export const JS = `${DEV}/javascript/latest`;
export const GUIDE_URL = `${JS}/clustering/`;
export const API_URL = `${JS}/references/core/layers/FeatureLayer/`;
export const SAMPLE_URL = `${JS}/sample-code/editing-applyedits/`;

export const GUIDE_MD = [
  '# Cluster points',
  '',
  'Clusters group nearby points.',
  '',
  '## Enable clustering',
  '',
  'Set the feature reduction of the layer.',
  '',
  '```js',
  'layer.featureReduction = { type: "cluster" };',
  '```',
  '',
  '## Cluster popups',
  '',
  'Describe the cluster in a popup.',
].join('\n');

export const guidePage = (overrides: Partial<DocPage> = {}): DocPage =>
  makeDocPage({ url: GUIDE_URL, markdown: GUIDE_MD, product: 'js-maps-sdk', ...overrides });

export const apiPage = (): DocPage =>
  makeDocPage({
    url: API_URL,
    kind: 'api',
    product: 'js-maps-sdk',
    source: 'core',
    header: 'import FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";',
    markdown: [
      '# FeatureLayer',
      '',
      'A layer of features.',
      '',
      '## Methods',
      '',
      '### queryFeatures',
      '',
      'Runs a query.',
      '',
      '### applyEdits',
      '',
      'Sends edits.',
    ].join('\n'),
    members: [
      { id: 'queryfeatures', name: 'queryFeatures', kind: 'method' },
      { id: 'applyedits', name: 'applyEdits', kind: 'method' },
    ],
  });

export const samplePage = (): DocPage =>
  makeDocPage({
    url: SAMPLE_URL,
    kind: 'sample',
    product: 'js-maps-sdk',
    source: 'samples',
    markdown: '# Apply edits sample\n\nAdds and deletes features.',
    relevantApis: ['FeatureLayer.applyEdits'],
    files: [
      {
        name: 'index.html',
        language: 'html',
        text: '<script>layer.applyEdits(edits)</script>',
        ref: `${SAMPLE_URL}live/`,
        bytes: 40,
      },
      {
        name: 'style.css',
        language: 'css',
        text: 'body { margin: 0 }',
        ref: `${SAMPLE_URL}style.css`,
        bytes: 18,
      },
    ],
  });

/** Six sections of about 250 tokens each: several pages at the smallest tool budget. */
export const LONG_MD = [
  '# Long guide',
  '',
  'Opening words.',
  ...Array.from({ length: 6 }, (_, i) => `\n## Part ${i}\n\n${`part${i} words `.repeat(70)}`),
].join('\n');

export const longPage = (markdown = LONG_MD): DocPage =>
  makeDocPage({ url: GUIDE_URL, markdown, product: 'js-maps-sdk' });

export function harness(options: HarnessOptions = {}): Harness {
  const h = makeHarness(options);
  h.adapter('gatsby').addPage(guidePage());
  h.adapter('astro').addPage(apiPage());
  h.adapter('docc').addPage(samplePage());
  return h;
}

export const read = (
  h: Harness,
  request: {
    ref: string;
    section?: string;
    view?: 'auto' | 'outline' | 'full';
    maxTokens?: number;
    cursor?: string;
  },
) => h.services.docs.read({ view: 'auto', maxTokens: 6000, ...request }, h.call());

export const unavailable = new McpDocError(
  'UPSTREAM_UNAVAILABLE',
  'developers.arcgis.com is not responding',
  {
    why: 'timeout',
    url: GUIDE_URL,
    host: 'developers.arcgis.com',
    retryable: true,
  },
);
