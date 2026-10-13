/**
 * What a search with no hits tells the agent (design section 3.4): where else to look, how
 * to widen the search, and that absence is not proof.
 */
import type { Ctx, SearchRequest } from '../../core/ports.js';
import type { IndexInternals } from '../index/types.js';

/** Products the router is asked for when looking for a neighbour of the searched scope. */
const NEIGHBOUR_CANDIDATES = 5;

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
    notes.push('No product matched the query. Pass "product", or call arcgis_docs_list_products to find its id.');
  }

  const neighbour = ctx.registry
    .route(req.query, NEIGHBOUR_CANDIDATES)
    .find((candidate) => !products.includes(candidate.product));
  if (neighbour !== undefined) {
    notes.push(`Nearest other product for this query: ${neighbour.product}.`);
  }

  if (req.kind !== undefined && products.length > 0) {
    const anyKind = index.query({ text: req.query, products: [...products], limit: 1, offset: 0 });
    const other = anyKind.hits[0]?.kind;
    if (other !== undefined) {
      notes.push(`Other content types have hits: repeat without "kind", or with kind "${other}".`);
    }
  }

  if (!siteSearch) {
    notes.push(
      'Titles, headings, keywords, descriptions and symbol names are searched, not page text. Full-text site search is off; enable it with ARCGIS_DOCS_SOURCES=+site-search.',
    );
  }
  notes.push('No hit means not verified here; it does not prove that the feature does not exist.');
  return notes;
}
