/**
 * Public entry point of the site adapters: the adapters that read Esri's
 * documentation websites and the content bundled with this server.
 */
import type { SourceAdapter } from '../../core/ports.js';
import { astroAdapter } from './astro.js';
import { briefAdapter } from './brief.js';
import { docfxEsriAdapter } from './docfx-esri.js';
import { gatsbyAdapter } from './gatsby/index.js';
import { legacyHelpAdapter } from './legacy-help.js';
import { openapiAdapter } from './openapi.js';
import { sitemapAdapter } from './sitemap.js';
import { staticAdapter } from './static.js';

/**
 * Every site adapter, one per adapter type: `astro`, `gatsby`, `docfx-esri`, `legacy-help`,
 * `sitemap`, `static`, `brief` and `openapi`. Adapters are stateless values, so the same
 * instances are returned on every call; the composition root hands them to the adapter
 * registry together with the reference adapters.
 */
export function siteAdapters(): SourceAdapter[] {
  return [
    astroAdapter,
    gatsbyAdapter,
    docfxEsriAdapter,
    legacyHelpAdapter,
    sitemapAdapter,
    staticAdapter,
    briefAdapter,
    openapiAdapter,
  ];
}
