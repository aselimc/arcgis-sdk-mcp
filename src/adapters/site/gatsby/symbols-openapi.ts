/**
 * `symbols: 'openapi'`: service references generated from OpenAPI documents (places,
 * elevation, basemap styles, static tiles and maps). These sections publish no search store;
 * their navigation tree files each operation under the path it extends:
 *
 * ```
 * Requests
 *   /places
 *     /near-point      -> /places/near-point-get/
 *     /{placeId}       -> /places/place-id-get/
 *   /categories        -> /places/categories-get/
 * ```
 *
 * The page slug is the operation id in kebab case with the HTTP method last
 * (`near-point-get` is `nearPointGet`), which gives the symbol without opening the page.
 */
import { relativeTo } from './site.js';
import type { SymbolEntry, SymbolInput } from './symbols.js';

/** The last path segment of an operation page: `<name>-<method>`. */
const OPERATION_SLUG = /^([a-z0-9]+(?:-[a-z0-9]+)*)-(get|post|put|patch|delete|head|options)$/;

function camelCase(slug: string): string {
  return slug.replace(/-([a-z0-9])/g, (_whole, letter: string) => letter.toUpperCase());
}

/** Operation symbols read from the navigation trees of OpenAPI-generated sections. */
export function openapiSymbols(input: SymbolInput): SymbolEntry[] {
  const entries: SymbolEntry[] = [];
  for (const entry of input.nav) {
    const segments = (relativeTo(input.site.prefix, entry.url) ?? '')
      .split('/')
      .filter((segment) => segment !== '');
    const slug = segments.at(-1);
    const match = slug === undefined ? null : OPERATION_SLUG.exec(slug);
    const method = match?.[2];
    if (slug === undefined || method === undefined) continue;
    const operationId = camelCase(slug);
    const service = segments.length > 1 ? segments[0] : undefined;
    // Path pieces are the ancestors and the entry that are written as paths.
    const path = [...entry.crumbs, entry.title].filter((piece) => piece.startsWith('/')).join('');
    entries.push({
      url: entry.url,
      symbol: operationId,
      symbolKind: 'operation',
      qualified: service === undefined ? operationId : `${service}.${operationId}`,
      crumbs: entry.crumbs,
      ...(path === '' ? {} : { title: `${method.toUpperCase()} ${path}` }),
      locator: { operationId, method },
    });
  }
  return entries;
}
