/**
 * Shapes and Markdown of a version report (design section 3.3): what the documentation
 * describes and what a package manager serves are reported side by side, never merged.
 */
import type { VersionReport } from '../../core/ports.js';
import { sourceRootUrl } from '../../core/source-urls.js';
import type { PackageRef, Product, VersionFact, VersionLine } from '../../core/types.js';
import { compareVersions } from '../../core/version-key.js';
import { compact } from '../compact.js';
import type { VersionsProduct } from '../tools/get-versions.js';

type ReportEntry = VersionReport['products'][number];

/** Adapters that address any published version of a package, not only the current line. */
const VERSION_ADDRESSED = new Set(['npm-dts', 'npm-cem', 'npm-json']);

const INSTALL: Record<PackageRef['registry'], (name: string) => string> = {
  npm: (name) => `npm install ${name}`,
  pypi: (name) => `pip install ${name}`,
  nuget: (name) => `dotnet add package ${name}`,
  pub: (name) => `flutter pub add ${name}`,
  maven: (name) => `Gradle or Maven dependency ${name}:<version>`,
  swiftpm: (name) => `Swift Package Manager: ${name}`,
  cran: (name) => `install.packages("${name}")`,
};

function installLines(product: Product): string[] {
  const primary = product.packages.filter((pkg) => pkg.primary);
  // Products with many packages mark the ones to install; otherwise the first few suffice.
  const shown = primary.length > 0 ? primary : product.packages.slice(0, 3);
  return shown.map((pkg) => INSTALL[pkg.registry](pkg.name));
}

function lineRow(product: Product, line: VersionLine): VersionsProduct['lines'][number] {
  const sources = product.sources.filter(
    (source) => source.lines === undefined || source.lines.includes(line.id),
  );
  const docs = sources.find((source) => source.adapter !== 'brief');
  const reference = sources.some((source) => source.kinds.includes('api'));
  const anyVersion = product.sources.some((source) => VERSION_ADDRESSED.has(source.adapter));
  return {
    id: line.id,
    label: line.label,
    docsUrl: docs === undefined ? product.homepage : sourceRootUrl(docs, line, product.homepage),
    access: line.access,
    symbols: line.access === 'live' && reference ? 'live' : anyVersion ? 'npm-any-version' : 'none',
  };
}

function lifecycleOf(facts: readonly VersionFact[]): VersionsProduct['lifecycle'] {
  const phases = facts.filter((fact) => fact.role === 'lifecycle');
  const first = phases[0];
  if (first === undefined) return undefined;
  const phase = (tag: string): string | undefined => phases.find((fact) => fact.tag === tag)?.value;
  return compact({
    ga: phase('ga'),
    mature: phase('mature'),
    retirement: phase('retirement'),
    source: first.url,
  });
}

/** How far the project's version is behind the current one, or `undefined` when it is not. */
function behind(entry: ReportEntry): string | undefined {
  const installed = entry.project?.version;
  if (installed === undefined) return undefined;
  const current =
    entry.facts.find((fact) => fact.role === 'installable' && fact.tag === 'latest') ??
    entry.facts.find((fact) => fact.role === 'documented');
  if (current === undefined || compareVersions(installed, current.value) >= 0) return undefined;
  return `current is ${current.value}`;
}

/** Structured data of one product of a version report. */
export function versionsProduct(entry: ReportEntry): VersionsProduct {
  const { product, facts } = entry;
  const documented = facts.find((fact) => fact.role === 'documented');
  return compact({
    id: product.id,
    name: product.name,
    status: product.status,
    documented:
      documented &&
      compact({ version: documented.value, released: documented.date, source: documented.url }),
    installable: facts
      .filter((fact) => fact.role === 'installable')
      .map((fact) =>
        compact({
          registry: fact.registry ?? 'unknown',
          package: fact.package ?? product.id,
          version: fact.value,
          tag: fact.tag,
          published: fact.date,
          source: fact.url,
        }),
      ),
    project:
      entry.project &&
      compact({
        version: entry.project.version,
        file: entry.project.file,
        behind: behind(entry),
      }),
    prerelease: facts
      .filter((fact) => fact.role === 'prerelease')
      // A product of several packages names the one a pre-release belongs to.
      .map((fact) =>
        compact({
          tag: fact.tag ?? 'prerelease',
          version: fact.value,
          package: product.packages.length > 1 ? fact.package : undefined,
        }),
      ),
    lines: product.lines.map((line) => lineRow(product, line)),
    install: installLines(product),
    compatibility: entry.compatibility,
    lifecycle: lifecycleOf(facts),
    releaseNotes: entry.releaseNotes,
    notices: entry.notices,
    mismatches: entry.mismatches,
  });
}

function list(title: string, items: readonly string[]): string[] {
  return items.length === 0 ? [] : [`${title}:`, ...items.map((item) => `- ${item}`)];
}

/** One product's version facts as Markdown. Every release-notes ref and source URL is shown. */
export function renderVersionsProduct(item: VersionsProduct): string {
  const { documented, project, lifecycle } = item;
  const phases =
    lifecycle &&
    [
      lifecycle.ga && `GA ${lifecycle.ga}`,
      lifecycle.mature && `mature ${lifecycle.mature}`,
      lifecycle.retirement && `retirement ${lifecycle.retirement}`,
    ].filter((phase): phase is string => typeof phase === 'string');
  return [
    `## ${item.name} (${item.id}), ${item.status}`,
    documented
      ? `Documentation describes: ${documented.version}${documented.released ? `, released ${documented.released}` : ''} (${documented.source})`
      : 'Documentation describes: unknown',
    ...(project
      ? [
          `In this project: ${project.version} (${project.file})${project.behind ? `; ${project.behind}` : ''}`,
        ]
      : []),
    ...list(
      'Installable',
      item.installable.map(
        (entry) =>
          `${entry.package} ${entry.version} on ${entry.registry}${entry.tag ? ` [${entry.tag}]` : ''}${entry.published ? `, published ${entry.published}` : ''} (${entry.source})`,
      ),
    ),
    ...list(
      'Pre-release',
      item.prerelease.map(
        (entry) =>
          `${entry.tag}: ${entry.version}${entry.package === undefined ? '' : ` (${entry.package})`}`,
      ),
    ),
    ...list('Install', item.install),
    ...list(
      'Documentation lines',
      item.lines.map(
        (line) =>
          `${line.id} "${line.label}": ${line.docsUrl} (${line.access}; symbols: ${line.symbols})`,
      ),
    ),
    ...list(
      'Compatibility',
      item.compatibility.map(
        (row) =>
          `${row.with}: ${row.value}${row.unreleased ? ' (unreleased)' : ''} (${row.source})`,
      ),
    ),
    ...(lifecycle && phases ? [`Lifecycle: ${phases.join(', ')} (${lifecycle.source})`] : []),
    ...list(
      'Release notes',
      item.releaseNotes.map((note) => `${note.version}: ${note.ref}`),
    ),
    ...list('Mismatches', item.mismatches),
    ...list('Notices', item.notices),
  ].join('\n');
}
