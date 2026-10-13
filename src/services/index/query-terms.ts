/**
 * Turns query text into the terms the catalogue and body indexes search for. Documents are
 * indexed with `tokenize` from `src/core`, so the same function splits the query here.
 */
import { tokenize } from '../../core/tokenize.js';

/** One word of a query with the alternative ways a document may contain it. */
export interface QueryTerm {
  /** The whole word, lower-case: `queryfeatures`. */
  whole: string;
  /** Its camelCase or snake_case parts when it has several: `query`, `features`. */
  parts: string[];
  /** Alternative phrases, each as the list of words that must all be present. */
  synonyms: string[][];
}

const WORD = /[\p{L}\p{N}_]+/gu;

/**
 * Words that carry no meaning in a documentation query. They are dropped only when other
 * words remain, so a query made of them alone still searches for something.
 */
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'at',
  'by',
  'can',
  'do',
  'does',
  'for',
  'from',
  'how',
  'i',
  'in',
  'is',
  'it',
  'my',
  'of',
  'on',
  'or',
  'the',
  'to',
  'using',
  'what',
  'with',
]);

/**
 * Splits `text` into distinct query terms, in order.
 *
 * @param synonyms lower-case word to alternative phrases (`popup` to `pop up`); see
 *   `search/synonyms.ts`.
 */
export function queryTerms(
  text: string,
  synonyms: ReadonlyMap<string, readonly string[]> = new Map(),
): QueryTerm[] {
  const words = text.match(WORD) ?? [];
  const meaningful = words.filter((word) => !STOP_WORDS.has(word.toLowerCase()));
  const kept = meaningful.length > 0 ? meaningful : words;

  const terms = new Map<string, QueryTerm>();
  for (const word of kept) {
    const [whole = '', ...parts] = tokenize(word);
    if (whole === '' || terms.has(whole)) continue;
    terms.set(whole, {
      whole,
      parts,
      synonyms: (synonyms.get(whole) ?? [])
        .map((phrase) => (phrase.match(WORD) ?? []).map((part) => part.toLowerCase()))
        .filter((phrase) => phrase.length > 0),
    });
  }
  return [...terms.values()];
}
