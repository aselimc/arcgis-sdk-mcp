/**
 * Builds the body of one site-search request for a product, following the canonical request
 * builders of `gap-esearchapi-contract-and-coverage.md` section 6. A product that the backend
 * cannot answer for (not indexed, or only reachable with a filter that cannot be proven
 * well-formed) gets no request at all.
 */
import { sourceBaseUrls } from '../../../core/source-urls.js';
import type { Product, VersionLine } from '../../../core/types.js';
import { FilterError, and, or, serializeFilter, term, type FilterNode } from './filters.js';

/** The only endpoint ever contacted. */
export const ESEARCH_URL = 'https://esearchapi.esri.com/search';

/** Hits requested by default. */
export const DEFAULT_NUM = 10;

/** Largest page size: beyond it the backend's 10 s timeout becomes likely. */
export const MAX_NUM = 25;

/** A retry halves `num` but never goes below this. */
export const MIN_RETRY_NUM = 5;

/** Index of developers.arcgis.com; English only. */
const DEVELOPERS_INDEX = 'developers_arcgis_v1';

const DEVELOPERS_HOST = 'developers.arcgis.com';

/** Collections that hold several languages and need an explicit English filter. */
const SITES_NEEDING_LANGUAGE = new Set(['arcgis_doc_col', 'enterprise_arcgis']);

/** Most URL prefixes OR-ed into one filter; a longer filter is not worth the request. */
const MAX_PREFIXES = 8;

/**
 * Trees the backend cannot answer for: the Swift API reference (only a script shell is
 * indexed), Python API-reference pages (multi-megabyte documents that time out) and `/ai/`
 * (not indexed).
 */
const NEVER_SEARCHED = [/^\/swift\/(?:.*\/)?api-reference\//, /^\/python\/(?:.*\/)?api-reference\//, /^\/ai\//];

/** Version trees to drop from results of a current-line search (research section 4.3). */
const OLD_TREES = /\/(?:v\d+|python-2-3|qt\/qml|unity\/v1|unreal-engine\/v1)\//;

/** The response projection: enough to build a hit, a quarter of the default size. */
export const PROJECTION = [
  'url',
  'title',
  'description',
  'lastModified',
  'submitTime',
  'language',
  'metaFields.product',
  'metaFields.version',
  'metaFields.content_type',
  'metaFields.search-collection',
] as const;

/** JSON body of `POST /search`. */
export interface EsearchBody {
  q: string;
  index?: string;
  site?: string;
  num: number;
  start: number;
  requiredfields?: string;
  partialfields?: string;
  _source: { includes: string[] };
}

/** A request to send, with the client-side filters for its results. */
export interface EsearchPlan {
  body: EsearchBody;
  /** Result URLs must match this. */
  keep?: RegExp;
  /** Result URLs must not match this. */
  drop?: RegExp;
}

/** Why no request is sent for a product. */
export interface EsearchSkip {
  skip: string;
}

function regex(source: string | undefined): RegExp | undefined {
  if (source === undefined) return undefined;
  try {
    return new RegExp(source);
  } catch {
    return undefined;
  }
}

/** `https://host/a/b/` to `host/a/b`: the phrase a `Content-Location` filter matches. */
function prefixPhrase(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

/** The developers.arcgis.com trees of a product on one line, outermost only. */
function developerPrefixes(product: Product, line: VersionLine): string[] {
  const phrases = new Set<string>();
  for (const source of product.sources) {
    if (source.capability !== 'website' && source.capability !== 'site-index') continue;
    if (source.lines !== undefined && !source.lines.includes(line.id)) continue;
    for (const base of sourceBaseUrls(source, line)) {
      let url: URL;
      try {
        url = new URL(base);
      } catch {
        continue;
      }
      if (url.hostname !== DEVELOPERS_HOST || url.pathname === '/') continue;
      if (NEVER_SEARCHED.some((pattern) => pattern.test(url.pathname))) continue;
      phrases.add(prefixPhrase(`${url.hostname}${url.pathname}`));
    }
  }
  const all = [...phrases];
  // A tree inside another one is already covered by the outer filter.
  return all.filter((phrase) => !all.some((other) => other !== phrase && phrase.startsWith(`${other}/`)));
}

/** Removes what the backend does not treat as an operator but would match literally. */
function cleanQuery(text: string): string {
  return text.replace(/[*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Plans the request for one product and line.
 *
 * - A product with an `esearch` entry in the registry is searched in that index (or
 *   collection) with an exact `product` filter, plus `content-language:en` where the
 *   collection is multilingual, plus its URL prefix when it has one.
 * - Any other product is searched in the developers index by the URL prefixes of its
 *   website sources.
 *
 * @param num requested hits; clamped to 1..{@link MAX_NUM}.
 */
export function planRequest(
  product: Product,
  line: VersionLine,
  text: string,
  num: number = DEFAULT_NUM,
): EsearchPlan | EsearchSkip {
  const q = cleanQuery(text);
  if (q === '') return { skip: 'empty query' };

  const config = product.esearch;
  const required: FilterNode[] = [];
  const partial: FilterNode[] = [];
  let scope: Pick<EsearchBody, 'index' | 'site'>;

  if (config !== undefined && (config.index !== undefined || config.site !== undefined)) {
    scope = config.index !== undefined ? { index: config.index } : { site: config.site as string };
    const ids = config.products ?? [];
    if (ids.length > 0) required.push(or(...ids.map((id) => term('product', id))));
    if (config.site !== undefined && SITES_NEEDING_LANGUAGE.has(config.site)) {
      required.push(term('content-language', 'en'));
    }
    if (config.urlPrefix !== undefined) {
      partial.push(term('Content-Location', prefixPhrase(config.urlPrefix)));
    }
    if (required.length === 0 && partial.length === 0) {
      return { skip: `${product.id} has no filter that scopes site search to it` };
    }
  } else {
    const prefixes = developerPrefixes(product, line);
    if (prefixes.length === 0 || prefixes.length > MAX_PREFIXES) {
      return { skip: `${product.id} is not covered by site search` };
    }
    scope = { index: DEVELOPERS_INDEX };
    partial.push(or(...prefixes.map((prefix) => term('Content-Location', prefix))));
  }

  const body: EsearchBody = {
    q,
    ...scope,
    num: Math.min(MAX_NUM, Math.max(1, Math.trunc(num))),
    start: 0,
    _source: { includes: [...PROJECTION] },
  };
  try {
    if (required.length > 0) body.requiredfields = serializeFilter(and(...required), 'requiredfields');
    if (partial.length > 0) body.partialfields = serializeFilter(and(...partial), 'partialfields');
  } catch (error) {
    if (error instanceof FilterError) return { skip: error.message };
    throw error;
  }

  const keep = regex(config?.keepUrl);
  const drop = regex(config?.dropUrl) ?? (line.current ? OLD_TREES : undefined);
  return {
    body,
    ...(keep === undefined ? {} : { keep }),
    ...(drop === undefined ? {} : { drop }),
  };
}

/** The request body as JSON with sorted keys, so equal requests share one cache entry. */
export function bodyJson(body: EsearchBody): string {
  const sorted = Object.fromEntries(
    Object.entries(body).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return JSON.stringify(sorted);
}
