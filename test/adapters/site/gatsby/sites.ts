import { bindSource } from '../../../../src/core/adapter-helpers.js';
import type { BoundSource } from '../../../../src/core/ports.js';
import type {
  AdapterConfigMap,
  CatalogRecord,
  Product,
  SourceDef,
} from '../../../../src/core/types.js';
import { makeLine, makeProduct, makeSource } from '../../../support/builders.js';
import { FakeHttp, type RecordedResponse } from '../../../support/fake-http.js';
import { loadCassette } from '../../../support/fixtures.js';
import { makeCtx, type MakeCtxOptions, type TestCtx } from '../../../support/make-ctx.js';

/** Origin of every synthetic site. */
export const D = 'https://developers.arcgis.com';

/** One synthetic Gatsby site: a cassette and the source that reads it. */
export interface Site {
  product: Product;
  source: SourceDef<'gatsby'>;
  /** A fresh context replaying the site's cassette. */
  ctx(options?: MakeCtxOptions): TestCtx;
  /** The source bound to its current line. */
  bound(): BoundSource<'gatsby'>;
}

function cassetteOf(name: string) {
  return loadCassette('cassettes', 'site', 'gatsby', `${name}.json`);
}

/**
 * Replaces the HTTP fake of a context by one that replays the named cassette with the
 * recording of `url` exchanged for `response`. (Adding a response with `on` would only queue
 * it behind the recorded one.)
 */
export function replaceResponse(
  ctx: TestCtx,
  cassette: string,
  url: string,
  response: RecordedResponse,
): void {
  const recorded = cassetteOf(cassette);
  const interactions = recorded.interactions.filter((interaction) => interaction.url !== url);
  if (interactions.length === recorded.interactions.length) {
    throw new Error(`${cassette}.json does not record ${url}`);
  }
  ctx.http = new FakeHttp({ cassette: { interactions }, clock: ctx.clock }).on(url, response);
}

/** Builds a {@link Site} from a cassette name and a gatsby source config. */
export function site(
  cassette: string,
  config: AdapterConfigMap['gatsby'],
  overrides: Partial<Omit<SourceDef<'gatsby'>, 'adapter' | 'config'>> = {},
): Site {
  const base = config.base.startsWith('http') ? config.base : `${D}${config.base}`;
  const source = makeSource('gatsby', config, { probe: { url: base, expect: 'html' }, ...overrides });
  const product = makeProduct({ sources: [source], homepage: base });
  return {
    product,
    source,
    ctx: (options = {}) =>
      makeCtx({ cassette: cassetteOf(cassette), ...options }),
    bound: () => bindSource(product, source, makeLine()),
  };
}

/** Guide site with everything inline in page-data. */
export const guide = (config: Partial<AdapterConfigMap['gatsby']> = {}): Site =>
  site('guide', { base: '/widgets/', ...config });

/** REST reference with nav and search in static queries. */
export const rest = (): Site =>
  site('rest', { base: '/rest/gadgets/', seedPage: '/rest/gadgets/', symbols: 'rest-operations' }, {
    kinds: ['api'],
    probe: { url: `${D}/rest/gadgets/`, expect: 'html', family: 'gatsby-rest' },
  });

/** Developer guide with per-section indexes and the glossary. */
export const documentation = (): Site =>
  site('documentation', { base: '/documentation/', symbols: 'glossary' });

/** TypeDoc API reference. */
export const typedoc = (): Site => site('typedoc', { base: '/toolkit-js/', symbols: 'typedoc' });

/** OpenAPI-generated service sections. */
export const openapi = (): Site => site('openapi', { base: '/services/', symbols: 'openapi' });

/** .NET reference indexed by its navigation tree only. */
export const apiref = (): Site =>
  site('apiref', { base: '/server-sdk/', symbols: 'apiref-nav', bodyFrom: 'auto' });

/** Sphinx reference whose base lies inside the site prefix. */
export const pythonApi = (): Site =>
  site(
    'python',
    { base: '/pylib/latest/api-reference/', symbols: 'sphinx-pagination', bodyFrom: 'sphinxJson' },
    { id: 'api', title: 'API reference', kinds: ['api'] },
  );

/** The guide of the same site, with notebook pages. */
export const pythonGuide = (): Site =>
  site('python', { base: '/pylib/latest/', bodyFrom: 'auto', exclude: ['^api-reference/'] });

/** Game-engine site whose store lists API members. */
export const engine = (): Site => site('engine', { base: '/engine/', symbols: 'fuse-store' });

/** Specification site with everything embedded in page-data. */
export const spec = (): Site =>
  site(
    'spec',
    {
      base: '/thing-specification/',
      bodyFrom: 'childMarkdownRemark',
      symbolsFromSlug: '^objects/([^/]+)/$',
    },
    { kinds: ['spec'], license: 'cc-by-nd' },
  );

/** Looks a record up by the end of its ref, failing the test when it is missing. */
export function recordAt(records: readonly CatalogRecord[], suffix: string): CatalogRecord {
  const record = records.find((candidate) => candidate.ref.endsWith(suffix));
  if (record === undefined) {
    throw new Error(`no record ends with ${suffix}: ${records.map((r) => r.ref).join(', ')}`);
  }
  return record;
}
