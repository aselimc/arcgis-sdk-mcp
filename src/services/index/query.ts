/**
 * Runs one catalogue query over several loaded indexes and merges the result. Matching
 * escalates as in design section 6.4: every term, then any term when fewer than three
 * records match, then any term with looser spelling.
 */
import type { CatalogRecord, DocKind, SearchHit } from '../../core/types.js';
import type { IndexMatch, MatchMode } from './minisearch-index.js';
import { queryTerms } from './query-terms.js';
import type { CatalogQuery, Unit } from './types.js';

/** Below this many matches the next, looser mode is tried. */
const ENOUGH_MATCHES = 3;

const MODES: readonly MatchMode[] = ['and', 'or', 'fuzzy'];

/**
 * True when a record is of the requested kind. `api` also covers named spec objects, which
 * are API reference in everything but their source format.
 */
export function kindMatches(record: CatalogRecord, kind: DocKind | undefined): boolean {
  if (kind === undefined || record.kind === kind) return true;
  return kind === 'api' && record.kind === 'spec' && record.symbol !== undefined;
}

/** The search hit for a catalogue record. */
export function hitFromRecord(
  record: CatalogRecord,
  match: SearchHit['match'],
  score: number,
): SearchHit {
  return {
    ref: record.ref,
    title: record.title,
    product: record.product,
    source: record.source,
    line: record.line,
    kind: record.kind,
    ...(record.breadcrumb === undefined ? {} : { breadcrumb: record.breadcrumb }),
    ...(record.description === undefined ? {} : { excerpt: record.description }),
    ...(record.symbolKind === undefined ? {} : { symbolKind: record.symbolKind }),
    match,
    score,
    license: record.license,
  };
}

/** Units inside a scope of products, optional sources and an optional line. */
export function unitsInScope(
  units: Iterable<Unit>,
  scope: { products: readonly string[]; sources?: readonly string[] | undefined; line?: string | undefined },
): Unit[] {
  return [...units].filter(
    (unit) =>
      scope.products.includes(unit.product) &&
      (scope.sources === undefined || scope.sources.includes(unit.source)) &&
      (scope.line === undefined || unit.line === scope.line),
  );
}

/** Runs `q` over `units`; `hits` is the requested page, `total` the number of matching records. */
export function runCatalogQuery(
  units: readonly Unit[],
  q: CatalogQuery,
): { hits: SearchHit[]; total: number } {
  const terms = queryTerms(q.text, q.synonyms);
  if (terms.length === 0 || units.length === 0) return { hits: [], total: 0 };

  let matches: IndexMatch[] = [];
  for (const mode of MODES) {
    matches = units.flatMap((unit) =>
      unit.search.search(terms, mode, (record) => kindMatches(record, q.kind)),
    );
    if (matches.length >= ENOUGH_MATCHES) break;
  }

  // Scores of separate indexes are close enough to compare; ties keep source order.
  matches.sort((a, b) => b.score - a.score);
  return {
    hits: matches
      .slice(q.offset, q.offset + q.limit)
      .map(({ record, match, score }) => hitFromRecord(record, match, score)),
    total: matches.length,
  };
}
