/**
 * The call that turns free text into a few candidate products.
 *
 * `arcgis_docs_list_products` ranks the products that share a word with `query`, best first,
 * and a sentence shares a word with most of the catalogue. Wherever this server suggests
 * that call itself (a recovery, a prompt step) it therefore asks for a short page: the
 * likely products for a few hundred tokens, with a cursor for the rest.
 */
import { formatCall } from '../core/budget.js';
import { TOOLS } from '../core/names.js';

/** Products on the suggested page: enough to hold the right one, few enough to read. */
export const SHORTLIST_SIZE = 8;

/** `arcgis_docs_list_products` for the best matches of `query`. */
export function productShortlist(query: string): string {
  return formatCall(TOOLS.listProducts, { query, limit: SHORTLIST_SIZE });
}
