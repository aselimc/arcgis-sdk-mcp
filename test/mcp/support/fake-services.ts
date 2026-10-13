/**
 * A scripted `Services` for the MCP surface tests. It answers from a small invented
 * catalogue and fails on a few magic inputs, so every presenter and error path can be
 * exercised without the real services, adapters or network.
 */
import { formatCall } from '../../../src/core/budget.js';
import { encodeCursor } from '../../../src/core/cursor.js';
import { McpDocError } from '../../../src/core/errors.js';
import { TOOLS } from '../../../src/core/names.js';
import type { Ctx, Services } from '../../../src/core/ports.js';
import type { Product } from '../../../src/core/types.js';
import {
  makeDocPage,
  makeHit,
  makeLine,
  makeProduct,
  makeRecord,
  makeSource,
} from '../../support/builders.js';
import type { Brief } from '../../support/fake-registry.js';

const JS = 'https://developers.arcgis.com/javascript/latest';

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

function cursor(tool: string, offset: number): string {
  return encodeCursor({ v: 1, t: tool, k: 'k', e: 'e', o: offset });
}

/**
 * Builds the scripted services.
 *
 * Magic inputs: search query `nothing` has no hits and `many` has a second page; ref
 * {@link REFS.missing} is `DOC_NOT_FOUND`, {@link REFS.crash} throws a plain `Error`,
 * {@link REFS.long} is truncated; symbol `Graphic` is ambiguous and `Nope` is not found;
 * product `python-api` reports no version facts.
 */
export function makeFakeServices(ctx: Ctx): Services {
  const { registry } = ctx;
  return {
    catalog: {
      list({ query, category, includeLegacy, limit, cursor: from }) {
        const matching = registry
          .all()
          .filter((product) => includeLegacy || product.status !== 'retired')
          .filter(
            (product) =>
              category === undefined || category === 'all' || product.category === category,
          )
          .filter(
            (product) => query === undefined || `${product.id} ${product.name}`.includes(query),
          );
        const start = from === undefined ? 0 : 1;
        const products = matching.slice(start, start + limit);
        return {
          products,
          total: matching.length,
          ...(start + limit < matching.length
            ? { nextCursor: cursor(TOOLS.listProducts, start + limit) }
            : {}),
        };
      },
      profile(input) {
        return {
          resolution: registry.resolve(input),
          health: {
            guide: { state: 'ok', records: 118 },
            references: { state: 'degraded' },
            samples: { state: 'disabled' },
          },
        };
      },
      async toc(input, section, from) {
        const { product } = registry.resolve(input);
        const entries = [
          makeRecord({
            product: product.id,
            source: section,
            title: 'Layers',
            ref: `${JS}/layers/`,
          }),
          makeRecord({
            product: product.id,
            source: section,
            title: 'Feature layers',
            ref: `${JS}/layers/feature-layers/`,
            breadcrumb: 'Layers',
          }),
        ];
        return from === undefined
          ? { entries, total: 3, nextCursor: cursor(TOOLS.listProducts, 2) }
          : { entries: entries.slice(0, 1), total: 3 };
      },
    },

    index: {
      ensure: async () => [],
      query: () => ({ hits: [], total: 0 }),
      symbols: () => ({ exact: () => [], members: () => [], fuzzy: () => [] }),
      samples: () => [],
      toc: () => [],
      addBody: () => undefined,
      health: () => [{ product: 'js-maps-sdk', source: 'guide', state: 'ok', records: 118 }],
    },

    search: {
      async search(req) {
        const scope = {
          products: ['js-maps-sdk'],
          line: 'latest',
          ...(req.kind ? { kind: req.kind } : {}),
        };
        if (req.query === 'nothing') {
          return {
            query: req.query,
            scope,
            mode: 'local',
            total: 0,
            hits: [],
            notes: ['No hits; absence here is not proof that the feature does not exist.'],
          };
        }
        const hits = [
          makeHit({
            ref: `${JS}/references/core/layers/FeatureLayer/#queryFeatures`,
            title: 'FeatureLayer.queryFeatures',
            product: 'js-maps-sdk',
            source: 'references',
            kind: 'api',
            symbolKind: 'method',
            match: 'symbol',
            version: '5.1',
            breadcrumb: 'Reference > layers',
            excerpt: 'Runs a query\n  against the layer.',
          }),
          makeHit({ ref: REFS.page, product: 'js-maps-sdk', license: 'project', kind: 'brief' }),
        ];
        return {
          query: req.query,
          scope: { ...scope, sources: ['references'], resolvedFrom: req.product ?? 'workspace' },
          mode: 'local+site',
          total: req.query === 'many' ? 40 : hits.length,
          hits,
          ...(req.query === 'many' && req.cursor === undefined
            ? { nextCursor: cursor(TOOLS.search, 8) }
            : {}),
          notes: [],
        };
      },
    },

    docs: {
      async read(req) {
        if (req.ref === REFS.missing) {
          throw new McpDocError('DOC_NOT_FOUND', 'The page does not exist', {
            why: 'The host answered 404',
            url: REFS.missing,
            host: 'developers.arcgis.com',
          });
        }
        if (req.ref === REFS.crash) throw new Error('kaboom at C:\\secret\\path.ts');
        const page = makeDocPage({
          ref: req.ref,
          product: 'js-maps-sdk',
          ...(req.ref === REFS.degraded
            ? {
                cache: 'stale' as const,
                degraded: { level: 'stale' as const, reason: 'upstream timeout' },
                notices: ['Served from a stale copy.'],
                redirectedFrom: [`${JS}/old-name/`],
              }
            : {}),
        });
        const outline = page.sections.map(({ id, title, level, tokens }) => ({
          id,
          title,
          level,
          tokens,
        }));
        if (req.ref === REFS.long && req.cursor === undefined) {
          return {
            page,
            text: page.sections[0]?.markdown ?? '',
            outline,
            truncated: true,
            nextCursor: cursor(TOOLS.read, 120),
          };
        }
        return {
          page,
          text: page.sections.map((section) => section.markdown).join('\n\n'),
          outline,
          truncated: false,
          next: formatCall(TOOLS.read, { ref: req.ref, section: 'install' }),
        };
      },
      page: async (ref) => makeDocPage({ ref }),
    },

    symbols: {
      async lookup(req) {
        if (req.symbol === 'Graphic') {
          throw new McpDocError('AMBIGUOUS_SYMBOL', 'Several symbols are named "Graphic"', {
            candidates: [
              JSON.stringify({ symbol: 'Graphic', product: 'js-maps-sdk' }),
              JSON.stringify({ symbol: 'Graphic', product: 'widgets-sdk' }),
            ],
          });
        }
        if (req.symbol === 'Nope') {
          throw new McpDocError('SYMBOL_NOT_FOUND', 'No symbol named "Nope" was found', {
            why: 'Not verified; this does not prove it does not exist',
            candidates: ['Node', 'Note'],
          });
        }
        const ref = `${JS}/references/core/layers/FeatureLayer/`;
        const record = makeRecord({
          ref,
          product: 'js-maps-sdk',
          source: 'references',
          kind: 'api',
          title: 'FeatureLayer',
          symbol: 'FeatureLayer',
          qualified: 'layers.FeatureLayer',
          symbolKind: 'class',
        });
        return {
          record,
          page: makeDocPage({ ref, product: 'js-maps-sdk', kind: 'api', version: '5.1.2' }),
          text: '```ts\nclass FeatureLayer extends Layer\n```\nA layer of features.',
          alternates: [
            makeRecord({
              ref: `${JS}/references/core/layers/FeatureLayerView/`,
              product: 'js-maps-sdk',
              symbol: 'FeatureLayerView',
              symbolKind: 'class',
            }),
          ],
          resolvedProduct: registry.resolve(req.product ?? 'javascript'),
          next: formatCall(TOOLS.lookupSymbol, {
            symbol: 'FeatureLayer.queryFeatures',
            product: 'js-maps-sdk',
          }),
        };
      },
    },

    samples: {
      async find(req) {
        const blob = 'https://github.com/Esri/jsapi-resources/blob/v5.1.0/samples/cluster';
        const hit = {
          record: makeRecord({
            ref: `${JS}/sample-code/cluster/`,
            product: 'js-maps-sdk',
            source: 'samples',
            kind: 'sample' as const,
            title: 'Cluster points',
            language: 'typescript',
            platform: 'web',
            breadcrumb: 'Visualization',
            license: 'apache-2.0' as const,
          }),
          summary: 'Clusters point\n features.',
          relevantApis: ['FeatureLayer', 'FeatureReductionCluster'],
          files: [
            { name: 'main.ts', ref: `${blob}/main.ts`, bytes: 512 },
            { name: 'README.md', ref: `${blob}/README.md` },
          ],
          origin: 'github' as const,
          apiConfirmed: false,
          legacyPattern: true,
        };
        const hits = req.query === 'nothing' ? [] : [hit];
        return {
          scope: {
            product: 'js-maps-sdk',
            line: 'latest',
            pinnedTo: 'v5.1.0',
            ...(req.platform ? { platform: req.platform } : {}),
          },
          total: hits.length,
          hits,
          ...(req.withCode && hits.length > 0
            ? {
                code: {
                  ref: `${blob}/main.ts`,
                  file: 'main.ts',
                  language: 'ts',
                  text: 'const fence = "```";\nexport const layer = 1;\n',
                  truncated: req.maxTokens < 1000,
                },
              }
            : {}),
          notes: req.usesApi ? [`API use of ${req.usesApi} was not confirmed for every hit.`] : [],
        };
      },
    },

    versions: {
      async report(req) {
        if (req.product === undefined) return { asOf: ctx.clock.iso(), products: [], notes: [] };
        const { product } = registry.resolve(req.product);
        if (product.id !== 'js-maps-sdk') {
          return {
            asOf: ctx.clock.iso(),
            products: [
              {
                product,
                facts: [],
                compatibility: [],
                releaseNotes: [],
                notices: [],
                mismatches: [],
              },
            ],
            notes: ['No version oracle answered.'],
          };
        }
        const npm = 'https://registry.npmjs.org/@arcgis/core';
        return {
          asOf: ctx.clock.iso(),
          products: [
            {
              product,
              facts: [
                {
                  role: 'documented',
                  value: '5.1',
                  date: '2026-06-24',
                  oracle: 'page-regex',
                  url: `${JS}/`,
                },
                {
                  role: 'installable',
                  value: '5.1.2',
                  tag: 'latest',
                  date: '2026-07-01',
                  registry: 'npm',
                  package: '@arcgis/core',
                  oracle: 'npm-dist-tags',
                  url: npm,
                },
                { role: 'installable', value: '4.34.8', oracle: 'npm-dist-tags', url: npm },
                {
                  role: 'prerelease',
                  value: '5.2.0-next.3',
                  tag: 'next',
                  oracle: 'npm-dist-tags',
                  url: npm,
                },
                { role: 'prerelease', value: '5.2.0-rc.1', oracle: 'npm-dist-tags', url: npm },
                {
                  role: 'lifecycle',
                  value: '2026-06-24',
                  tag: 'ga',
                  oracle: 'plc',
                  url: 'https://support.esri.com/lifecycle',
                },
                {
                  role: 'lifecycle',
                  value: '2028-06-24',
                  tag: 'retirement',
                  oracle: 'plc',
                  url: 'https://support.esri.com/lifecycle',
                },
              ],
              project: {
                product: product.id,
                package: '@arcgis/core',
                version: '4.31.0',
                file: 'package.json',
              },
              compatibility: [
                {
                  with: 'ArcGIS Enterprise',
                  value: '12.0',
                  unreleased: true,
                  source: `${JS}/system-requirements/`,
                },
              ],
              releaseNotes: [{ version: '5.1', ref: `${JS}/release-notes/` }],
              notices: ['4.x widgets are deprecated.'],
              mismatches: ['Documentation describes 5.1; npm latest is 5.1.2.'],
            },
          ],
          notes: [],
        };
      },
      async label(product) {
        if (product.id === 'widgets-sdk') throw new Error('oracle offline');
        return '5.1';
      },
    },
  };
}
