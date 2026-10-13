/**
 * Gathers everything `arcgis_docs_get_versions` says about one product: the facts of every
 * configured oracle, merged; compatibility rows; release-notes refs; and the notices that
 * put them in context (status, version line, deprecations, what could not be read).
 */
import { budgetExhausted } from '../core/async.js';
import { isMcpDocError } from '../core/errors.js';
import type { CallOptions, Ctx, VersionReport } from '../core/ports.js';
import type { Product, VersionFact, VersionLine, WorkspaceSdk } from '../core/types.js';
import { isPrerelease } from '../core/version-key.js';
import { readCompatibility } from './compatibility.js';
import { deprecationNotices } from './deprecations.js';
import { mergeFacts } from './merge.js';
import { ORACLES, type OracleOutcome } from './oracles/index.js';
import { currentLine } from './oracles/kit.js';
import { locateReleaseNotes } from './release-notes.js';
import { belongsToLine, compareAtSharedPrecision, lineNumbers } from './version-text.js';

/** One product entry of a `VersionReport`. */
export type ProductReport = VersionReport['products'][number];

/** The part of a product entry that does not depend on the user's project, so it can be cached. */
export interface GatheredProduct {
  facts: VersionFact[];
  /** The version treated as current for the reported line. */
  current?: string;
  compatibility: ProductReport['compatibility'];
  releaseNotes: ProductReport['releaseNotes'];
  notices: string[];
  mismatches: string[];
  /** Report-level remarks: capabilities that are off. */
  notes: string[];
  /** False when something failed that may work on the next call; such a result is not cached. */
  complete: boolean;
}

const CAPABILITY_NOTES: Readonly<Record<string, string>> = {
  registries:
    'Package registries are switched off (capability "registries"): installable versions are not reported.',
  github: 'GitHub is switched off (capability "github"): release tags are not reported.',
  website:
    'Documentation websites are switched off (capability "website"): documented versions, compatibility tables and release-notes listings are not reported.',
};

/** The line a version belongs to; an unknown version falls back to the current line with a notice. */
function resolveLine(
  ctx: Ctx,
  product: Product,
  version: string | undefined,
): { line: VersionLine | undefined; notices: string[] } {
  if (version === undefined) return { line: currentLine(product), notices: [] };
  try {
    return { line: ctx.registry.line(product, version), notices: [] };
  } catch (error) {
    if (!isMcpDocError(error) || error.code !== 'VERSION_UNAVAILABLE') throw error;
    const lines = product.lines.map((line) => `${line.id} (${line.label})`).join(', ');
    return {
      line: currentLine(product),
      notices: [
        `${product.name} has no documentation line for "${version}"; lines: ${lines}. The facts below describe the current line.`,
      ],
    };
  }
}

/** On a line with its own version numbers (`v200`), facts about other lines are not answers. */
function factsOfLine(facts: VersionFact[], line: VersionLine | undefined): VersionFact[] {
  if (line === undefined || line.current || lineNumbers(line).length === 0) return facts;
  return facts.filter((fact) => fact.role === 'lifecycle' || belongsToLine(fact.value, line));
}

function statusNotices(ctx: Ctx, product: Product): string[] {
  if (product.status === 'active') return [];
  const successor =
    product.successor === undefined
      ? undefined
      : (ctx.registry.get(product.successor)?.name ?? product.successor);
  const parts = [
    `${product.name} is ${product.status}`,
    ...(product.statusNote === undefined ? [] : [product.statusNote]),
    ...(successor === undefined ? [] : [`successor: ${successor} (${product.successor})`]),
  ];
  return [`${parts.join('; ')}.`];
}

function lineNotices(product: Product, line: VersionLine | undefined): string[] {
  if (line === undefined || line.current) return [];
  const current = currentLine(product);
  const notices = [
    `Line "${line.label}" is not the current line of ${product.name}${current === undefined ? '' : `; the current line is "${current.label}"`}.`,
  ];
  if (line.access === 'link-only') {
    notices.push(
      `Documentation pages of line "${line.label}" are link-only: they are not fetched.`,
    );
  }
  return notices;
}

/** How the requested version relates to the current one and to the pre-release builds. */
function requestedNotices(
  version: string,
  current: string | undefined,
  facts: readonly VersionFact[],
): string[] {
  const preview = facts.find(
    (fact) => fact.role === 'prerelease' && compareAtSharedPrecision(fact.value, version) === 0,
  );
  const known = facts.some(
    (fact) =>
      (fact.role === 'installable' || fact.role === 'documented') &&
      compareAtSharedPrecision(fact.value, version) === 0,
  );
  if (isPrerelease(version) || (preview !== undefined && !known)) {
    const tag = preview?.tag === undefined ? '' : ` (tag "${preview.tag}": ${preview.value})`;
    return [`${version} is a pre-release${tag}, not a generally available version.`];
  }
  const order = current === undefined ? undefined : compareAtSharedPrecision(version, current);
  if (order === undefined || order === 0 || current === undefined) return [];
  return order < 0
    ? [`${version} is older than the current version ${current}.`]
    : [
        `${version} is newer than the current version ${current}: it is not released yet or not known here.`,
      ];
}

/** Why oracles had no answer, for the case where no current version could be established. */
function failureNotice(
  product: Product,
  outcomes: readonly OracleOutcome[],
  ref: string | undefined,
): string {
  const reasons = [
    ...new Set(
      outcomes.flatMap((outcome) => [
        ...(outcome.error === undefined ? [] : [outcome.error.code]),
        ...(outcome.skipped === undefined ? [] : [`capability ${outcome.skipped} off`]),
      ]),
    ),
  ];
  const why = reasons.length === 0 ? '' : ` (${reasons.join(', ')})`;
  const where = ref ?? product.homepage;
  return `The current version of ${product.name} is unknown${why}; check ${where}.`;
}

/**
 * Runs the oracles of a product and assembles the cacheable part of its report entry.
 *
 * @param version the version the caller asked about, as written.
 */
export async function gatherProduct(
  ctx: Ctx,
  product: Product,
  version: string | undefined,
  call: CallOptions,
): Promise<GatheredProduct> {
  const resolved = resolveLine(ctx, product, version);
  const line = resolved.line;
  const run = {
    call,
    ...(line === undefined ? {} : { line }),
    ...(version === undefined ? {} : { version }),
  };
  const outcomes = await Promise.all(
    product.oracles.map((spec) => ORACLES[spec.type].attempt(ctx, product, spec, run)),
  );
  const merged = mergeFacts(
    product,
    factsOfLine(
      outcomes.flatMap((outcome) => outcome.facts),
      line,
    ),
  );
  const target = version ?? merged.current;

  let deprecationsFailed = false;
  const [compatibility, releaseNotes, deprecations] = await Promise.all([
    readCompatibility(ctx, product, {
      call,
      ...(line === undefined ? {} : { line }),
      ...(target === undefined ? {} : { target }),
      ...(merged.current === undefined ? {} : { current: merged.current }),
    }),
    locateReleaseNotes(ctx, product, {
      call,
      ...(line === undefined ? {} : { line }),
      ...(version === undefined ? {} : { version }),
      ...(merged.current === undefined ? {} : { current: merged.current }),
    }),
    deprecationNotices(ctx, product, call).catch((error: unknown) => {
      if (!isMcpDocError(error)) throw error;
      // Notices are an extra: a missing Knowledge Base sitemap must not fail the report.
      deprecationsFailed = true;
      return [] as string[];
    }),
  ]);

  const notices = [
    ...statusNotices(ctx, product),
    ...resolved.notices,
    ...lineNotices(product, line),
    ...(version === undefined ? [] : requestedNotices(version, merged.current, merged.facts)),
    ...merged.notices,
    ...(merged.current === undefined && product.oracles.length > 0
      ? [failureNotice(product, outcomes, releaseNotes.refs[0]?.ref)]
      : []),
    ...compatibility.notices,
    ...releaseNotes.notices,
    ...deprecations,
  ];
  const skipped = new Set<string>(outcomes.flatMap((outcome) => outcome.skipped ?? []));
  if (!ctx.policy.enabled('website')) skipped.add('website');
  const notes = Object.entries(CAPABILITY_NOTES)
    .filter(([capability]) => skipped.has(capability))
    .map(([, note]) => note);

  const transient = outcomes.some((outcome) => outcome.error?.details?.retryable === true);
  return {
    facts: merged.facts,
    ...(merged.current === undefined ? {} : { current: merged.current }),
    compatibility: compatibility.rows,
    releaseNotes: releaseNotes.refs,
    notices,
    mismatches: merged.mismatches,
    notes,
    complete:
      !transient &&
      !deprecationsFailed &&
      compatibility.notices.length === 0 &&
      releaseNotes.notices.length === 0 &&
      !budgetExhausted(call.budget, ctx.clock),
  };
}

/** The project's entry for a product: a package with a stated version first, the primary package before others. */
export function projectSdk(
  product: Product,
  sdks: readonly WorkspaceSdk[],
): WorkspaceSdk | undefined {
  const own = sdks.filter((sdk) => sdk.product === product.id);
  return own.find((sdk) => sdk.version !== '') ?? own[0];
}

/** The notice that relates the project's version to the current one. */
function projectNotice(sdk: WorkspaceSdk, current: string | undefined): string[] {
  if (sdk.version === '') {
    return [`The project uses ${sdk.package} (${sdk.file}) without stating a version.`];
  }
  const order = current === undefined ? undefined : compareAtSharedPrecision(sdk.version, current);
  if (order === undefined || order === 0 || current === undefined) return [];
  return order < 0
    ? [
        `The project uses ${sdk.package} ${sdk.version} (${sdk.file}); the current version is ${current}. Read documentation for ${sdk.version}, not for the current version.`,
      ]
    : [
        `The project uses ${sdk.package} ${sdk.version} (${sdk.file}), which is newer than the documented version ${current}.`,
      ];
}

/** Joins the cacheable part with the user's project: the detected SDK and project-specific notices. */
export function toProductReport(
  product: Product,
  gathered: GatheredProduct,
  sdks: readonly WorkspaceSdk[],
  projectWarnings: readonly string[],
): ProductReport {
  const project = projectSdk(product, sdks);
  return {
    product,
    facts: gathered.facts,
    ...(project === undefined ? {} : { project }),
    compatibility: gathered.compatibility,
    releaseNotes: gathered.releaseNotes,
    notices: [
      ...gathered.notices,
      ...(project === undefined ? [] : projectNotice(project, gathered.current)),
      ...projectWarnings,
    ],
    mismatches: gathered.mismatches,
  };
}
