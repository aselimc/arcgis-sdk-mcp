/**
 * Catalogue records: the fields every record of a source shares, written in one place.
 */
import { BREADCRUMB_SEPARATOR } from '../../core/names.js';
import type { BoundSource } from '../../core/ports.js';
import type { CatalogRecord, DocKind } from '../../core/types.js';
import { licenseOf } from './source.js';

/**
 * Optional fields of a record. `breadcrumb` is given as ancestor titles, outermost first;
 * `license` overrides the tier of the source (a repository states its own licence).
 */
export type RecordExtras = {
  [
    K in Exclude<
      keyof CatalogRecord,
      'ref' | 'product' | 'source' | 'line' | 'kind' | 'title' | 'breadcrumb'
    >
  ]?: CatalogRecord[K] | undefined;
} & { breadcrumb?: readonly string[] };

/**
 * A catalogue record of a source. Undefined and empty extras are left out, so callers pass
 * what an index gave them without checking each field.
 */
export function recordOf(
  src: BoundSource,
  ref: string,
  kind: DocKind,
  title: string,
  extras: RecordExtras = {},
): CatalogRecord {
  const { breadcrumb, license, ...rest } = extras;
  const trail = (breadcrumb ?? []).filter((part) => part !== '');
  const present = Object.entries(rest).filter(([, value]) => value !== undefined && value !== '');
  return {
    ref,
    product: src.product.id,
    source: src.source.id,
    line: src.line.id,
    kind,
    title,
    ...(trail.length === 0 ? {} : { breadcrumb: trail.join(BREADCRUMB_SEPARATOR) }),
    ...(Object.fromEntries(present) as Partial<CatalogRecord>),
    license: license ?? licenseOf(src),
  };
}

/**
 * A record of an API reference: {@link recordOf} with kind `api`, unless the index says the
 * entry is something else (an article or tutorial published next to the reference).
 */
export function symbolRecord(
  src: BoundSource,
  ref: string,
  title: string,
  extras: RecordExtras & { kind?: DocKind | undefined } = {},
): CatalogRecord {
  const { kind, ...rest } = extras;
  return recordOf(src, ref, kind ?? 'api', title, rest);
}
