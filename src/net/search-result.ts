/**
 * What an answer of the `remote-search` TTL class amounts to (design section 6.2: "24 h,
 * zero hits 1 h, errors never"). The class has one member, the Esri site search
 * (`esearchapi.esri.com`), which answers HTTP 200 with `{ "search": { "hits": [...] } }`
 * and has been seen to answer 200 with `{ "error": {...} }` when it is overloaded.
 *
 * The gateway has to judge the body itself: it stores the response before the search
 * provider sees it, and an error object remembered for a day fails that query for a day.
 */

/** `hits`: a result list; `empty`: a result list without entries; `error`: not a result. */
export type SearchOutcome = 'hits' | 'empty' | 'error';

/** Classifies the JSON text of a remote search answer. Anything unrecognised is `error`. */
export function searchOutcome(body: string): SearchOutcome {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return 'error';
  }
  if (typeof data !== 'object' || data === null) return 'error';
  const { search, error } = data as { search?: unknown; error?: unknown };
  if (error !== undefined || typeof search !== 'object' || search === null) return 'error';
  const { hits } = search as { hits?: unknown };
  if (!Array.isArray(hits)) return 'error';
  return hits.length === 0 ? 'empty' : 'hits';
}
