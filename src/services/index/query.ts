/**
 * Runs one catalogue query over several loaded indexes and merges the result.
 *
 * Matching escalates as in design section 6.4 (every term, then any term, then any term
 * with looser spelling), with one change: a query of three or more words starts at "any
 * term". Requiring every word made the first rung answer with whatever handful of records
 * happened to hold them all (`add a feature layer to a map` stopped at six API members and
 * never saw the tutorial "Add a feature layer", whose description lacks the word "map").
 * With any term, a record that holds every word still ranks first, because the score is
 * multiplied by the squared share of the words it matches.
 */
import type { CatalogRecord, DocKind, SearchHit } from '../../core/types.js';
import type { IndexMatch, MatchMode } from './minisearch-index.js';
import { queryTerms } from './query-terms.js';
import type { CatalogQuery, CatalogResult, Unit } from './types.js';

/** Below this many matches the next, looser mode is tried. */
const ENOUGH_MATCHES = 3;

const MODES: readonly MatchMode[] = ['and', 'or', 'fuzzy'];

/** Fewest query words from which matching starts at "any term". */
const WORDS_FOR_ANY_TERM = 3;

/** Share of the query's words a record must match to count towards the total. */
const COUNTED_SHARE = 0.5;

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
  scope: {
    products: readonly string[];
    sources?: readonly string[] | undefined;
    line?: string | undefined;
  },
): Unit[] {
  return [...units].filter(
    (unit) =>
      scope.products.includes(unit.product) &&
      (scope.sources === undefined || scope.sources.includes(unit.source)) &&
      (scope.line === undefined || unit.line === scope.line),
  );
}

/**
 * What the scores of one index are divided by before indexes are merged. BM25 weighs a rare
 * word by the size of its index, so the same title match scored several times higher in an
 * API reference of 60,000 records than in a guide of 150, and small guide indexes lost
 * every merge. The logarithm of the size is the factor by which that weight grows.
 */
function sizeFactor(unit: Unit): number {
  return Math.log(2 + unit.records.length);
}

/**
 * Runs `q` over `units`; `hits` is the requested page, `total` the number of records that
 * match at least half of the query's words.
 */
export function runCatalogQuery(units: readonly Unit[], q: CatalogQuery): CatalogResult {
  const terms = queryTerms(q.text, q.synonyms);
  if (terms.length === 0 || units.length === 0) return { hits: [], total: 0, complete: 0 };

  let matches: IndexMatch[] = [];
  for (const mode of MODES.slice(terms.length >= WORDS_FOR_ANY_TERM ? 1 : 0)) {
    matches = units.flatMap((unit) => {
      const factor = sizeFactor(unit);
      return unit.search
        .search(terms, mode, (record) => kindMatches(record, q.kind))
        .map((match) => ({ ...match, score: match.score / factor }));
    });
    if (matches.length >= ENOUGH_MATCHES) break;
  }

  // Ties keep source order: the sort is stable and the units come most important first.
  matches.sort((a, b) => b.score - a.score);
  return {
    hits: matches
      .slice(q.offset, q.offset + q.limit)
      .map(({ record, match, score }) => hitFromRecord(record, match, score)),
    total: matches.filter((match) => match.covered >= COUNTED_SHARE).length,
    complete: matches.filter((match) => match.covered >= 1).length,
  };
}
