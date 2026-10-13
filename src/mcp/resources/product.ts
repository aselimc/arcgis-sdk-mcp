/**
 * Resource template `arcgis-docs://product/{id}`: one product profile as Markdown.
 */
import {
  type McpServer,
  ResourceNotFoundError,
  ResourceTemplate,
} from '@modelcontextprotocol/server';
import { isMcpDocError } from '../../core/errors.js';
import { RESOURCE_SCHEME } from '../../core/names.js';
import { STATIC_RESOURCE_CACHE } from '../annotations.js';
import type { McpContainer } from '../container.js';
import { profileOf, renderProfile } from '../presenters/product.js';

/** URI template of the product resource. */
export const PRODUCT_URI_TEMPLATE = `${RESOURCE_SCHEME}://product/{id}`;

/** The protocol caps one completion response at this many values. */
const MAX_COMPLETIONS = 100;

/**
 * Registers the product resource. It is not listed (about 135 products would drown a
 * resource picker); `id` completes from the registry instead.
 */
export function registerProductResource(server: McpServer, container: McpContainer): void {
  const { ctx } = container;
  const template = new ResourceTemplate(PRODUCT_URI_TEMPLATE, {
    list: undefined,
    complete: {
      id: (value) => {
        const prefix = value.toLowerCase();
        return ctx.registry
          .all()
          .map((product) => product.id)
          .filter((id) => id.startsWith(prefix))
          .slice(0, MAX_COMPLETIONS);
      },
    },
  });
  server.registerResource(
    'product',
    template,
    {
      title: 'ArcGIS product profile',
      description:
        'What one product is: packages, version lines, documentation sources, start-here links and known pitfalls. `id` is a product id from the catalog.',
      mimeType: 'text/markdown',
      cacheHint: STATIC_RESOURCE_CACHE,
    },
    (uri, variables) => {
      const id = decodeURIComponent([variables.id].flat()[0] ?? '');
      try {
        const { resolution, health } = container.services.catalog.profile(id);
        const profile = profileOf(resolution.product, health, ctx.policy);
        return {
          contents: [{ uri: uri.href, mimeType: 'text/markdown', text: renderProfile(profile) }],
        };
      } catch (error) {
        if (isMcpDocError(error) && error.code === 'UNKNOWN_PRODUCT') {
          const nearest = error.details?.candidates?.slice(0, 5).join(', ');
          throw new ResourceNotFoundError(
            uri.href,
            `Unknown product "${id}"${nearest ? `. Nearest ids: ${nearest}` : ''}`,
          );
        }
        throw error;
      }
    },
  );
}
