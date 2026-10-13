import { describe, expect, it } from 'vitest';
import { CAPABILITIES, PRESETS } from '../../src/core/capabilities.js';
import type { HostPolicy } from '../../src/core/types.js';
import { ESRI_UNSCOPED_NPM_PACKAGES, GITHUB_OWNERS, HOSTS } from '../../src/registry/hosts.js';
import { createRegistry } from '../../src/registry/index.js';
import { hostPolicySchema } from '../../src/registry/schema.js';

function row(host: string): HostPolicy {
  const found = HOSTS.find((candidate) => candidate.host === host);
  if (found === undefined) throw new Error(`no host row for ${host}`);
  return found;
}

function allows(host: string, path: string): boolean {
  const paths = row(host).allowPaths;
  return paths === undefined || paths.some((source) => new RegExp(source).test(path));
}

/** `[host, capability]` for every row of design section 4.7. */
const TABLE: Array<[string, HostPolicy['capability']]> = [
  ['developers.arcgis.com', 'website'],
  ['location.arcgis.com', 'website'],
  ['doc.esri.com', 'website'],
  ['doc.arcgis.com', 'website'],
  ['pro.arcgis.com', 'website'],
  ['enterprise.arcgis.com', 'website'],
  ['support.esri.com', 'website'],
  ['esri.github.io', 'website'],
  ['koopjs.github.io', 'website'],
  ['r.esri.com', 'website'],
  ['raw.githubusercontent.com', 'github'],
  ['api.github.com', 'github'],
  ['cdn.jsdelivr.net', 'package-cdn'],
  ['data.jsdelivr.com', 'package-cdn'],
  ['registry.npmjs.org', 'registries'],
  ['pypi.org', 'registries'],
  ['api.nuget.org', 'registries'],
  ['pub.dev', 'registries'],
  ['www.arcgis.com', 'registries'],
  ['hub.arcgis.com', 'website'],
  ['sitescan-api.arcgis.com', 'website'],
  ['esearchapi.esri.com', 'site-search'],
  ['plc-api.esri.com', 'lifecycle-api'],
  ['archive.developers.arcgis.com', null],
  ['desktop.arcgis.com', null],
];

describe('HOSTS', () => {
  it('holds exactly the hosts of the design, each once', () => {
    expect(HOSTS.map((host) => host.host).sort()).toEqual(TABLE.map(([host]) => host).sort());
  });

  it.each(TABLE)('%s needs capability %s', (host, capability) => {
    expect(row(host).capability).toBe(capability);
  });

  it('matches the schema and uses known capabilities', () => {
    for (const host of HOSTS) {
      expect(hostPolicySchema.safeParse(host).error?.issues ?? [], host.host).toEqual([]);
      if (host.capability !== null) expect(CAPABILITIES).toContain(host.capability);
    }
  });

  it('never lists hosts that must stay unreachable, nor github.com', () => {
    const hosts = HOSTS.map((host) => host.host);
    for (const forbidden of [
      'github.com',
      'esri.jfrog.io',
      'aiservices-beta.arcgis.com',
      'inspector.pypi.io',
      'community.esri.com',
      'www.esri.com',
    ]) {
      expect(hosts).not.toContain(forbidden);
    }
  });

  it('keeps opt-in hosts out of every preset', () => {
    const optIn = HOSTS.filter(
      (host) => host.capability === 'site-search' || host.capability === 'lifecycle-api',
    ).map((host) => host.host);
    expect(optIn).toEqual(['esearchapi.esri.com', 'plc-api.esri.com']);
    for (const preset of Object.values(PRESETS)) {
      expect(preset).not.toContain('site-search');
      expect(preset).not.toContain('lifecycle-api');
    }
  });

  it('marks link-only hosts as fully disallowed', () => {
    for (const host of HOSTS.filter((candidate) => candidate.capability === null)) {
      expect(host.robotsDisallow).toEqual(['/']);
    }
  });

  it('records the revalidation rule and quirks of each documentation host', () => {
    expect(row('developers.arcgis.com')).toMatchObject({
      revalidate: 'etag',
      softNotFoundBytes: 5419,
      robotsDisallow: ['/*?q=', '/search/', '/downloads', '/assets/js/config.js'],
    });
    expect(row('developers.arcgis.com').catchAllPrefixes).toContain('/dashboards/');
    expect(row('doc.esri.com')).toMatchObject({
      revalidate: 'last-modified',
      bom: true,
      robotsDisallow: ['/search/', '/*/config/'],
    });
    expect(row('doc.arcgis.com')).toMatchObject({
      revalidate: 'both',
      robotsDisallow: ['/en/asset/', '/en/test/', '/js/'],
    });
    expect(row('pro.arcgis.com').revalidate).toBe('both');
    expect(row('enterprise.arcgis.com').revalidate).toBe('both');
    expect(row('support.esri.com').revalidate).toBe('etag');
  });

  it('rate-limits the hosts that ask for it', () => {
    expect(row('hub.arcgis.com')).toMatchObject({ maxConcurrent: 1, minIntervalMs: 60_000 });
    expect(row('hub.arcgis.com').ratePerSec).toBeCloseTo(1 / 60);
    expect(row('esearchapi.esri.com')).toMatchObject({
      maxConcurrent: 1,
      minIntervalMs: 1000,
      timeoutMs: 12_000,
    });
    expect(row('developers.arcgis.com')).toMatchObject({ ratePerSec: 2, maxConcurrent: 2 });
  });

  it('restricts GitHub to the three owners', () => {
    expect([...GITHUB_OWNERS]).toEqual(['Esri', 'R-ArcGIS', 'koopjs']);
    expect(row('raw.githubusercontent.com').githubOwners).toEqual([...GITHUB_OWNERS]);
    expect(row('api.github.com').githubOwners).toEqual([...GITHUB_OWNERS]);
  });

  /** `[host, path, allowed]`. */
  const PATHS: Array<[string, string, boolean]> = [
    ['support.esri.com', '/en-us/knowledge-base/some-article-000012345', true],
    ['support.esri.com', '/en-us/contact', false],
    ['cdn.jsdelivr.net', '/npm/@arcgis/core@5.1.0/layers/FeatureLayer.d.ts', true],
    ['cdn.jsdelivr.net', '/npm/@esri/calcite-components@5.1.2/dist/docs/api.json', true],
    ['cdn.jsdelivr.net', '/npm/esri-leaflet@3.0.0/package.json', true],
    ['cdn.jsdelivr.net', '/npm/esri-leaflet/dist/esri-leaflet.js', true],
    ['cdn.jsdelivr.net', '/npm/esri-leaflet', true],
    ['cdn.jsdelivr.net', '/npm/esri-leaflet-vector@4.3.2/package.json', true],
    ['cdn.jsdelivr.net', '/npm/esri-leaflet-geocoder@3.1.7/README.md', true],
    // Regression: `esri-leaflet` is not a scope. Anyone can publish `esri-leaflet-<x>`, and
    // the prefix admitted every such package as "an Esri npm package".
    ['cdn.jsdelivr.net', '/npm/esri-leaflet-evil@1.0.0/x.html', false],
    ['cdn.jsdelivr.net', '/npm/esri-leaflet-legend@2.0.1/example/featureserver.html', false],
    ['cdn.jsdelivr.net', '/npm/esri-leaflet-webmap@0.4.0/index.html', false],
    ['cdn.jsdelivr.net', '/npm/esri-leafletx@1.0.0/x.html', false],
    ['cdn.jsdelivr.net', '/npm/esri-leaflet-vector-evil@1.0.0/x.js', false],
    ['cdn.jsdelivr.net', '/npm/leaflet@1.9.4/README.md', false],
    ['cdn.jsdelivr.net', '/npm/react@19.0.0/index.js', false],
    ['cdn.jsdelivr.net', '/gh/Esri/arcgis-rest-js@main/README.md', false],
    ['data.jsdelivr.com', '/v1/packages/npm/@arcgis/core@5.1.0', true],
    ['data.jsdelivr.com', '/v1/packages/npm/react@19.0.0', false],
    ['data.jsdelivr.com', '/v1/packages/npm/esri-leaflet@3.0.0', true],
    ['data.jsdelivr.com', '/v1/package/npm/esri-leaflet-vector@4.3.2/flat', true],
    ['data.jsdelivr.com', '/v1/packages/npm/esri-leaflet-evil@1.0.0', false],
    ['data.jsdelivr.com', '/v1/packages/npm/esri-leaflet-evil-package@1.0.0/flat', false],
    ['registry.npmjs.org', '/-/package/@arcgis/core/dist-tags', true],
    ['registry.npmjs.org', '/-/package/@esri%2farcgis-rest-request/dist-tags', true],
    ['registry.npmjs.org', '/-/package/esri-leaflet/dist-tags', true],
    ['registry.npmjs.org', '/-/package/esri-leaflet-vector/dist-tags', true],
    ['registry.npmjs.org', '/esri-leaflet-geocoder/latest', true],
    ['registry.npmjs.org', '/-/package/esri-leaflet-evil/dist-tags', false],
    ['registry.npmjs.org', '/esri-leaflet-evil', false],
    ['registry.npmjs.org', '/esri-leaflet-anything-goes', false],
    ['registry.npmjs.org', '/esri-leaflet-webmap/0.4.0', false],
    ['registry.npmjs.org', '/@arcgis/core/5.1.0', true],
    ['registry.npmjs.org', '/-/package/react/dist-tags', false],
    ['registry.npmjs.org', '/-/v1/search', false],
    ['pypi.org', '/pypi/arcgis/json', true],
    ['pypi.org', '/simple/arcgis/', false],
    ['api.nuget.org', '/v3-flatcontainer/esri.arcgisruntime/index.json', true],
    [
      'api.nuget.org',
      '/v3-flatcontainer/esri.arcgisruntime/300.1.0/esri.arcgisruntime.300.1.0.nupkg',
      false,
    ],
    ['pub.dev', '/api/packages/arcgis_maps', true],
    ['pub.dev', '/packages/arcgis_maps/versions/300.1.0.tar.gz', false],
    ['www.arcgis.com', '/sharing/rest', true],
    ['www.arcgis.com', '/sharing/rest/content/items/abc', false],
    ['hub.arcgis.com', '/api/events/v1/docs-json', true],
    ['hub.arcgis.com', '/api/search/definition/swagger-ui-init.js', true],
    ['hub.arcgis.com', '/api/v3/datasets', false],
    ['sitescan-api.arcgis.com', '/api/v2/apidocs.json', true],
    ['sitescan-api.arcgis.com', '/api/v2/missions', false],
    ['esearchapi.esri.com', '/search', true],
    ['esearchapi.esri.com', '/suggest', false],
    ['plc-api.esri.com', '/api/PLC', true],
    ['plc-api.esri.com', '/api/other', false],
    ['developers.arcgis.com', '/any/path/', true],
  ];

  it.each(PATHS)('%s%s allowed: %s', (host, path, allowed) => {
    expect(allows(host, path)).toBe(allowed);
  });
});

describe('Esri npm packages', () => {
  const npmPackages = createRegistry()
    .all()
    .flatMap((product) => product.packages)
    .filter((ref) => ref.registry === 'npm')
    .map((ref) => ref.name);

  it('lists by name exactly the unscoped npm packages the registry declares', () => {
    const unscoped = [...new Set(npmPackages.filter((name) => !name.startsWith('@')))];
    expect(unscoped.sort()).toEqual([...ESRI_UNSCOPED_NPM_PACKAGES].sort());
  });

  it('allows the registry metadata and a CDN file of every npm package the registry declares', () => {
    for (const name of npmPackages) {
      expect(allows('registry.npmjs.org', `/-/package/${name}/dist-tags`), name).toBe(true);
      expect(allows('cdn.jsdelivr.net', `/npm/${name}@1.0.0/package.json`), name).toBe(true);
      expect(allows('data.jsdelivr.com', `/v1/packages/npm/${name}@1.0.0`), name).toBe(true);
    }
  });

  it('declares scoped packages under the two scopes Esri owns only', () => {
    for (const name of npmPackages.filter((candidate) => candidate.startsWith('@'))) {
      expect(name).toMatch(/^@(?:arcgis|esri)\//);
    }
  });
});
