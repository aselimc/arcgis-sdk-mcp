/**
 * Where a page came from. Every renderer derives these fields from its `RenderMeta` through
 * the one function below, so `ref`, `retrievedAt`, `cache` and the `Source:` line mean the
 * same thing for an HTML page, a structured reference entry and a test double.
 */
import { attribution } from './attribution.js';
import type { RenderMeta } from './ports.js';
import type { DocPage } from './types.js';

/** The fields of a `DocPage` that describe its origin rather than its content. */
export type PageProvenance = Pick<
  DocPage,
  | 'ref'
  | 'url'
  | 'product'
  | 'source'
  | 'line'
  | 'version'
  | 'kind'
  | 'license'
  | 'attribution'
  | 'retrievedAt'
  | 'cache'
  | 'redirectedFrom'
>;

/**
 * Builds the provenance fields of a page. Spread the result into the `DocPage`.
 *
 * - `ref` is `meta.url` as given (it may carry a `#fragment` that names a member or
 *   section); `url` is the same without the fragment.
 * - `retrievedAt` is `meta.retrievedAt`, else the response's `fetchedAt`, else empty: a
 *   caller without a response (local packages, bundled briefs) passes the time itself.
 * - `cache` and `redirectedFrom` come from the response; content that was not fetched is a
 *   `miss` with no redirects.
 * - `attribution` is the `Source:` line of the licence tier, with `meta.packageName`,
 *   `meta.version` and `meta.specName` where the tier names them.
 * - `product`, `source`, `line` and `version` are copied when present.
 */
export function pageProvenance(meta: RenderMeta): PageProvenance {
  const retrievedAt = meta.retrievedAt ?? meta.res?.fetchedAt ?? '';
  const cache = meta.res?.cache ?? 'miss';
  return {
    ref: meta.url,
    url: meta.url.replace(/#.*$/, ''),
    ...(meta.product === undefined ? {} : { product: meta.product }),
    ...(meta.source === undefined ? {} : { source: meta.source }),
    ...(meta.line === undefined ? {} : { line: meta.line }),
    ...(meta.version === undefined ? {} : { version: meta.version }),
    kind: meta.kind,
    license: meta.license,
    attribution: attribution(meta.license, {
      url: meta.url,
      retrievedAt,
      cache,
      ...(meta.packageName === undefined ? {} : { packageName: meta.packageName }),
      ...(meta.version === undefined ? {} : { version: meta.version }),
      ...(meta.specName === undefined ? {} : { specName: meta.specName }),
    }),
    retrievedAt,
    cache,
    redirectedFrom: [...(meta.res?.aliasChain ?? [])],
  };
}
