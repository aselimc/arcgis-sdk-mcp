/**
 * Reciprocal rank fusion: merges ranked lists from independent retrievers (symbol sidecar,
 * catalogue index, body index, optional site search) without needing comparable scores.
 */
import type { SearchHit } from './types.js';

/**
 * True when `candidate`, a later copy of the hit `current` (same ref), should give the fused
 * hit its identity: the source, title and licence it is reported under. The search service
 * prefers the primary of two sources of one product that list the same page.
 */
export type PreferCopy = (candidate: SearchHit, current: SearchHit) => boolean;

/** Takes the identity of `copy` into `fused`, keeping its score, match label and excerpt. */
function adopt(fused: SearchHit, copy: SearchHit): void {
  const { score, match } = fused;
  const excerpt = fused.excerpt ?? copy.excerpt;
  const breadcrumb = copy.breadcrumb ?? fused.breadcrumb;
  const version = copy.version ?? fused.version;
  Object.assign(fused, copy, { score, match });
  if (excerpt !== undefined) fused.excerpt = excerpt;
  if (breadcrumb !== undefined) fused.breadcrumb = breadcrumb;
  if (version !== undefined) fused.version = version;
}

/**
 * Fuses ranked hit lists into one list ordered by `sum(1 / (k + rank))`.
 *
 * Hits are identified by `ref`. The fused hit is the copy from the first list that contains
 * it (lists are passed most-trusted first, so its `match` label and excerpt win), with any
 * `excerpt`, `breadcrumb` or `version` it lacks filled from later copies. `score` is replaced
 * by the fused score. Ties keep first-seen order; the inputs are not modified.
 *
 * When `prefer` accepts a later copy (from any list, the same one included), the fused hit
 * takes that copy's identity but keeps its score, match label and excerpt; a copy within one
 * list still does not vote twice.
 *
 * @param k rank damping constant; 60 is the value from the original RRF paper.
 */
export function rrf(lists: SearchHit[][], k = 60, prefer?: PreferCopy): SearchHit[] {
  const fused = new Map<string, SearchHit>();
  for (const list of lists) {
    const ranked = new Set<string>();
    let rank = 0;
    for (const hit of list) {
      const existing = fused.get(hit.ref);
      if (existing !== undefined && prefer?.(hit, existing) === true) adopt(existing, hit);
      // A retriever that returns the same ref twice must not vote twice.
      if (ranked.has(hit.ref)) continue;
      ranked.add(hit.ref);
      rank += 1;
      const contribution = 1 / (k + rank);
      if (existing === undefined) {
        fused.set(hit.ref, { ...hit, score: contribution });
        continue;
      }
      existing.score += contribution;
      if (existing.excerpt === undefined && hit.excerpt !== undefined) {
        existing.excerpt = hit.excerpt;
      }
      if (existing.breadcrumb === undefined && hit.breadcrumb !== undefined) {
        existing.breadcrumb = hit.breadcrumb;
      }
      if (existing.version === undefined && hit.version !== undefined) {
        existing.version = hit.version;
      }
    }
  }
  // Array.prototype.sort is stable, so equal scores keep insertion (first-seen) order.
  return [...fused.values()].sort((a, b) => b.score - a.score);
}
