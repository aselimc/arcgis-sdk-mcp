/**
 * Registry data: DevOps tooling and open-source libraries (design section 4.5). Every source
 * is a GitHub repository read as Markdown; the first source of a product is its floor.
 * Licences are the ones found on 2026-10-13 and are checked again at run time.
 */
import type {
  AdapterConfigMap,
  AnySourceDef,
  LicenseTier,
  Product,
  RepoRef,
} from '../../core/types.js';
import { githubRepoProbe } from './builders.js';

interface RepoSource {
  /** Source id, unique within the product. */
  id: string;
  title: string;
  repo: string;
  defaultBranch: string;
  role: RepoRef['role'];
  license?: LicenseTier;
  preset?: AdapterConfigMap['github-repo']['preset'];
  include?: string[];
}

interface OssRow {
  id: string;
  name: string;
  aliases: string[];
  summary: string;
  keywords: string[];
  languages: string[];
  /** The first entry is the floor source. */
  sources: [RepoSource, ...RepoSource[]];
  startHere?: Product['startHere'];
  pitfalls?: string[];
  related?: string[];
}

const ROWS: readonly OssRow[] = [
  {
    id: 'enterprise-devops',
    name: 'ArcGIS Enterprise deployment automation',
    aliases: [
      'arcgis-cookbook',
      'chef-cookbooks',
      'arcgis-powershell-dsc',
      'arcgis-gitops',
      'arcgis-packer',
    ],
    summary:
      'Esri repositories for automating ArcGIS Enterprise deployments: Chef cookbooks, PowerShell DSC, GitOps templates, Packer images and Kubernetes resources.',
    keywords: [
      'chef',
      'cookbook',
      'powershell dsc',
      'terraform',
      'gitops',
      'packer',
      'ami',
      'kubernetes',
      'helm',
      'deployment',
      'upgrade',
      'monitoring',
    ],
    languages: ['ruby', 'powershell', 'hcl', 'yaml', 'json'],
    sources: [
      {
        id: 'cookbook',
        title: 'Chef cookbooks for ArcGIS (arcgis-cookbook)',
        repo: 'Esri/arcgis-cookbook',
        defaultBranch: 'main',
        role: 'docs',
      },
      {
        id: 'powershell-dsc',
        title: 'PowerShell DSC for ArcGIS (wiki)',
        repo: 'Esri/arcgis-powershell-dsc',
        defaultBranch: 'main',
        role: 'docs',
        preset: 'wiki',
      },
      {
        id: 'gitops',
        title: 'GitOps templates for ArcGIS Enterprise (arcgis-gitops)',
        repo: 'Esri/arcgis-gitops',
        defaultBranch: 'main',
        role: 'docs',
      },
      {
        id: 'packer',
        title: 'Packer templates for ArcGIS (arcgis-packer)',
        repo: 'Esri/arcgis-packer',
        defaultBranch: 'main',
        role: 'docs',
      },
      {
        id: 'kubernetes',
        title: 'ArcGIS Enterprise on Kubernetes resources',
        repo: 'Esri/arcgis-enterprise-on-kubernetes-resources',
        defaultBranch: 'main',
        role: 'docs',
      },
      {
        id: 'observability',
        title: 'ArcGIS Enterprise observability',
        repo: 'Esri/arcgis-enterprise-observability',
        defaultBranch: 'main',
        role: 'docs',
      },
    ],
    pitfalls: [
      'Each repository targets specific ArcGIS Enterprise versions: check the version table in its README before copying a configuration.',
      'The rendered cookbook documentation is built from the gh-pages branch; the Markdown read here is the main branch.',
    ],
    related: ['arcgis-enterprise', 'arcgis-enterprise-k8s', 'arcgis-enterprise-cloud-tools'],
  },
  {
    id: 'koop',
    name: 'Koop',
    aliases: ['koopjs', 'koop-provider', 'koop-cli'],
    summary:
      'Open-source Node.js server that translates other data sources into GeoServices (feature service) responses; the basis of custom data feeds.',
    keywords: ['provider', 'output plugin', 'geoservices', 'feature server', 'custom data feed'],
    languages: ['javascript'],
    sources: [
      {
        id: 'docs',
        title: 'Koop documentation (koopjs.github.io sources)',
        repo: 'koopjs/koopjs.github.io',
        defaultBranch: 'master',
        role: 'docs',
        include: ['_docs/**/*.md'],
      },
      {
        // GitHub reports no recognised licence for this repository.
        id: 'koop',
        title: 'Koop monorepo (package READMEs and changelogs)',
        repo: 'koopjs/koop',
        defaultBranch: 'master',
        role: 'source',
        license: 'unlicensed',
      },
    ],
    startHere: [{ title: 'Koop documentation', ref: 'https://koopjs.github.io/' }],
    pitfalls: [
      'Koop is a community project, not an Esri product with support; ArcGIS Enterprise custom data feeds (enterprise-sdk) are built on it.',
    ],
    related: ['enterprise-sdk', 'rest-api'],
  },
  {
    id: 'developer-support',
    name: 'Esri developer support samples',
    aliases: ['esri-developer-support', 'support-services-samples'],
    summary:
      'Code samples published by Esri Support Services across the web, native, Python and REST APIs.',
    keywords: ['support', 'samples', 'workaround', 'proof of concept', 'snippets'],
    languages: ['javascript', 'python', 'csharp', 'java', 'swift', 'kotlin'],
    sources: [
      {
        id: 'repo',
        title: 'developer-support repository',
        repo: 'Esri/developer-support',
        defaultBranch: 'master',
        role: 'samples',
      },
    ],
    pitfalls: [
      'Samples are written for the SDK version current at the time and are not maintained: check each API with arcgis_docs_lookup_symbol before reuse.',
    ],
    related: ['support-kb'],
  },
  {
    id: 'oss-libraries',
    name: 'Esri open-source libraries',
    aliases: [
      'solution.js',
      'hub.js',
      'geometry-api-java',
      'arcgis-html-sanitizer',
      'wayback-core',
    ],
    summary:
      'Smaller Esri open-source libraries and scripts: Solution.js, Hub.js (archived), Geometry API for Java, HTML sanitizer, Wayback and raster functions.',
    keywords: [
      'solution templates',
      'hub',
      'geometry engine java',
      'sanitizer',
      'xss',
      'wayback imagery',
      'raster function',
      'gtfs',
      'public transit',
      'storymaps',
      'field maps',
    ],
    languages: ['typescript', 'javascript', 'java', 'python'],
    sources: [
      {
        id: 'solution-js',
        title: 'Solution.js (deploying ArcGIS Solutions templates)',
        repo: 'Esri/solution.js',
        defaultBranch: 'develop',
        role: 'source',
      },
      {
        id: 'hub-js',
        title: 'Hub.js (archived)',
        repo: 'Esri/hub.js',
        defaultBranch: 'master',
        role: 'source',
      },
      {
        id: 'geometry-api-java',
        title: 'Geometry API for Java',
        repo: 'Esri/geometry-api-java',
        defaultBranch: 'master',
        role: 'source',
      },
      {
        id: 'html-sanitizer',
        title: 'ArcGIS HTML sanitizer',
        repo: 'Esri/arcgis-html-sanitizer',
        defaultBranch: 'master',
        role: 'source',
      },
      {
        id: 'wayback-core',
        title: 'Wayback core (World Imagery Wayback)',
        repo: 'Esri/wayback-core',
        defaultBranch: 'main',
        role: 'source',
      },
      {
        id: 'raster-functions',
        title: 'Python raster functions',
        repo: 'Esri/raster-functions',
        defaultBranch: 'master',
        role: 'source',
      },
      {
        id: 'public-transit-tools',
        title: 'Public transit tools',
        repo: 'Esri/public-transit-tools',
        defaultBranch: 'master',
        role: 'source',
      },
      {
        id: 'storymaps-developer-samples',
        title: 'ArcGIS StoryMaps developer samples',
        repo: 'Esri/storymaps-developer-samples',
        defaultBranch: 'main',
        role: 'samples',
      },
      {
        id: 'field-maps-scripts',
        title: 'ArcGIS Field Maps scripts',
        repo: 'Esri/field-maps-scripts',
        defaultBranch: 'main',
        role: 'samples',
      },
    ],
    pitfalls: [
      'Hub.js is archived: use it only to read existing code, and prefer the Hub service APIs (hub-dev).',
      'Name the library with a scope such as oss-libraries/geometry-api-java: the libraries are unrelated and a search across all of them is rarely useful.',
    ],
    related: ['hub-dev', 'arcgis-solutions', 'arcgis-storymaps', 'field-maps'],
  },
];

function repoSource(source: RepoSource, floor: boolean): AnySourceDef {
  return {
    id: source.id,
    title: source.title,
    kinds: source.role === 'samples' ? ['sample', 'guide'] : ['guide'],
    adapter: 'github-repo',
    config: {
      repo: source.repo,
      preset: source.preset ?? 'markdown-docs',
      ...(source.include === undefined ? {} : { include: source.include }),
    },
    capability: 'github',
    license: source.license ?? 'apache-2.0',
    ...(floor ? { floor: true } : {}),
    probe: githubRepoProbe(source.repo),
  };
}

function ossProduct(row: OssRow): Product {
  const repoUrl = (repo: string): string => `https://github.com/${repo}`;
  return {
    id: row.id,
    name: row.name,
    aliases: row.aliases,
    category: 'devops-oss',
    tier: 'developer',
    status: 'active',
    summary: row.summary,
    keywords: row.keywords,
    languages: row.languages,
    homepage: repoUrl(row.sources[0].repo),
    packages: [],
    repos: row.sources.map((source) => ({
      repo: source.repo,
      role: source.role,
      license: source.license ?? 'apache-2.0',
      defaultBranch: source.defaultBranch,
    })),
    lines: [{ id: 'latest', label: 'Current', current: true, access: 'live', vars: {} }],
    sources: row.sources.map((source, index) => repoSource(source, index === 0)),
    oracles: [],
    startHere:
      row.startHere ??
      row.sources.slice(0, 4).map((source) => ({ title: source.title, ref: repoUrl(source.repo) })),
    pitfalls: row.pitfalls ?? [],
    related: row.related ?? [],
    licenseTier: 'apache-2.0',
    verifiedOn: '2026-10-13',
  };
}

/** DevOps and open-source products (design section 4.5), four ids. */
export const devopsOssProducts: readonly Product[] = ROWS.map(ossProduct);
