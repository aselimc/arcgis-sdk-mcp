/**
 * The services package: everything between the MCP surface and the adapters. It receives
 * the context, the adapter registry and the version service, and never imports an adapter.
 */
import type { CreateServices } from '../core/factories.js';
import { createCatalogService } from './catalog.js';
import { createDocService } from './doc/service.js';
import { createIndexService } from './index/service.js';
import { createSampleService } from './sample/service.js';
import { createEsearchProvider } from './search/esearch/provider.js';
import { createSearchService } from './search/service.js';
import { createSymbolService } from './symbol/service.js';

/**
 * Builds the catalogue, index, search, document, symbol and sample services around one
 * shared index service. Construction does no I/O: indexes are loaded or built on first use.
 */
export const createServices: CreateServices = (ctx, adapters, versions) => {
  const index = createIndexService(ctx, adapters);
  return {
    catalog: createCatalogService(ctx, index),
    index,
    search: createSearchService({ ctx, index, versions, provider: createEsearchProvider(ctx) }),
    docs: createDocService(ctx, adapters, index),
    symbols: createSymbolService(ctx, adapters, index),
    samples: createSampleService(ctx, adapters, index),
  };
};
