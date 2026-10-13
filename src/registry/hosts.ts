/**
 * The host table (design section 4.7): every upstream host this server may contact, the
 * capability a request to it needs, and its quirks. A host that is not listed is never
 * fetched (`HOST_NOT_ALLOWED`); a host listed with capability `null` is link-only.
 *
 * `github.com` has no row on purpose: it is a ref format. Its URLs are rewritten to
 * `raw.githubusercontent.com` or `api.github.com` before any request.
 */
import type { Capability, HostPolicy } from '../core/types.js';

/** GitHub accounts whose repositories may be read (invariant INV-2). */
export const GITHUB_OWNERS = ['Esri', 'R-ArcGIS', 'koopjs'] as const;

/** Default limiter values of the gateway (design section 6.2). */
const DEFAULT_RATE = { ratePerSec: 2, maxConcurrent: 2 } as const;

type Quirks = Partial<Omit<HostPolicy, 'host' | 'capability' | 'revalidate'>>;

function host(
  name: string,
  capability: Capability | null,
  revalidate: HostPolicy['revalidate'],
  quirks: Quirks = {},
): HostPolicy {
  return { host: name, capability, revalidate, robotsDisallow: [], ...DEFAULT_RATE, ...quirks };
}

/** A host that is known but never fetched: requests answer `LINK_ONLY` with the URL. */
function linkOnly(name: string): HostPolicy {
  return host(name, null, 'none', { robotsDisallow: ['/'] });
}

/** Path prefixes on jsDelivr that hold Esri-published npm packages. */
const ESRI_NPM_PATHS = ['^/npm/@arcgis/', '^/npm/@esri/', '^/npm/esri-leaflet'];

/** The same packages on the jsDelivr metadata API (`/v1/packages/npm/<pkg>@<version>`). */
const ESRI_NPM_API_PATHS = [
  '^/v1/packages?/npm/@arcgis/',
  '^/v1/packages?/npm/@esri/',
  '^/v1/packages?/npm/esri-leaflet',
];

/** An Esri package name in a registry path; the scope separator may be percent-encoded. */
const ESRI_NPM_NAME = '(?:(?:@arcgis|@esri)(?:/|%2[fF])[^/]+|esri-leaflet[^/]*)';

/** npm metadata of Esri packages: dist-tags, and the manifest of a package or of one version. */
const NPM_METADATA_PATHS = [
  `^/-/package/${ESRI_NPM_NAME}/dist-tags$`,
  `^/${ESRI_NPM_NAME}(?:/[^/]+)?$`,
];

/** Every host row, in the order of design section 4.7. */
export const HOSTS: readonly HostPolicy[] = [
  host('developers.arcgis.com', 'website', 'etag', {
    robotsDisallow: ['/*?q=', '/search/', '/downloads', '/assets/js/config.js'],
    softNotFoundBytes: 5419,
    // These prefixes answer 200 text/html for any path, so a JSON or XML request that
    // comes back as HTML is a miss rather than a document.
    catchAllPrefixes: ['/dashboards/', '/downloads/', '/search/'],
  }),
  host('location.arcgis.com', 'website', 'etag'),
  host('doc.esri.com', 'website', 'last-modified', {
    robotsDisallow: ['/search/', '/*/config/'],
    bom: true,
  }),
  host('doc.arcgis.com', 'website', 'both', {
    robotsDisallow: ['/en/asset/', '/en/test/', '/js/'],
  }),
  host('pro.arcgis.com', 'website', 'both'),
  host('enterprise.arcgis.com', 'website', 'both'),
  host('support.esri.com', 'website', 'etag', { allowPaths: ['^/en-us/knowledge-base/'] }),
  host('esri.github.io', 'website', 'etag'),
  host('koopjs.github.io', 'website', 'etag'),
  host('r.esri.com', 'website', 'etag'),

  host('raw.githubusercontent.com', 'github', 'etag', { githubOwners: [...GITHUB_OWNERS] }),
  host('api.github.com', 'github', 'etag', { githubOwners: [...GITHUB_OWNERS] }),

  host('cdn.jsdelivr.net', 'package-cdn', 'none', { allowPaths: ESRI_NPM_PATHS }),
  host('data.jsdelivr.com', 'package-cdn', 'none', { allowPaths: ESRI_NPM_API_PATHS }),

  host('registry.npmjs.org', 'registries', 'none', { allowPaths: NPM_METADATA_PATHS }),
  host('pypi.org', 'registries', 'none', { allowPaths: ['^/pypi/[^/]+/json$'] }),
  host('api.nuget.org', 'registries', 'none', {
    allowPaths: ['^/v3-flatcontainer/[^/]+/index\\.json$'],
  }),
  host('pub.dev', 'registries', 'none', { allowPaths: ['^/api/packages/[^/]+$'] }),
  host('www.arcgis.com', 'registries', 'none', { allowPaths: ['^/sharing/rest/?$'] }),

  host('hub.arcgis.com', 'website', 'none', {
    allowPaths: ['^/api/.+/docs-json$', '^/api/.+/definition/swagger-ui-init\\.js$'],
    // robots.txt asks for `Crawl-delay: 60`.
    ratePerSec: 1 / 60,
    maxConcurrent: 1,
    minIntervalMs: 60_000,
  }),
  host('sitescan-api.arcgis.com', 'website', 'none', {
    allowPaths: ['^/api/v2/apidocs\\.json$'],
  }),

  host('esearchapi.esri.com', 'site-search', 'none', {
    allowPaths: ['^/search$'],
    ratePerSec: 1,
    maxConcurrent: 1,
    minIntervalMs: 1000,
    timeoutMs: 12_000,
  }),
  host('plc-api.esri.com', 'lifecycle-api', 'none', { allowPaths: ['^/api/PLC$'] }),

  linkOnly('archive.developers.arcgis.com'),
  linkOnly('desktop.arcgis.com'),
];
