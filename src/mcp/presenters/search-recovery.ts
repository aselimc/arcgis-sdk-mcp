/**
 * The `Next:` call of a search without hits (design sections 3.1 and 3.4): a call that
 * makes progress. Each step looks somewhere the failed search did not, and no step leads
 * back to an earlier one, so following `Next:` lines cannot go round in a circle.
 */
import { formatCall } from '../../core/budget.js';
import { TOOLS } from '../../core/names.js';
import type { SearchResponse } from '../../core/ports.js';
import type { McpContainer } from '../container.js';
import { productShortlist } from '../shortlist.js';

/** Products the router is asked for when looking for one outside the searched scope. */
const NEIGHBOUR_CANDIDATES = 5;

/** The arguments of the failed search that a wider search repeats. */
export interface FailedSearch {
  query: string;
  /** The caller's `product` argument; absent when the scope was chosen for the caller. */
  product?: string;
  kind?: string;
  version?: string;
  /** Present when the caller chose a page size. */
  limit?: number;
}

/**
 * The follow-up of a search that found nothing, most specific first:
 *
 * 1. `kind` hid hits of another content type in the same scope: the same search without it.
 * 2. The scope was chosen from the query: the same search in the nearest product outside it.
 * 3. The caller named the product: its profile, which lists the sources that can be browsed
 *    and whether full-text search is available. (Offering another product here would let two
 *    products point at each other.)
 * 4. No product at all: the products that best match the query.
 */
export function zeroHitNext(
  failed: FailedSearch,
  scope: SearchResponse['scope'],
  { ctx, services }: McpContainer,
): string {
  const { query, product, kind, version, limit } = failed;
  const size = limit === undefined ? {} : { limit };
  if (kind !== undefined && scope.products.length > 0) {
    const anyKind = services.index.query({
      text: query,
      products: [...scope.products],
      ...(scope.sources === undefined ? {} : { sources: [...scope.sources] }),
      limit: 1,
      offset: 0,
    });
    if (anyKind.hits.length > 0) {
      return formatCall(TOOLS.search, {
        query,
        ...(product === undefined ? {} : { product }),
        ...(version === undefined ? {} : { version }),
        ...size,
      });
    }
  }
  if (product === undefined) {
    const neighbour = ctx.registry
      .route(query, NEIGHBOUR_CANDIDATES)
      .find((candidate) => !scope.products.includes(candidate.product));
    if (neighbour !== undefined) {
      // A version line belongs to the product it was given for, so it is not carried over.
      return formatCall(TOOLS.search, {
        query,
        product: neighbour.product,
        ...(kind === undefined ? {} : { kind }),
        ...size,
      });
    }
  }
  const [named] = scope.products;
  return product !== undefined && named !== undefined
    ? formatCall(TOOLS.listProducts, { product: named })
    : productShortlist(query);
}
