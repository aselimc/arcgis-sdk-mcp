/**
 * Registry data: specifications and formats published as GitHub repositories (design
 * section 4.5). Every product has one floor source read as Markdown. The licence tier is the
 * one found in the repository on 2026-10-13; the adapter checks it again at run time.
 *
 * The two CC BY-ND specifications (I3S, CIM) are returned verbatim only: no summarising, no
 * merged or trimmed sections.
 */
import type { AdapterConfigMap, LicenseTier, Product } from '../../core/types.js';
import { LATEST, githubRepoProbe } from './builders.js';

type RepoFilter = Pick<
  AdapterConfigMap['github-repo'],
  'include' | 'exclude' | 'symbolsFromHeadings'
>;

interface SpecRow {
  id: string;
  name: string;
  aliases: string[];
  repo: string;
  defaultBranch: string;
  license: LicenseTier;
  summary: string;
  keywords: string[];
  languages: string[];
  filter?: RepoFilter;
  pitfalls?: string[];
  related?: string[];
}

const VERBATIM_ONLY =
  'Licensed CC BY-ND: text is returned verbatim with attribution; do not expect summaries, and do not redistribute modified copies.';

const SPECS: readonly SpecRow[] = [
  {
    id: 'i3s-spec',
    name: 'Indexed 3D Scene Layer (I3S) specification',
    aliases: ['i3s', 'scene-layer-package', 'slpk'],
    repo: 'Esri/i3s-spec',
    defaultBranch: 'master',
    license: 'cc-by-nd',
    summary:
      'Specification of I3S scene layers and scene layer packages (SLPK): 3D object, integrated mesh, point, point cloud and building scene layers.',
    keywords: ['3d', 'scene layer', 'integrated mesh', 'point cloud', 'building', 'node page'],
    languages: ['json'],
    // Each version of the specification is a directory under docs/.
    filter: { include: ['README.md', 'docs/**/*.md', 'format/**/*.md'] },
    pitfalls: [
      VERBATIM_ONLY,
      'Every version of the specification is a directory under docs/: name the version when two of them describe the same resource.',
    ],
    related: ['web-scene-spec'],
  },
  {
    id: 'cim-spec',
    name: 'Cartographic Information Model (CIM) specification',
    aliases: ['cim', 'cartographic-information-model'],
    repo: 'Esri/cim-spec',
    defaultBranch: 'main',
    license: 'cc-by-nd',
    summary:
      'Specification of the CIM JSON model for maps, layers, symbols, labels and layouts, as used by ArcGIS Pro and the Maps SDKs.',
    keywords: ['symbol', 'cim symbol', 'symbol layer', 'renderer', 'label class', 'layout'],
    languages: ['json'],
    // One `##` heading per CIM type, so each type is a symbol.
    filter: { include: ['README.md', 'docs/v3/*.md'], symbolsFromHeadings: 2 },
    pitfalls: [VERBATIM_ONLY],
    related: ['arcgis-pro-sdk', 'js-maps-sdk'],
  },
  {
    id: 'arcgis-pbf',
    name: 'ArcGIS feature service protocol buffers (PBF)',
    aliases: ['pbf', 'feature-collection-pbf'],
    repo: 'Esri/arcgis-pbf',
    defaultBranch: 'main',
    license: 'apache-2.0',
    summary:
      'Protocol buffer definitions for the f=pbf response format of feature service queries.',
    keywords: ['protobuf', 'proto', 'f=pbf', 'feature collection', 'query response'],
    languages: ['protobuf'],
    filter: { include: ['**/*.proto', '**/*.md'] },
    related: ['rest-api'],
  },
  {
    id: 'knowledge-pbf',
    name: 'ArcGIS Knowledge protocol buffers',
    aliases: ['knowledge-graph-pbf'],
    repo: 'Esri/knowledge-pbf',
    defaultBranch: 'master',
    license: 'apache-2.0',
    summary:
      'Protocol buffer definitions for requests and responses of the knowledge graph service.',
    keywords: ['protobuf', 'proto', 'knowledge graph', 'graph query', 'open cypher'],
    languages: ['protobuf'],
    filter: { include: ['**/*.proto', '**/*.md'] },
    related: ['rest-api', 'arcgis-knowledge'],
  },
  {
    id: 'lerc',
    name: 'LERC (Limited Error Raster Compression)',
    aliases: ['limited-error-raster-compression'],
    repo: 'Esri/lerc',
    defaultBranch: 'master',
    license: 'apache-2.0',
    summary:
      'Raster and elevation compression format with a user-set maximum error, with C++, Python, JavaScript and C# codecs.',
    keywords: ['raster', 'compression', 'elevation', 'codec', 'decode', 'image service'],
    languages: ['cpp', 'python', 'javascript', 'csharp'],
    filter: { include: ['README.md', 'doc/**'] },
  },
  {
    id: 'tile-package-spec',
    name: 'Tile package specification (TPKX)',
    aliases: ['tpkx', 'tile-package'],
    repo: 'Esri/tile-package-spec',
    defaultBranch: 'master',
    license: 'apache-2.0',
    summary: 'Specification of the open tile package format (.tpkx) for raster tile caches.',
    keywords: ['tile cache', 'tile package', 'compact cache', 'offline basemap'],
    languages: ['json'],
  },
  {
    id: 'spatially-optimized-parquet',
    name: 'Spatially optimized Parquet',
    aliases: ['geoparquet-esri', 'spatial-parquet'],
    repo: 'Esri/spatially-optimized-parquet',
    defaultBranch: 'main',
    license: 'apache-2.0',
    summary:
      'Conventions for storing geometry in Apache Parquet files so that spatial queries can skip row groups.',
    keywords: ['parquet', 'big data', 'geometry encoding', 'row group', 'spatial index'],
    languages: ['json'],
    related: ['geoanalytics-engine'],
  },
  {
    id: '3d-tiles-esri-crs',
    name: '3D Tiles layer with Esri coordinate systems',
    aliases: ['3d-tiles-layer', 'esri-crs-extension'],
    repo: 'Esri/3D-tiles-layer',
    defaultBranch: 'main',
    license: 'apache-2.0',
    summary:
      'Esri extension that lets a 3D Tiles tileset declare a projected or geographic coordinate system.',
    keywords: ['3d tiles', 'tileset', 'coordinate system', 'crs', 'extension'],
    languages: ['json'],
    related: ['i3s-spec'],
  },
  {
    id: 'projection-engine-db',
    name: 'Projection engine database documentation',
    aliases: ['projection-engine-db-doc', 'wkid-list'],
    repo: 'Esri/projection-engine-db-doc',
    defaultBranch: 'main',
    license: 'apache-2.0',
    summary:
      'Documentation of the coordinate systems and transformations known to the ArcGIS projection engine.',
    keywords: ['wkid', 'coordinate system', 'spatial reference', 'transformation', 'projection'],
    languages: ['json'],
    // The JSON lists under json/ are about 20 MB; looking up a WKID in them is not supported.
    filter: { include: ['README.md', 'docs/**'], exclude: ['json/**'] },
    pitfalls: [
      'Only the README and docs are read: the per-WKID lists (json/) are not indexed, so a WKID cannot be looked up here.',
    ],
  },
  {
    id: 'file-geodatabase-api',
    name: 'File Geodatabase API',
    aliases: ['filegdb-api', 'fgdb-api'],
    repo: 'Esri/file-geodatabase-api',
    defaultBranch: 'master',
    license: 'apache-2.0',
    summary:
      'C++ library (with a .NET wrapper) for reading and writing file geodatabases without ArcGIS installed.',
    keywords: ['file geodatabase', 'gdb', 'fgdb', 'c++ library', 'read write'],
    languages: ['cpp', 'csharp'],
    // The repository ships binary releases; only the READMEs are documentation.
    filter: { include: ['**/README.md'] },
    pitfalls: [
      'The repository distributes prebuilt libraries: only its READMEs are read, and the API headers are not indexed.',
    ],
  },
];

function specProduct(row: SpecRow): Product {
  const repoUrl = `https://github.com/${row.repo}`;
  return {
    id: row.id,
    name: row.name,
    aliases: row.aliases,
    category: 'specs',
    tier: 'developer',
    status: 'active',
    summary: row.summary,
    keywords: row.keywords,
    languages: row.languages,
    homepage: repoUrl,
    packages: [],
    repos: [
      { repo: row.repo, role: 'spec', license: row.license, defaultBranch: row.defaultBranch },
    ],
    lines: [LATEST],
    sources: [
      {
        id: 'spec',
        title: `${row.name} (repository)`,
        kinds: ['spec'],
        adapter: 'github-repo',
        config: { repo: row.repo, preset: 'markdown-docs', ...row.filter },
        capability: 'github',
        license: row.license,
        floor: true,
        probe: githubRepoProbe(row.repo),
      },
    ],
    oracles: [],
    // The repository root: file names and the default branch are discovered at run time.
    startHere: [{ title: `${row.repo} on GitHub`, ref: repoUrl }],
    pitfalls: row.pitfalls ?? [],
    related: row.related ?? [],
    licenseTier: row.license,
    verifiedOn: '2026-10-13',
  };
}

/** Specifications and formats (design section 4.5), ten ids. */
export const specsProducts: readonly Product[] = SPECS.map(specProduct);
