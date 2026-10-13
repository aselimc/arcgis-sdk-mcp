/**
 * The invented catalogue behind the MCP surface tests: three products, one brief and the
 * refs whose behaviour the scripted services key on.
 */
import { encodeCursor } from '../../../src/core/cursor.js';
import type { Product } from '../../../src/core/types.js';
import { makeLine, makeProduct, makeSource } from '../../support/builders.js';
import type { Brief } from '../../support/fake-registry.js';

/** Root of the invented JavaScript SDK documentation. */
export const JS = 'https://developers.arcgis.com/javascript/latest';

/** A product shaped like a real SDK entry: three sources, two lines, a package and a repo. */
export const JS_PRODUCT: Product = makeProduct({
  id: 'js-maps-sdk',
  name: 'Maps SDK for JavaScript (test)',
  aliases: ['javascript', '@arcgis/core'],
  summary: 'Invented stand-in for a web mapping SDK.',
  homepage: `${JS}/`,
  packages: [{ registry: 'npm', name: '@arcgis/core', license: 'esri-ma', primary: true }],
  repos: [
    { repo: 'Esri/jsapi-resources', role: 'samples', license: 'apache-2.0', defaultBranch: 'main' },
  ],
  lines: [
    makeLine({ id: 'latest', label: '5.x' }),
    makeLine({ id: '4.x', label: '4.x', current: false, access: 'link-only' }),
  ],
  sources: [
    makeSource('astro', { base: '/javascript/latest/' }, { id: 'guide', pagesApprox: 120 }),
    makeSource(
      'astro',
      { base: '/javascript/latest/', include: ['^references/'] },
      { id: 'references', title: 'API reference', kinds: ['api'] },
    ),
    makeSource(
      'astro',
      { base: '/javascript/latest/', include: ['^sample-code/'] },
      { id: 'samples', title: 'Samples', kinds: ['sample'], capability: 'site-search' },
    ),
    makeSource(
      'npm-dts',
      { package: '@arcgis/core', docUrl: `${JS}/references/core/{module}/` },
      {
        id: 'typings',
        title: 'Typings',
        kinds: ['api'],
        capability: 'package-cdn',
        license: 'esri-ma',
      },
    ),
    makeSource(
      'brief',
      { slugs: ['js/4x-to-5x'] },
      { id: 'briefs', title: 'Briefs', kinds: ['brief'] },
    ),
  ],
  releaseNotes: { current: `${JS}/release-notes/` },
  startHere: [{ title: 'Get started', ref: `${JS}/get-started/` }],
  pitfalls: ['Widgets are replaced by components in 5.x.'],
  related: ['widgets-sdk'],
});

/** A retired product with a successor, hidden unless `include_legacy` is set. */
export const LEGACY_PRODUCT: Product = makeProduct({
  id: 'old-viewer',
  name: 'Old Viewer (test)',
  aliases: [],
  category: 'native',
  status: 'retired',
  statusNote: 'Retired in 2024; use widgets-sdk.',
  successor: 'widgets-sdk',
  summary: 'Invented retired product.',
});

/** The products of the test registry. */
export const PRODUCTS: Product[] = [JS_PRODUCT, makeProduct(), LEGACY_PRODUCT];

/** The briefs of the test registry. */
export const BRIEFS: Brief[] = [
  {
    slug: 'ai/overview',
    title: 'AI overview (test)',
    verifiedOn: '2026-10-01',
    sources: [`${JS}/ai/`],
    markdown: '# AI overview\n\nInvented brief text.',
  },
];

/** Refs with scripted behaviour in {@link makeFakeServices}. */
export const REFS = {
  page: `${JS}/get-started/`,
  long: `${JS}/long-page/`,
  missing: `${JS}/gone-page/`,
  crash: `${JS}/crash/`,
  degraded: `${JS}/degraded/`,
} as const;

/** A well-formed cursor of `tool` at `offset`, as the real services would issue. */
export function testCursor(tool: string, offset: number): string {
  return encodeCursor({ v: 1, t: tool, k: 'k', e: 'e', o: offset });
}
