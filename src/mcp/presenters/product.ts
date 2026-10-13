/**
 * Shapes and Markdown of catalogue data: product rows, product profiles and tables of
 * contents. Shared by `arcgis_docs_list_products` and the catalog and product resources.
 */
import { BREADCRUMB_SEPARATOR, BRIEF_PREFIX } from '../../core/names.js';
import type { SourcePolicy } from '../../core/ports.js';
import { sourceRootUrl } from '../../core/source-urls.js';
import type {
  AnySourceDef,
  CatalogRecord,
  HealthState,
  Product,
  SourceHealth,
  VersionLine,
} from '../../core/types.js';
import { compact } from '../compact.js';
import type { ProductProfile, ProductRow, TocRow } from '../tools/list-products.js';

/** The line that carries `current: true`, or the first one of a malformed product. */
export function currentLine(product: Product): VersionLine | undefined {
  return product.lines.find((line) => line.current) ?? product.lines[0];
}

/** List-mode data of one product. */
export function productRow(product: Product): ProductRow {
  return compact({
    id: product.id,
    name: product.name,
    category: product.category,
    status: product.status,
    tier: product.tier,
    currentLine: currentLine(product)?.label,
    summary: product.summary,
    successor: product.successor,
  });
}

/** The product list as Markdown, grouped by category in order of first appearance. */
export function renderProductList(rows: readonly ProductRow[]): string {
  const groups = new Map<string, ProductRow[]>();
  for (const row of rows) groups.set(row.category, [...(groups.get(row.category) ?? []), row]);
  return [...groups]
    .map(([category, members]) =>
      [
        `## ${category}`,
        ...members.map((row) => {
          const line = row.currentLine === undefined ? '' : `, ${row.currentLine}`;
          const state = row.status === 'active' ? '' : `, ${row.status}`;
          const successor = row.successor === undefined ? '' : ` Successor: ${row.successor}.`;
          return `- ${row.id}: ${row.name}${line}${state}. ${row.summary}${successor}`;
        }),
      ].join('\n'),
    )
    .join('\n\n');
}

const SHOWN_HEALTH: Record<HealthState, ProductProfile['sources'][number]['health']> = {
  ok: 'ok',
  degraded: 'degraded',
  failing: 'failing',
  // "disabled" is a policy state; the profile reports it as `enabled: false`.
  disabled: 'unknown',
  unknown: 'unknown',
};

function sourceRef(product: Product, source: AnySourceDef, line: VersionLine | undefined): string {
  if (source.adapter === 'brief') {
    // A brief source has no root page: point at its first concrete brief.
    const slug = source.config.slugs.find((candidate) => !candidate.includes('*'));
    return slug === undefined ? product.homepage : `${BRIEF_PREFIX}${slug}`;
  }
  if (line === undefined) return product.homepage;
  return sourceRootUrl(source, line, product.homepage);
}

/**
 * Profile-mode data of one product.
 *
 * @param health in-memory health per source id, from the catalogue service.
 * @param policy decides `enabled` per source and whether site search takes part in searches.
 */
export function profileOf(
  product: Product,
  health: Readonly<Record<string, SourceHealth>>,
  policy: SourcePolicy,
): ProductProfile {
  const line = currentLine(product);
  const kinds = new Set(product.sources.flatMap((source) => source.kinds));
  return compact({
    id: product.id,
    name: product.name,
    status: product.status,
    summary: product.summary,
    aliases: product.aliases,
    languages: product.languages,
    homepage: product.homepage,
    packages: product.packages.map(({ registry, name }) => ({ registry, name })),
    repos: product.repos.map(({ repo, role, license }) => ({ repo, role, license })),
    lines: product.lines.map(({ id, label, current, access }) => ({ id, label, current, access })),
    sources: product.sources.map((source) => {
      const state = health[source.id];
      return compact({
        id: source.id,
        title: source.title,
        kinds: [...source.kinds],
        pages: state?.records ?? source.pagesApprox,
        ref: sourceRef(product, source, line),
        enabled: source.capability === undefined || policy.enabled(source.capability),
        health: SHOWN_HEALTH[state?.state ?? 'unknown'],
      });
    }),
    capabilities: {
      symbols: kinds.has('api') || kinds.has('spec'),
      samples: kinds.has('sample'),
      releaseNotes: product.releaseNotes !== undefined || kinds.has('release-notes'),
      search:
        product.esearch !== undefined && policy.enabled('site-search')
          ? ('local+site' as const)
          : ('local' as const),
    },
    startHere: product.startHere.map(({ title, ref }) => ({ title, ref })),
    pitfalls: product.pitfalls,
    related: product.related,
    successor: product.successor,
    licenseTier: product.licenseTier,
    verifiedOn: product.verifiedOn,
  });
}

function bullets(title: string, items: readonly string[]): string[] {
  return items.length === 0 ? [] : ['', `## ${title}`, ...items.map((item) => `- ${item}`)];
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}

/** One product profile as Markdown. Every ref of the profile appears in the text. */
export function renderProfile(profile: ProductProfile): string {
  const { capabilities } = profile;
  const facts = [
    `- Id: ${profile.id}`,
    `- Status: ${profile.status}`,
    profile.successor === undefined ? undefined : `- Successor: ${profile.successor}`,
    `- Homepage: ${profile.homepage}`,
    profile.aliases.length === 0 ? undefined : `- Also known as: ${profile.aliases.join(', ')}`,
    profile.languages.length === 0 ? undefined : `- Languages: ${profile.languages.join(', ')}`,
    profile.packages.length === 0
      ? undefined
      : `- Packages: ${profile.packages.map((pkg) => `${pkg.name} (${pkg.registry})`).join(', ')}`,
    profile.repos.length === 0
      ? undefined
      : `- Repositories: ${profile.repos.map((repo) => `https://github.com/${repo.repo} (${repo.role}, ${repo.license})`).join(', ')}`,
    `- Version lines: ${profile.lines.map((line) => `${line.id} "${line.label}"${line.current ? ' (current)' : ''}${line.access === 'link-only' ? ' (link only)' : ''}`).join('; ')}`,
    `- Lookups: symbols ${yesNo(capabilities.symbols)}, samples ${yesNo(capabilities.samples)}, release notes ${yesNo(capabilities.releaseNotes)}, search ${capabilities.search}`,
    profile.related.length === 0 ? undefined : `- Related products: ${profile.related.join(', ')}`,
    `- Licence tier: ${profile.licenseTier}; registry entry verified on ${profile.verifiedOn}`,
  ].filter((fact): fact is string => fact !== undefined);
  const sources = profile.sources.map((source) => {
    const pages = source.pages === undefined ? '' : `, about ${source.pages} pages`;
    const state = source.enabled
      ? source.health === 'unknown'
        ? ''
        : `, ${source.health}`
      : ', disabled by the source policy';
    return `${source.id}: ${source.title} [${source.kinds.join(', ')}]${pages}${state}. ${source.ref}`;
  });
  return [
    `# ${profile.name}`,
    '',
    profile.summary,
    '',
    ...facts,
    ...bullets('Documentation sources (use the id as `section`)', sources),
    ...bullets(
      'Start here',
      profile.startHere.map((entry) => `${entry.title}: ${entry.ref}`),
    ),
    ...bullets('Pitfalls', profile.pitfalls),
  ].join('\n');
}

/** One catalogue record as a table-of-contents entry; depth is the number of ancestors. */
export function tocRow(record: CatalogRecord): TocRow {
  const ancestors =
    record.breadcrumb === undefined || record.breadcrumb.length === 0
      ? 0
      : record.breadcrumb.split(BREADCRUMB_SEPARATOR).length;
  return { title: record.title, ref: record.ref, depth: ancestors, kind: record.kind };
}

/** A table of contents as an indented Markdown list of `title: ref`. */
export function renderToc(rows: readonly TocRow[]): string {
  return rows
    .map((row) => {
      // Deep trees are flattened beyond six levels so that indentation never dominates the line.
      const indent = '  '.repeat(Math.min(row.depth, 6));
      return `${indent}- ${row.title}${row.ref === undefined ? '' : `: ${row.ref}`}`;
    })
    .join('\n');
}
