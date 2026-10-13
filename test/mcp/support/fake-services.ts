/**
 * A scripted `Services` for the MCP surface tests. It answers from a small invented
 * catalogue and fails on a few magic inputs, so every presenter and error path can be
 * exercised without the real services, adapters or network.
 */
import { formatCall } from '../../../src/core/budget.js';
import { McpDocError } from '../../../src/core/errors.js';
import { TOOLS } from '../../../src/core/names.js';
import type { Ctx, Services } from '../../../src/core/ports.js';
import { makeDocPage, makeHit, makeRecord } from '../../support/builders.js';
import { JS, REFS, testCursor as cursor } from './catalogue.js';
import { fakeSamples, fakeVersions } from './fake-samples-versions.js';

/**
 * Builds the scripted services.
 *
 * Magic inputs: search query `nothing` has no hits and `many` has a second page; ref
 * {@link REFS.missing} is `DOC_NOT_FOUND`, {@link REFS.crash} throws a plain `Error`,
 * {@link REFS.long} is truncated; symbol `Graphic` is ambiguous and `Nope` is not found;
 * every product but `js-maps-sdk` reports no version facts.
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

    samples: fakeSamples(),
    versions: fakeVersions(ctx),
  };
}
