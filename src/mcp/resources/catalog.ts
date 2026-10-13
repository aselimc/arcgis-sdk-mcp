/**
 * Resource `arcgis-docs://catalog`: every product of the registry as JSON, for hosts that
 * attach context instead of calling `arcgis_docs_list_products`.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import { RESOURCE_SCHEME } from '../../core/names.js';
import { STATIC_RESOURCE_CACHE } from '../annotations.js';
import type { McpContainer } from '../container.js';
import { productRow } from '../presenters/product.js';

/** URI of the catalog resource. */
export const CATALOG_URI = `${RESOURCE_SCHEME}://catalog`;

/** Registers the catalog resource. Pure registry data: reading it issues no request. */
export function registerCatalogResource(server: McpServer, { ctx }: McpContainer): void {
  server.registerResource(
    'catalog',
    CATALOG_URI,
    {
      title: 'ArcGIS product catalog',
      description:
        'Every ArcGIS product this server knows, in all categories, with id, name, category, status, current version line and a one-line summary.',
      mimeType: 'application/json',
      cacheHint: STATIC_RESOURCE_CACHE,
    },
    (uri) => {
      const products = ctx.registry.all().map(productRow);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ total: products.length, products }, null, 2),
          },
        ],
      };
    },
  );
}
