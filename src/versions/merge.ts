/**
 * The merge rules of `arcgis_docs_get_versions` (design section 3.3, research section 8.1).
 * Pure: facts in, ordered facts and sentences out.
 *
 * - "Documented" (what the docs describe) and "installable" (what a package manager serves)
 *   are separate answers; when they disagree both are reported with a mismatch line.
 * - A registry value counts as current only with a general-availability signal: npm
 *   dist-tag `latest` or an `lts-*` tag, PyPI's `info.version`, the newest stable NuGet or
 *   pub.dev version, a non-pre-release GitHub release. The oracles report exactly those as
 *   `installable` and everything ahead of a release as `prerelease`, which never counts.
 * - `latest` is not always the newest release: the current installable version of a package
 *   is the highest one among its general-availability facts.
 *
 * The returned `facts` are ordered so that **the first fact of each role is the answer** and
 * the ones after it are evidence: presenters take `facts.find(f => f.role === ...)`.
 */
import type { Product, VersionFact } from '../core/types.js';
import { compareVersions } from '../core/version-key.js';
import { compareAtSharedPrecision } from './version-text.js';

/** Outcome of {@link mergeFacts}. */
export interface MergedFacts {
  /** All facts, the winner of each role first. */
  facts: VersionFact[];
  /** The version the documentation describes. */
  documented?: VersionFact;
  /** The newest generally available version of the product's primary package. */
  installable?: VersionFact;
  /** The version to treat as current: documented when known, else installable. */
  current?: string;
  mismatches: string[];
  notices: string[];
}

const LIFECYCLE_ORDER = ['ga', 'mature', 'retirement'];

const channelKey = (fact: VersionFact): string => `${fact.registry ?? ''}:${fact.package ?? ''}`;

/** "pypi arcgis", "github Esri/arcgis-python-api": how a sentence names where a fact comes from. */
function channelName(fact: VersionFact): string {
  return [fact.registry, fact.package].filter((part) => part !== undefined).join(' ');
}

/**
 * Installable facts grouped by registry and package: the product's primary package first,
 * the others in oracle order; inside a group the newest version leads.
 */
function orderInstallable(product: Product, facts: readonly VersionFact[]): VersionFact[][] {
  const groups = new Map<string, VersionFact[]>();
  for (const fact of facts) {
    const group = groups.get(channelKey(fact)) ?? [];
    group.push(fact);
    groups.set(channelKey(fact), group);
  }
  const primary = (
    product.packages.find((ref) => ref.primary === true) ?? product.packages[0]
  )?.name.toLowerCase();
  const ordered = [...groups.values()].map((group) =>
    [...group].sort((a, b) => compareVersions(b.value, a.value)),
  );
  const isPrimary = (group: VersionFact[]): boolean =>
    primary !== undefined && group[0]?.package?.toLowerCase() === primary;
  // A stable sort keeps oracle order among the non-primary channels.
  return ordered.sort((a, b) => Number(isPrimary(b)) - Number(isPrimary(a)));
}

/** The newest version of a channel. */
const channelCurrent = (group: readonly VersionFact[]): VersionFact | undefined => group[0];

function describeDate(fact: VersionFact): string {
  return fact.date === undefined ? '' : ` (${fact.date})`;
}

/** A dist-tag `latest` that is older than another general-availability tag of the same package. */
function staleLatestLines(groups: readonly VersionFact[][]): string[] {
  const lines: string[] = [];
  for (const group of groups) {
    const newest = channelCurrent(group);
    const latest = group.find((fact) => fact.tag === 'latest');
    if (newest === undefined || latest === undefined || newest === latest) continue;
    if (compareVersions(newest.value, latest.value) <= 0) continue;
    lines.push(
      `${channelName(latest)}: dist-tag "latest" is ${latest.value}, but "${newest.tag ?? 'another tag'}" serves the newer ${newest.value}. Install ${newest.value} explicitly to get the newest release.`,
    );
  }
  return lines;
}

/** The documentation and the primary package disagree about the current version. */
function documentedLine(
  documented: VersionFact | undefined,
  installable: VersionFact | undefined,
): string[] {
  // A static registry value is a last resort, not evidence against a live registry.
  if (documented === undefined || installable === undefined || documented.oracle === 'static') {
    return [];
  }
  const order = compareAtSharedPrecision(documented.value, installable.value);
  if (order === undefined || order === 0) return [];
  const docs = `the documentation describes ${documented.value}${describeDate(documented)}`;
  const served = `${channelName(installable)} serves ${installable.value}${describeDate(installable)}`;
  return order > 0
    ? [
        `Documented and installable versions differ: ${docs}, but ${served}. APIs new in ${documented.value} may not be installable from ${installable.registry ?? 'the registry'} yet.`,
      ]
    : [
        `Documented and installable versions differ: ${served}, but ${docs}. The documentation may lag the package.`,
      ];
}

/**
 * Other channels (a GitHub release, a second registry) that disagree with the primary one.
 * A companion package of the product (a plug-in such as `esri-leaflet-vector`) is not
 * another channel of the same release: it has version numbers of its own, and a different
 * number there is no disagreement.
 */
function channelLines(product: Product, groups: readonly VersionFact[][]): string[] {
  const primary = groups[0] === undefined ? undefined : channelCurrent(groups[0]);
  if (primary === undefined) return [];
  const companions = new Set(
    product.packages
      .map((ref) => ref.name.toLowerCase())
      .filter((name) => name !== primary.package?.toLowerCase()),
  );
  const lines: string[] = [];
  for (const group of groups.slice(1)) {
    const other = channelCurrent(group);
    if (other === undefined || companions.has(other.package?.toLowerCase() ?? '')) continue;
    const order = compareAtSharedPrecision(other.value, primary.value);
    if (order === undefined || order === 0) continue;
    lines.push(
      `${channelName(other)} has ${other.value}${describeDate(other)}, which is ${order > 0 ? 'newer' : 'older'} than ${channelName(primary)} ${primary.value}${describeDate(primary)}.`,
    );
  }
  return lines;
}

/**
 * The winning documented fact. A banner without a date takes the date of another documented
 * fact for the same version (a GitHub release declared as `released` evidence).
 */
function withEvidenceDate(documented: readonly VersionFact[]): VersionFact | undefined {
  const winner = documented[0];
  if (winner === undefined || winner.date !== undefined) return winner;
  const dated = documented.find(
    (fact) => fact.date !== undefined && compareAtSharedPrecision(fact.value, winner.value) === 0,
  );
  return dated?.date === undefined ? winner : { ...winner, date: dated.date };
}

/**
 * Orders the facts of one product and derives the mismatch and notice lines.
 *
 * @param facts every fact gathered, in the order of `Product.oracles`.
 */
export function mergeFacts(product: Product, facts: readonly VersionFact[]): MergedFacts {
  const byRole = (role: VersionFact['role']): VersionFact[] =>
    facts.filter((fact) => fact.role === role);

  // Live evidence beats the registry's own static value whatever the oracle order says.
  const documentedFacts = byRole('documented').sort(
    (a, b) => Number(a.oracle === 'static') - Number(b.oracle === 'static'),
  );
  const groups = orderInstallable(product, byRole('installable'));
  const lifecycle = byRole('lifecycle').sort(
    (a, b) => LIFECYCLE_ORDER.indexOf(a.tag ?? '') - LIFECYCLE_ORDER.indexOf(b.tag ?? ''),
  );
  const prerelease = byRole('prerelease');

  const documented = withEvidenceDate(documentedFacts);
  if (documented !== undefined) documentedFacts[0] = documented;
  const installable = groups.map(channelCurrent).find((fact) => fact !== undefined);
  const current = documented?.value ?? installable?.value;

  const notices: string[] = [];
  if (documented?.oracle === 'static') {
    notices.push(
      `Version ${documented.value} is a registry value as of ${product.verifiedOn}, not read live.`,
    );
  }
  if (current === undefined && prerelease.length > 0) {
    const builds = prerelease.map((fact) => `${fact.tag ?? 'pre-release'} ${fact.value}`);
    notices.push(
      `Only pre-release builds were found (${builds.join(', ')}); no generally available version is confirmed.`,
    );
  }

  return {
    facts: [...documentedFacts, ...groups.flat(), ...prerelease, ...lifecycle],
    ...(documented === undefined ? {} : { documented }),
    ...(installable === undefined ? {} : { installable }),
    ...(current === undefined ? {} : { current }),
    mismatches: [
      ...documentedLine(documented, installable),
      ...staleLatestLines(groups),
      ...channelLines(product, groups),
    ],
    notices,
  };
}
