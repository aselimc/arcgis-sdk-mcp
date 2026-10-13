/**
 * Gathers everything `arcgis_docs_get_versions` says about one product: the facts of every
 * configured oracle, merged; compatibility rows; release-notes refs; and the notices that
 * put them in context (status, version line, deprecations, what could not be read).
 */
import { budgetExhausted } from '../core/async.js';
import { isMcpDocError } from '../core/errors.js';
import type { CallOptions, Ctx, VersionReport } from '../core/ports.js';
import type { Product, VersionFact, VersionLine } from '../core/types.js';
import { isPrerelease } from '../core/version-key.js';
import type { DetectedSdk } from '../workspace/index.js';
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

const sentence = (text: string): string => {
  const trimmed = text.trim().replace(/[.;]+$/, '');
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}.`;
};

/**
 * Where the product stands, from its life cycle dates when they are known. The registry
 * status is a word written on some day; a retirement date says whether that day has come,
 * so "retired" is never printed next to a retirement that is still ahead.
 */
function lifecycleSentence(
  product: Product,
  facts: readonly VersionFact[],
  today: string,
): string | undefined {
  const phase = (tag: string): string | undefined =>
    facts.find((fact) => fact.role === 'lifecycle' && fact.tag === tag)?.value;
  const passed = (date: string | undefined): boolean =>
    date !== undefined && date <= today.slice(0, date.length);
  const retirement = phase('retirement');
  if (retirement === undefined) return undefined;
  if (passed(retirement)) return `${product.name} was retired on ${retirement}`;
  const standing = passed(phase('mature'))
    ? 'is in mature support and '
    : product.status === 'deprecated'
      ? 'is deprecated and '
      : '';
  return `${product.name} ${standing}retires on ${retirement}`;
}

/**
 * One notice for a product that is not active: its standing, the registry's note, and the
 * successor. A note that states the status itself ("Retired 2025-02-01") is not preceded by
 * a second statement of it.
 */
function statusNotices(ctx: Ctx, product: Product, facts: readonly VersionFact[]): string[] {
  if (product.status === 'active') return [];
  const today = new Date(ctx.clock.now()).toISOString().slice(0, 10);
  const note = product.statusNote?.trim();
  const dated = lifecycleSentence(product, facts, today);
  const noteStatesStatus =
    note !== undefined && new RegExp(`\\b${product.status}\\b`, 'i').test(note);
  const parts: string[] = [];
  if (dated !== undefined) parts.push(sentence(dated));
  else if (!noteStatesStatus) parts.push(sentence(`${product.name} is ${product.status}`));
  if (note !== undefined) {
    parts.push(parts.length === 0 ? sentence(`${product.name}: ${note}`) : sentence(note));
  }
  if (product.successor !== undefined) {
    const name = ctx.registry.get(product.successor)?.name;
    parts.push(
      name === undefined
        ? `Successor: ${product.successor}.`
        : `Successor: ${name} (${product.successor}).`,
    );
  }
  return [parts.join(' ')];
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
      return { lines: [] as string[], complete: false };
    }),
  ]);

  // A product without a version oracle whose own column a matrix has (the web map and web
  // scene specifications in the JavaScript SDK matrix) is documented at that version. It is
  // not a fallback for oracles that failed: those end at "unknown", as the ladder says.
  const fromMatrix: VersionFact[] =
    product.oracles.length === 0 && compatibility.own !== undefined
      ? [
          {
            role: 'documented',
            value: compatibility.own.version,
            oracle: 'page-regex',
            url: compatibility.own.source,
          },
        ]
      : [];
  const facts = [...fromMatrix, ...merged.facts];
  const current = merged.current ?? fromMatrix[0]?.value;

  const notices = [
    ...statusNotices(ctx, product, facts),
    ...resolved.notices,
    ...lineNotices(product, line),
    ...(version === undefined ? [] : requestedNotices(version, current, facts)),
    ...merged.notices,
    ...(current === undefined && product.oracles.length > 0
      ? [failureNotice(product, outcomes, releaseNotes.refs[0]?.ref)]
      : []),
    ...compatibility.notices,
    ...releaseNotes.notices,
    ...deprecations.lines,
  ];
  const skipped = new Set<string>(outcomes.flatMap((outcome) => outcome.skipped ?? []));
  if (!ctx.policy.enabled('website')) skipped.add('website');
  const notes = Object.entries(CAPABILITY_NOTES)
    .filter(([capability]) => skipped.has(capability))
    .map(([, note]) => note);

  const transient = outcomes.some((outcome) => outcome.error?.details?.retryable === true);
  return {
    facts,
    ...(current === undefined ? {} : { current }),
    compatibility: compatibility.rows,
    releaseNotes: releaseNotes.refs,
    notices,
    mismatches: merged.mismatches,
    notes,
    complete:
      !transient &&
      !deprecationsFailed &&
      deprecations.complete &&
      compatibility.notices.length === 0 &&
      // A notice about a version that has no page is an answer; an unreadable listing is not.
      releaseNotes.complete &&
      !budgetExhausted(call.budget, ctx.clock),
  };
}

/** The project's entry for a product: a package with a stated version first, the primary package before others. */
export function projectSdk(
  product: Product,
  sdks: readonly DetectedSdk[],
): DetectedSdk | undefined {
  const own = sdks.filter((sdk) => sdk.product === product.id);
  return own.find((sdk) => sdk.version !== '') ?? own[0];
}

/**
 * The notice that relates the project's version to the current one. A range is reported as
 * a range: its lowest version is what lookups assume, not what is installed.
 */
function projectNotice(sdk: DetectedSdk, current: string | undefined): string[] {
  if (sdk.version === '') {
    return [`The project uses ${sdk.package} (${sdk.file}) without stating a version.`];
  }
  const order = current === undefined ? undefined : compareAtSharedPrecision(sdk.version, current);
  if (order === undefined || order === 0 || current === undefined) return [];
  if (sdk.range !== undefined && order < 0) {
    return [
      `The project declares ${sdk.package} ${sdk.range} (${sdk.file}): a range, and no lock file states the installed version. It is at least ${sdk.version} and may be as new as the current ${current}. Documentation lookups assume ${sdk.version}; pass "version" when another one is installed.`,
    ];
  }
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
  sdks: readonly DetectedSdk[],
  projectWarnings: readonly string[],
): ProductReport {
  const found = projectSdk(product, sdks);
  // What the manifest states, as it states it: `^5.0.4` is not the installed version 5.0.4.
  const project =
    found === undefined
      ? undefined
      : {
          product: found.product,
          package: found.package,
          version: found.range ?? found.version,
          file: found.file,
        };
  return {
    product,
    facts: gathered.facts,
    ...(project === undefined ? {} : { project }),
    compatibility: gathered.compatibility,
    releaseNotes: gathered.releaseNotes,
    notices: [
      ...gathered.notices,
      ...(found === undefined ? [] : projectNotice(found, gathered.current)),
      ...projectWarnings,
    ],
    mismatches: gathered.mismatches,
  };
}
