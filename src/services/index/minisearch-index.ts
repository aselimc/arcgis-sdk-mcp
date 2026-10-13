/**
 * The catalogue search engine: MiniSearch over `CatalogRecord` with the fields, boosts and
 * matching rules of design section 6.4. One instance per (product, source, line).
 */
import MiniSearch, { type Query, type SearchOptions } from 'minisearch';
import { tokenize } from '../../core/tokenize.js';
import type { CatalogRecord, SearchHit } from '../../core/types.js';
import type { QueryTerm } from './query-terms.js';

/**
 * How strictly a query is matched. The index service escalates in this order while fewer
 * than three records match: every term, then any term, then any term with looser spelling.
 */
export type MatchMode = 'and' | 'or' | 'fuzzy';

/** Indexed fields with their boosts, most significant first. */
const FIELD_BOOSTS = {
  symbol: 60,
  title: 50,
  qualified: 30,
  headings: 30,
  keywords: 20,
  description: 10,
  breadcrumb: 5,
} as const;

type Field = keyof typeof FIELD_BOOSTS;

const FIELDS = Object.keys(FIELD_BOOSTS) as Field[];

/** The `match` label reported for a hit whose best matching field is the key. */
const MATCH_LABEL: Record<Field, SearchHit['match']> = {
  symbol: 'symbol',
  qualified: 'symbol',
  title: 'title',
  headings: 'heading',
  keywords: 'keyword',
  description: 'description',
  breadcrumb: 'keyword',
};

/** Terms shorter than this are matched exactly or by prefix only. */
const FUZZY_MIN_LENGTH = 5;

/** One matching record of a catalogue index. */
export interface IndexMatch {
  record: CatalogRecord;
  score: number;
  match: SearchHit['match'];
}

/** A searchable catalogue index. */
export interface CatalogIndex {
  search(
    terms: readonly QueryTerm[],
    mode: MatchMode,
    accept?: (record: CatalogRecord) => boolean,
  ): IndexMatch[];
}

/**
 * The MiniSearch query for a list of terms. Each term is a group of alternatives (the whole
 * word, all of its camelCase parts, or all words of a synonym); groups are joined with AND
 * in mode `and` and with OR otherwise.
 */
export function termQuery(terms: readonly QueryTerm[], mode: MatchMode): Query {
  const groups = terms.map((term): Query => {
    const alternatives: Query[] = [term.whole];
    if (term.parts.length > 1) alternatives.push({ combineWith: 'AND', queries: term.parts });
    for (const phrase of term.synonyms) alternatives.push({ combineWith: 'AND', queries: phrase });
    return alternatives.length === 1 ? term.whole : { combineWith: 'OR', queries: alternatives };
  });
  return { combineWith: mode === 'and' ? 'AND' : 'OR', queries: groups };
}

/** Prefix and typo tolerance of a mode; the terms are already tokenised and lower-case. */
export function matchOptions(mode: MatchMode): SearchOptions {
  const distance = mode === 'fuzzy' ? 0.3 : 0.2;
  const minLength = mode === 'fuzzy' ? FUZZY_MIN_LENGTH - 1 : FUZZY_MIN_LENGTH;
  return {
    prefix: true,
    fuzzy: (term) => (term.length >= minLength ? distance : false),
    tokenize: (text) => [text],
    processTerm: (term) => term,
  };
}

function fieldText(record: CatalogRecord, field: string): string {
  const value = record[field as Field];
  return Array.isArray(value) ? value.join(' ') : (value ?? '');
}

/** Builds the index. Record positions are the document ids, so `records` must not change afterwards. */
export function buildCatalogIndex(records: readonly CatalogRecord[]): CatalogIndex {
  const engine = new MiniSearch<{ id: number; record: CatalogRecord }>({
    idField: 'id',
    fields: FIELDS,
    extractField: (document, field) =>
      field === 'id' ? document.id : fieldText(document.record, field),
    tokenize,
    // `tokenize` already lower-cases; no stemming, so API names stay exact.
    processTerm: (term) => term,
  });
  engine.addAll(records.map((record, id) => ({ id, record })));

  return {
    search(terms, mode, accept) {
      if (terms.length === 0) return [];
      const results = engine.search(termQuery(terms, mode), {
        ...matchOptions(mode),
        boost: FIELD_BOOSTS,
        boostDocument: (id: number) => records[id]?.boost ?? 1,
        ...(accept === undefined
          ? {}
          : {
              filter: (result) => {
                const record = records[result.id as number];
                return record !== undefined && accept(record);
              },
            }),
      });
      const matches: IndexMatch[] = [];
      for (const result of results) {
        const record = records[result.id as number];
        if (record === undefined) continue;
        const matched = new Set(Object.values(result.match).flat());
        const best = FIELDS.find((field) => matched.has(field)) ?? 'description';
        matches.push({ record, score: result.score, match: MATCH_LABEL[best] });
      }
      return matches;
    },
  };
}
