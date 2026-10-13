/**
 * Zod schemas of the registry data (design decision 19): `Product`, `SourceDef` with one
 * config shape per adapter, and `HostPolicy`. TypeScript already checks the data files at
 * compile time; the schemas add what types cannot express (kebab-case ids, compilable
 * patterns, length limits) and catch misspelt keys, since every object is strict.
 *
 * Used by the registry tests and by `scripts/registry-check.ts`, never at server start-up.
 */
import { z } from 'zod';
import { CAPABILITIES } from '../core/capabilities.js';
import {
  CATEGORIES,
  DOC_KINDS,
  HTML_FAMILIES,
  LICENSE_TIERS,
  type AdapterConfigMap,
  type AdapterType,
  type HostPolicy,
  type OracleType,
  type Product,
} from '../core/types.js';

/** Kebab-case identifier: product ids, source ids. */
const id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be kebab-case');

/** A string that compiles as a regular expression. */
const pattern = z.string().min(1).refine(compiles, 'must be a valid regular expression');

function compiles(source: string): boolean {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date (YYYY-MM-DD)');
const httpsUrl = z.string().regex(/^https:\/\/[^\s/]+(?:\/\S*)?$/, 'must be an https URL');
/** An absolute https URL, or a path on developers.arcgis.com; may hold `{placeholders}`. */
const urlOrPath = z.string().regex(/^(?:https:\/\/[^\s/]+|\/|\{[a-z]+\})\S*$/i);
/** A ref as agents pass it: an https URL or `brief:<slug>`. */
const ref = z.union([httpsUrl, z.string().regex(/^brief:[a-z0-9][a-z0-9/_-]*$/)]);
const repoName = z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'must be owner/name');
const hostName = z.string().regex(/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/, 'must be a host name');
const license = z.enum(LICENSE_TIERS);
const kind = z.enum(DOC_KINDS);
const capability = z.enum(CAPABILITIES);

const urlFilter = {
  include: z.array(pattern).exactOptional(),
  exclude: z.array(pattern).exactOptional(),
  classify: z.array(z.tuple([pattern, kind])).exactOptional(),
};

/** One schema per adapter type; the mapped type keeps the list complete. */
const adapterConfigs: { [A in AdapterType]: z.ZodType<AdapterConfigMap[A]> } = {
  astro: z.strictObject({
    ...urlFilter,
    base: urlOrPath,
    sitemap: z.string().exactOptional(),
    searchIndexes: z
      .array(
        z.strictObject({
          url: z.string().min(1),
          role: z.enum(['guide', 'sample', 'api']),
          platform: z.string().exactOptional(),
        }),
      )
      .exactOptional(),
    sampleIndexPage: z.string().exactOptional(),
    symbolsFromSlug: pattern.exactOptional(),
  }),
  gatsby: z.strictObject({
    ...urlFilter,
    base: urlOrPath,
    seedPage: urlOrPath.exactOptional(),
    symbols: z
      .enum([
        'typedoc',
        'openapi',
        'fuse-store',
        'sphinx-pagination',
        'apiref-nav',
        'glossary',
        'rest-operations',
      ])
      .exactOptional(),
    bodyFrom: z
      .enum(['auto', 'html', 'jupyterNotebook', 'sphinxJson', 'apiRef', 'childMarkdownRemark'])
      .exactOptional(),
    symbolsFromSlug: pattern.exactOptional(),
  }),
  'docfx-esri': z.strictObject({
    slug: id,
    scope: z.string().regex(/\/$/, 'must end with a slash').exactOptional(),
    toc: z.string().exactOptional(),
    sections: z.array(z.string().min(1)).exactOptional(),
    symbols: z.literal('toc').exactOptional(),
    gpParameters: z.boolean().exactOptional(),
  }),
  'legacy-help': z.strictObject({
    host: hostName,
    base: z.string().regex(/^\/.*\/$/, 'must start and end with a slash'),
    books: z.array(
      z.strictObject({ path: z.string().min(1), tocScript: z.string().exactOptional() }),
    ),
    lines: z.array(z.string().min(1)).exactOptional(),
    enumerate: z.enum(['eager', 'on-demand']).exactOptional(),
  }),
  sitemap: z.strictObject({
    ...urlFilter,
    url: urlOrPath.exactOptional(),
    urls: z.array(urlOrPath).exactOptional(),
    titleFrom: z.literal('slug').exactOptional(),
    kind: kind.exactOptional(),
  }),
  static: z.strictObject({
    entries: z.array(z.strictObject({ url: urlOrPath, title: z.string().min(1), kind })).min(1),
  }),
  brief: z.strictObject({ slugs: z.array(z.string().min(1)).min(1) }),
  openapi: z.strictObject({
    specs: z
      .array(
        z.union([
          httpsUrl,
          z.strictObject({ url: httpsUrl, embedded: z.boolean().exactOptional() }),
        ]),
      )
      .min(1),
  }),
  docc: z.strictObject({ base: urlOrPath, maxDepth: z.number().int().positive().exactOptional() }),
  dokka: z.strictObject({ base: urlOrPath }),
  dartdoc: z.strictObject({ base: urlOrPath, index: z.string().min(1) }),
  'docfx-net': z.strictObject({ base: urlOrPath, xrefmaps: z.array(z.string().min(1)).min(1) }),
  javadoc: z.strictObject({ base: urlOrPath, legacy: z.boolean().exactOptional() }),
  sphinx: z.strictObject({ base: urlOrPath }),
  'npm-dts': z.strictObject({ package: z.string().min(1), docUrl: urlOrPath }),
  'npm-cem': z.strictObject({
    packages: z.array(z.string().min(1)).min(1),
    file: z.string().min(1),
    docUrl: urlOrPath,
  }),
  'npm-json': z.strictObject({
    package: z.string().min(1),
    file: z.string().min(1),
    mapper: z.enum(['arcade-api', 'arcade-profiles']),
    docUrl: urlOrPath.exactOptional(),
  }),
  'github-repo': z.strictObject({
    repo: repoName,
    ref: z.string().exactOptional(),
    pin: z.enum(['release-tag', 'branch']).exactOptional(),
    tagTemplate: z.string().exactOptional(),
    preset: z.enum([
      'samples-metadata',
      'samples-readme',
      'markdown-docs',
      'notebooks',
      'snippets-region',
      'wiki',
    ]),
    include: z.array(z.string().min(1)).exactOptional(),
    exclude: z.array(z.string().min(1)).exactOptional(),
    symbolsFromHeadings: z.number().int().min(1).max(6).exactOptional(),
  }),
  xmldoc: z.strictObject({
    repo: repoName,
    ref: z.string().exactOptional(),
    dir: z.string().min(1),
    docUrlHost: hostName.exactOptional(),
  }),
  pkgdown: z.strictObject({ host: hostName, packages: z.array(z.string().min(1)).min(1) }),
};

/** Schema of a `Probe`. */
export const probeSchema = z.strictObject({
  url: httpsUrl,
  expect: z.enum(['xml', 'json', 'html', 'text', 'yaml']),
  minRecords: z.number().int().nonnegative().exactOptional(),
  family: z.enum(HTML_FAMILIES).exactOptional(),
  minChars: z.number().int().positive().exactOptional(),
  mustContain: z.string().min(1).exactOptional(),
});

const sourceCommon = {
  id,
  title: z.string().min(1).max(100),
  kinds: z.array(kind).min(1),
  capability: capability.exactOptional(),
  license: license.exactOptional(),
  floor: z.boolean().exactOptional(),
  lines: z.array(z.string().min(1)).min(1).exactOptional(),
  priority: z.number().int().min(0).exactOptional(),
  fallbacks: z.array(id).exactOptional(),
  pagesApprox: z.number().int().positive().exactOptional(),
  probe: probeSchema,
};

function sourceOf<A extends AdapterType>(adapter: A) {
  return z.strictObject({
    ...sourceCommon,
    adapter: z.literal(adapter),
    config: adapterConfigs[adapter],
  });
}

/**
 * Schema of a `SourceDef`: a union discriminated on `adapter`, one config shape per type.
 * The members are listed one by one so that each keeps its own type; a test asserts that
 * every adapter type is covered.
 */
export const sourceDefSchema = z.discriminatedUnion('adapter', [
  sourceOf('astro'),
  sourceOf('gatsby'),
  sourceOf('docfx-esri'),
  sourceOf('legacy-help'),
  sourceOf('sitemap'),
  sourceOf('static'),
  sourceOf('brief'),
  sourceOf('openapi'),
  sourceOf('docc'),
  sourceOf('dokka'),
  sourceOf('dartdoc'),
  sourceOf('docfx-net'),
  sourceOf('javadoc'),
  sourceOf('sphinx'),
  sourceOf('npm-dts'),
  sourceOf('npm-cem'),
  sourceOf('npm-json'),
  sourceOf('github-repo'),
  sourceOf('xmldoc'),
  sourceOf('pkgdown'),
]);

/** Every oracle type, for the schema. The mapped type keeps the list complete. */
const ORACLE_TYPES = Object.keys({
  'npm-dist-tags': true,
  pypi: true,
  'nuget-flat': true,
  'pub-dev': true,
  'github-release': true,
  'page-regex': true,
  'sitemap-slug': true,
  'meta-refresh-target': true,
  'docesri-sitemap': true,
  'agol-rest-info': true,
  static: true,
  plc: true,
} satisfies Record<OracleType, true>) as [OracleType, ...OracleType[]];

/** Schema of a `VersionLine`. A `versions` variable must be a regular expression (see `lineOf`). */
export const versionLineSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/, 'must be lower-case letters, digits, dots, dashes'),
  label: z.string().min(1).max(60),
  current: z.boolean(),
  access: z.enum(['live', 'link-only']),
  vars: z
    .record(z.string(), z.string())
    .refine((vars) => vars.versions === undefined || compiles(vars.versions), {
      message: 'vars.versions must be a valid regular expression',
    }),
});

/** Schema of a `Product`. Cross-references between products are checked by `checkRegistry`. */
export const productSchema: z.ZodType<Product> = z.strictObject({
  id,
  name: z.string().min(1).max(100),
  aliases: z.array(
    z
      .string()
      .min(1)
      .refine((alias) => alias === alias.toLowerCase(), 'must be lower-case'),
  ),
  category: z.enum(CATEGORIES),
  tier: z.enum(['developer', 'help', 'link']),
  status: z.enum(['active', 'beta', 'deprecated', 'retired']),
  statusNote: z.string().min(1).max(200).exactOptional(),
  successor: id.exactOptional(),
  summary: z.string().min(1).max(160),
  keywords: z.array(z.string().min(1)),
  languages: z.array(z.string().regex(/^[a-z0-9+#-]+$/)),
  homepage: httpsUrl,
  packages: z.array(
    z.strictObject({
      registry: z.enum(['npm', 'pypi', 'nuget', 'pub', 'maven', 'swiftpm', 'cran']),
      name: z.string().min(1),
      license,
      primary: z.boolean().exactOptional(),
    }),
  ),
  repos: z.array(
    z.strictObject({
      repo: repoName,
      role: z.enum(['samples', 'toolkit', 'source', 'docs', 'spec', 'templates']),
      license,
      defaultBranch: z.string().min(1),
    }),
  ),
  workspaceSignals: z
    .array(
      z.strictObject({
        files: z.array(z.string().min(1)).min(1),
        pattern,
        versionGroup: z.number().int().positive().exactOptional(),
      }),
    )
    .exactOptional(),
  lines: z.array(versionLineSchema).min(1),
  sources: z.array(sourceDefSchema),
  oracles: z.array(
    z.strictObject({
      type: z.enum(ORACLE_TYPES),
      options: z.record(z.string(), z.string()),
      provides: z
        .array(z.enum(['documented', 'installable', 'released', 'prerelease', 'lifecycle']))
        .min(1),
    }),
  ),
  compatibility: z
    .array(z.strictObject({ name: z.string().min(1), url: httpsUrl }))
    .exactOptional(),
  releaseNotes: z
    .strictObject({
      current: httpsUrl.exactOptional(),
      // A URL template with version placeholders, read by the version service.
      pattern: urlOrPath.exactOptional(),
      sitemapFilter: pattern.exactOptional(),
    })
    .exactOptional(),
  esearch: z
    .strictObject({
      index: z.string().exactOptional(),
      site: z.string().exactOptional(),
      products: z.array(z.string().min(1)).exactOptional(),
      urlPrefix: z.string().exactOptional(),
      keepUrl: pattern.exactOptional(),
      dropUrl: pattern.exactOptional(),
    })
    .exactOptional(),
  startHere: z.array(z.strictObject({ title: z.string().min(1), ref })),
  pitfalls: z.array(z.string().min(1).max(200)).max(4),
  related: z.array(id),
  licenseTier: license,
  verifiedOn: isoDate,
});

/** Schema of a `HostPolicy` row. */
export const hostPolicySchema: z.ZodType<HostPolicy> = z.strictObject({
  host: hostName,
  capability: capability.nullable(),
  allowPaths: z.array(pattern).exactOptional(),
  method: z.enum(['GET', 'POST']).exactOptional(),
  robotsDisallow: z.array(z.string().regex(/^\//, 'must start with a slash')),
  revalidate: z.enum(['etag', 'last-modified', 'both', 'none']),
  bom: z.boolean().exactOptional(),
  softNotFoundBytes: z.number().int().positive().exactOptional(),
  catchAllPrefixes: z.array(z.string().regex(/^\/.*\/$/)).exactOptional(),
  ratePerSec: z.number().positive(),
  maxConcurrent: z.number().int().positive(),
  minIntervalMs: z.number().int().positive().exactOptional(),
  timeoutMs: z.number().int().positive().exactOptional(),
  githubOwners: z.array(z.string().min(1)).exactOptional(),
});

/** Schema of a curated brief as `Registry.briefs()` returns it. */
export const briefSchema = z.strictObject({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*$/),
  title: z.string().min(1),
  verifiedOn: isoDate,
  sources: z.array(httpsUrl),
  markdown: z.string().min(1),
});

/** A schema violation, located by product and JSON path. */
export interface SchemaIssue {
  product: string;
  path: string;
  message: string;
}

/** Validates every product against {@link productSchema}; the result is empty when all pass. */
export function validateProducts(products: readonly unknown[]): SchemaIssue[] {
  return products.flatMap((product, index) => {
    const result = productSchema.safeParse(product);
    if (result.success) return [];
    const name = (product as { id?: unknown } | null)?.id;
    return result.error.issues.map((issue) => ({
      product: typeof name === 'string' ? name : `#${index}`,
      path: issue.path.join('.'),
      message: issue.message,
    }));
  });
}
