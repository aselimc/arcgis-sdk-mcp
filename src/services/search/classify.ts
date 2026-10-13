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

/**
 * Classifies a query. A symbol-shaped query yields its dotted name (`FeatureLayer.queryFeatures`)
 * and, when it is qualified, its last part (`queryFeatures`) as a second attempt.
 */
export function classifyQuery(query: string): QueryClass {
  if (!isSymbolShaped(query)) return { shape: 'text', names: [] };
  const { parts, simple } = normalizeSymbol(query);
  if (simple === '') return { shape: 'text', names: [] };
  const joined = parts.join('.');
  return { shape: 'symbol', names: joined === simple ? [simple] : [joined, simple] };
}
