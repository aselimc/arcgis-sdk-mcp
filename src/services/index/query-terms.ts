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

/** Shortest plural that is reduced to its singular; `gis` and `bus` are not plurals. */
const MIN_PLURAL_LENGTH = 4;

const LETTERS_ONLY = /^\p{L}+$/u;
const ONE_LETTER = /^\p{L}$/u;

/**
 * The other grammatical number of a word: `buttons` for `button`, `layer` for `layers`.
 * Documents are indexed without stemming, so that API names stay exact, and a guide titled
 * "Buttons" would otherwise meet the query word `button` only as a low-weight prefix match.
 * `undefined` for anything that is not a plain word of some length.
 */
export function otherNumber(word: string): string | undefined {
  if (word.length < MIN_PLURAL_LENGTH - 1 || !LETTERS_ONLY.test(word)) return undefined;
  if (!word.endsWith('s')) return `${word}s`;
  if (word.length < MIN_PLURAL_LENGTH || word.endsWith('ss')) return undefined;
  return word.slice(0, -1);
}

/**
 * Splits `text` into distinct query terms, in order. Stop words and single letters (the `x`
 * of `4.x`, which is also the name of a coordinate property on dozens of types) are dropped
 * when other words remain.
 *
 * @param synonyms lower-case word to alternative phrases (`popup` to `pop up`); see
 *   `search/synonyms.ts`. The other grammatical number of each word is added to them.
 */
export function queryTerms(
  text: string,
  synonyms: ReadonlyMap<string, readonly string[]> = new Map(),
): QueryTerm[] {
  const words = text.match(WORD) ?? [];
  const meaningful = words.filter(
    (word) => !STOP_WORDS.has(word.toLowerCase()) && !ONE_LETTER.test(word),
  );
  const kept = meaningful.length > 0 ? meaningful : words;

  const terms = new Map<string, QueryTerm>();
  for (const word of kept) {
    const [whole = '', ...parts] = tokenize(word);
    if (whole === '' || terms.has(whole)) continue;
    const number = otherNumber(whole);
    const phrases = new Set([...(synonyms.get(whole) ?? []), ...(number === undefined ? [] : [number])]);
    terms.set(whole, {
      whole,
      parts,
      synonyms: [...phrases]
        .map((phrase) => (phrase.match(WORD) ?? []).map((part) => part.toLowerCase()))
        .filter((phrase) => phrase.length > 0),
    });
  }
  return [...terms.values()];
}
