/**
 * Query classification: an API name is looked up in the symbol sidecar before the text
 * index is asked, so `FeatureLayer.queryFeatures` finds the method and not every page that
 * mentions it.
 */
import { isSymbolShaped, normalizeSymbol } from '../../core/tokenize.js';

/** How a query is treated by the search pipeline. */
export interface QueryClass {
  shape: 'symbol' | 'text';
  /** Present for symbol-shaped queries: the names to try in the symbol sidecar, most specific first. */
  names: string[];
}

/** A bare identifier: no dots, calls or punctuation. */
const IDENTIFIER = /^[\p{L}_$][\p{L}\p{N}_$]*$/u;

/**
 * `FeatureLayer queryFeatures` written with a space: a type followed by a member. Both words
 * must be identifiers and at least one must have inner capitals, so prose ("query layers")
 * is not mistaken for a name.
 */
function typeAndMember(query: string): string | undefined {
  const words = query.trim().split(/\s+/);
  if (words.length !== 2) return undefined;
  const [type = '', member = ''] = words;
  if (!IDENTIFIER.test(type) || !IDENTIFIER.test(member)) return undefined;
  if (!/^\p{Lu}/u.test(type) || !words.some((word) => isSymbolShaped(word))) return undefined;
  return `${type}.${member}`;
}

/**
 * Classifies a query. A symbol-shaped query yields its dotted name (`FeatureLayer.queryFeatures`)
 * and, when it is qualified, its last part (`queryFeatures`) as a second attempt. Two names
 * separated by a space yield only their dotted form: when that is not a known member the
 * query is searched as text.
 */
export function classifyQuery(query: string): QueryClass {
  if (!isSymbolShaped(query)) {
    const pair = typeAndMember(query);
    return pair === undefined ? { shape: 'text', names: [] } : { shape: 'symbol', names: [pair] };
  }
  const { parts, simple } = normalizeSymbol(query);
  if (simple === '') return { shape: 'text', names: [] };
  const joined = parts.join('.');
  return { shape: 'symbol', names: joined === simple ? [simple] : [joined, simple] };
}
