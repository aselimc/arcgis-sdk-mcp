/**
 * The catalogue search engine: MiniSearch over `CatalogRecord` with the fields and matching
 * rules of design section 6.4. One instance per (product, source, line).
 *
 * The boosts differ from the first design in one respect. An API record carries its name
 * three times (`symbol`, `title`, `qualified`), a guide page once (`title`), so one shared
 * word scored 140 on a member against 50 on the tutorial that answers the question. The
 * title is therefore the one strong name field; `symbol` and `qualified` add a little for
 * the parts of a name that the title does not hold. Exact API names do not depend on this:
 * the search service looks them up in the symbol table before it asks this index.
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

/** Indexed fields with their boosts. */
const FIELD_BOOSTS = {
  title: 50,
  headings: 30,
  keywords: 20,
  qualified: 15,
  symbol: 10,
  description: 10,
  breadcrumb: 5,
} as const;

type Field = keyof typeof FIELD_BOOSTS;

const FIELDS = Object.keys(FIELD_BOOSTS) as Field[];

/** Fields in the order in which a hit is labelled: a name before text that mentions it. */
const LABEL_ORDER: readonly Field[] = [
  'symbol',
  'title',
  'qualified',
  'headings',
  'keywords',
  'description',
  'breadcrumb',
];

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

/**
 * Share of a record's score that does not depend on its `boost`. Sites publish boosts that
 * rank the entries of one index against each other (a class 1.0, its members 0.05 to 0.2);
 * applied in full they would push every API member below any guide page of another source,
 * which has no boost at all. Half the score is therefore kept for every record.
 */
const BOOST_FLOOR = 0.5;

/** Largest effect a published boost may have. */
const BOOST_CEILING = 1.5;

/** The score multiplier for a record's published `boost`; 1 when it has none. */
export function documentBoost(boost: number | undefined): number {
  if (boost === undefined || !Number.isFinite(boost) || boost <= 0) return 1;
  return BOOST_FLOOR + (1 - BOOST_FLOOR) * Math.min(boost, BOOST_CEILING);
}

/** True when a term is among `words` as itself, as all of its parts, or as a synonym. */
function has(term: QueryTerm, words: ReadonlySet<string>): boolean {
  return (
    words.has(term.whole) ||
    (term.parts.length > 1 && term.parts.every((part) => words.has(part))) ||
    term.synonyms.some((phrase) => phrase.every((word) => words.has(word)))
  );
}

/** The share of a query's words among `words`, 0 to 1; 1 for a query without words. */
export function share(terms: readonly QueryTerm[], words: ReadonlySet<string>): number {
  if (terms.length === 0) return 1;
  return terms.filter((term) => has(term, words)).length / terms.length;
}

/**
 * The share of a query's words a record matches, as a score multiplier. When not every word
 * has to match (modes `or` and `fuzzy`), field boosts alone would rank a record that has one
 * of three words in its symbol name above a record that has all three in its title and
 * description. Squaring the share makes a record that covers the query win.
 *
 * @param matched the query words MiniSearch reports as matched for the record.
 */
export function coverage(terms: readonly QueryTerm[], matched: ReadonlySet<string>): number {
  return share(terms, matched) ** 2;
}

/** Weight of the title bonus: a title that holds every query word triples the score. */
const TITLE_BONUS = 2;

/**
 * The multiplier for the share of the query that a record's title holds. A page whose title
 * is most of the query ("Add a feature layer" for "add a feature layer to a map") is the
 * page that was asked for, whatever else mentions the same words more often.
 */
export function titleBonus(titleShare: number): number {
  return 1 + TITLE_BONUS * titleShare * titleShare;
}

/** A namespace segment that marks implementation detail, not public API. */
const INTERNAL_SEGMENT = /(?:^|[.#/:])_?internal(?:[.#/:]|$)/i;

/**
 * The last entry of a breadcrumb under which DocC lists what a type takes over from a
 * protocol: "View Implementations", "Equatable Implementations".
 */
const DEFAULT_IMPLEMENTATIONS = /(?:^|>)\s*[^>]*\bImplementations\s*$/;

/** Weight of a record that is boilerplate or implementation detail. */
const BOILERPLATE_WEIGHT = 0.25;

/**
 * The multiplier for records that are in a reference without being what it documents:
 * members of `Internal` namespaces, and the members every type inherits from a framework
 * protocol (each SwiftUI view modifier, once per view type of the SDK). They stay findable
 * by their exact name, which goes through the symbol table.
 */
export function boilerplateWeight(record: CatalogRecord): number {
  const internal = INTERNAL_SEGMENT.test(record.qualified ?? '');
  const inherited = DEFAULT_IMPLEMENTATIONS.test(record.breadcrumb ?? '');
  return internal || inherited ? BOILERPLATE_WEIGHT : 1;
}

/** Terms shorter than this are matched exactly or by prefix only. */
const FUZZY_MIN_LENGTH = 5;

/** Fewest query words from which a record must match more than one of them, or one in its title. */
const MIN_TERMS_FOR_FLOOR = 3;

/** One matching record of a catalogue index. */
export interface IndexMatch {
  record: CatalogRecord;
  score: number;
  match: SearchHit['match'];
  /** Share of the query's words the record matches, 0 to 1. */
  covered: number;
}

/** A searchable catalogue index. */
export interface CatalogIndex {
  /** Matching records, best first. */
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
    // Typo tolerance is for what the caller typed. A derived form spelt loosely as well
    // matched nonsense (`cross` of `crossing` within two edits of `class`).
    for (const phrase of term.synonyms) {
      alternatives.push({ combineWith: 'AND', queries: phrase, fuzzy: false });
    }
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
        boostDocument: (id: number) => documentBoost(records[id]?.boost),
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
        const covered = share(terms, new Set(result.queryTerms));
        const inTitle = share(terms, new Set(tokenize(record.title)));
        // One word of several, matched by prefix or spelling somewhere outside the title,
        // is an accident (`thing` in `DirectionsString`), not a partial answer.
        const single = covered <= 1 / terms.length;
        if (terms.length >= MIN_TERMS_FOR_FLOOR && single && inTitle === 0) continue;
        const fields = new Set(Object.values(result.match).flat());
        const best = LABEL_ORDER.find((field) => fields.has(field)) ?? 'description';
        const score =
          result.score * covered ** 2 * titleBonus(inTitle) * boilerplateWeight(record);
        matches.push({ record, score, match: MATCH_LABEL[best], covered });
      }
      return matches.sort((a, b) => b.score - a.score);
    },
  };
}
