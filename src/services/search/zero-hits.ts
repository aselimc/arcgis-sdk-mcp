/**
 * What a search with no hits tells the agent: where else to look, how
 * to widen the search, and that absence is not proof.
 */
import { formatCall } from '../../core/budget.js';
import { TOOLS } from '../../core/names.js';
import type { Ctx, SearchRequest } from '../../core/ports.js';
import type { IndexInternals } from '../index/types.js';

/** Products the router is asked for when looking for a neighbour of the searched scope. */
const NEIGHBOUR_CANDIDATES = 5;

/** Below this the router matched a stray word, which is no reason to name a product. */
const MIN_NEIGHBOUR_CONFIDENCE = 0.3;

/**
 * The product to try next: among the router's guesses for the query, one that the registry
 * relates to a searched product. An unrelated guess is not named. The router weighs single
 * words, and "route" pointing a Flutter question at the R bridge helps nobody.
 */
function neighbourOf(
  ctx: Ctx,
  req: SearchRequest,
  products: readonly string[],
): string | undefined {
  const guesses = ctx.registry
    .route(req.query, NEIGHBOUR_CANDIDATES)
    .filter((candidate) => candidate.confidence >= MIN_NEIGHBOUR_CONFIDENCE)
    .map((candidate) => candidate.product)
    .filter((id) => !products.includes(id));
  if (products.length === 0) return guesses[0];
  const related = new Set(products.flatMap((id) => ctx.registry.get(id)?.related ?? []));
  return guesses.find(
    (id) =>
      related.has(id) ||
      (ctx.registry.get(id)?.related ?? []).some((other) => products.includes(other)),
  );
}

/** The notes of a zero-hit result, most actionable first. */
export function zeroHitNotes(
  ctx: Ctx,
  index: IndexInternals,
  req: SearchRequest,
  products: readonly string[],
  siteSearch: boolean,
): string[] {
  const notes: string[] = [];
  if (products.length === 0) {
    notes.push(
      'No product matched the query. Pass "product", or call arcgis_docs_list_products to find its id.',
    );
  }

  // The same search without the filter is the cheapest way on, so it goes first, as a call.
  if (req.kind !== undefined && products.length > 0) {
    const anyKind = index.query({ text: req.query, products: [...products], limit: 1, offset: 0 });
    const other = anyKind.hits[0]?.kind;
    if (other !== undefined) {
      const wider = formatCall(TOOLS.search, {
        query: req.query,
        product: req.product,
        version: req.version,
      });
      notes.push(
        `Other content types have hits (the best is a "${other}" page): repeat without "kind", ${wider}.`,
      );
    }
  }

  const neighbour = neighbourOf(ctx, req, products);
  if (neighbour !== undefined) {
    notes.push(`Nearest other product for this query: ${neighbour}.`);
  }

  if (!siteSearch) {
    notes.push(
      'Titles, headings, keywords, descriptions and symbol names are searched, not page text. Full-text site search is off; enable it with ARCGIS_DOCS_SOURCES=+site-search.',
    );
  }
  notes.push('No hit means not verified here; it does not prove that the feature does not exist.');
  return notes;
}
