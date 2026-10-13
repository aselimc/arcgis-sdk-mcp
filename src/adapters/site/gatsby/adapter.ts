/**
 * The `gatsby` adapter: Esri's Gatsby-built documentation sites (the REST references, the
 * developer guide, ArcGIS REST JS, Experience Builder, the Python API, the game-engine SDKs
 * and others). One implementation serves them all; what differs per site is configuration
 * (`symbols`, `bodyFrom`, URL filters) and what the site's index files turn out to contain.
 *
 * - `enumerate`: sitemap plus the index files found through page-data (`enumerate.ts`);
 * - `read`: the body from page-data where a page has one, else the HTML page (`read.ts`);
 * - `symbol`: the record's page, sliced to the member or section the record points at;
 * - `probe`: the canary declared in the registry.
 */
import { toMcpDocError } from '../../../core/errors.js';
import type { SourceAdapter } from '../../../core/ports.js';
import { probeSource } from '../static.js';
import { MAX_ENUMERATE_REQUESTS, enumerateGatsby } from './enumerate.js';
import { readGatsby, symbolGatsby } from './read.js';

/**
 * Runs adapter work so that only `McpDocError` leaves the adapter: an unexpected exception
 * (a defect, or JSON of a shape nothing anticipated) becomes `INTERNAL` with the cause attached.
 */
async function typed<V>(work: () => Promise<V>): Promise<V> {
  try {
    return await work();
  } catch (error) {
    throw toMcpDocError(error);
  }
}

/** Source adapter for Gatsby documentation sites. Stateless; all state lives in `Ctx`. */
export const gatsbyAdapter: SourceAdapter<'gatsby'> = {
  type: 'gatsby',
  maxEnumerateRequests: MAX_ENUMERATE_REQUESTS,
  enumerate: (ctx, src) => typed(() => enumerateGatsby(ctx, src)),
  read: (ctx, src, target) => typed(() => readGatsby(ctx, src, target)),
  symbol: (ctx, src, record, detail) => typed(() => symbolGatsby(ctx, src, record, detail)),
  probe: (ctx, src) => probeSource(ctx, src),
};
