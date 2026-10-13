import type { OracleSpec, OracleType, Product, VersionLine } from '../../src/core/types.js';
import { makeLine, makeProduct } from '../support/builders.js';

/**
 * Test products shaped like the registry entries the version rules were written for. The
 * oracle specs use the option keys the registry data uses.
 */
const D = 'https://developers.arcgis.com';

/** An oracle spec with the given options. */
export function spec(
  type: OracleType,
  options: Record<string, string> = {},
  provides: OracleSpec['provides'] = [],
): OracleSpec {
  return { type, options, provides };
}

const banner = (path: string): OracleSpec =>
  spec('page-regex', { url: `${D}${path}` }, ['documented', 'released']);

export const LINE_300: VersionLine = makeLine({ id: 'latest', label: '300.x' });
export const LINE_200: VersionLine = makeLine({
  id: 'v200',
  label: '200.x LTS',
  current: false,
  vars: { prefix: 'v200/' },
});

export const jsProduct: Product = makeProduct({
  id: 'js-maps-sdk',
  name: 'ArcGIS Maps SDK for JavaScript',
  aliases: ['javascript', 'js', '@arcgis/core'],
  homepage: `${D}/javascript/latest/`,
  packages: [
    { registry: 'npm', name: '@arcgis/core', license: 'esri-ma', primary: true },
    { registry: 'npm', name: '@arcgis/map-components', license: 'esri-ma' },
  ],
  oracles: [
    spec('npm-dist-tags', { package: '@arcgis/core' }, ['installable', 'prerelease']),
    banner('/javascript/latest/'),
  ],
  compatibility: [{ name: 'Version matrix', url: `${D}/javascript/latest/version-matrix/` }],
  releaseNotes: { current: `${D}/javascript/latest/release-notes/` },
});

/** Documented 2.4.4, PyPI 2.4.3, GitHub release 2.4.4: the first merge case of the design. */
export const pythonProduct: Product = makeProduct({
  id: 'python-api',
  name: 'ArcGIS API for Python',
  aliases: ['python', 'arcgis'],
  homepage: `${D}/python/latest/`,
  packages: [{ registry: 'pypi', name: 'arcgis', license: 'apache-2.0', primary: true }],
  oracles: [
    spec('pypi', { package: 'arcgis' }, ['installable']),
    banner('/python/latest/'),
    spec('github-release', { repo: 'Esri/arcgis-python-api' }, ['released']),
  ],
  releaseNotes: {
    pattern: '/guide/release-notes-(\\d+)/$',
    sitemapFilter: '/guide/release-notes-\\d+/',
  },
});

/** npm `latest` 4.11.0 below `lts-v4.x` 4.11.1: the second merge case of the design. */
export const restJsProduct: Product = makeProduct({
  id: 'rest-js',
  name: 'ArcGIS REST JS',
  aliases: ['arcgis-rest-js'],
  homepage: `${D}/arcgis-rest-js/`,
  packages: [
    { registry: 'npm', name: '@esri/arcgis-rest-request', license: 'apache-2.0', primary: true },
  ],
  oracles: [
    spec('npm-dist-tags', { package: '@esri/arcgis-rest-request', tags: 'latest,lts-*' }, [
      'installable',
      'prerelease',
    ]),
  ],
  releaseNotes: { current: `${D}/arcgis-rest-js/release-notes/` },
});

export const dotnetProduct: Product = makeProduct({
  id: 'dotnet-maps-sdk',
  name: 'ArcGIS Maps SDK for .NET',
  aliases: ['net', 'dotnet'],
  homepage: `${D}/net/`,
  packages: [{ registry: 'nuget', name: 'Esri.ArcGISRuntime', license: 'esri-ma', primary: true }],
  lines: [LINE_300, LINE_200],
  oracles: [banner('/net/'), spec('nuget-flat', { id: 'esri.arcgisruntime' }, ['installable'])],
  releaseNotes: {
    current: `${D}/net/release-notes/`,
    pattern: '/release-notes/(?:prior-releases/)?release-notes-for-(\\d+-\\d+)/$',
    sitemapFilter: '/release-notes/',
  },
});

export const javaProduct: Product = makeProduct({
  id: 'java-maps-sdk',
  name: 'ArcGIS Maps SDK for Java',
  aliases: ['java'],
  status: 'deprecated',
  statusNote: 'Final release 200.6',
  successor: 'dotnet-maps-sdk',
  homepage: `${D}/java/v200/`,
  oracles: [
    spec('static', { version: '200.6', ga: '2024-11-25', retirement: '2028-11-25' }, [
      'documented',
      'lifecycle',
    ]),
  ],
});
