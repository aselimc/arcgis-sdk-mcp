/**
 * What every oracle shares: the run options the version service passes down, option lookup,
 * the capability gate, and the rule that an oracle without an answer returns `[]` instead
 * of throwing.
 *
 * An option has one name, listed in `ORACLE_OPTION_KEYS` (`src/registry/oracle-options.ts`),
 * which the registry schema enforces: there are no alternative spellings to keep in step.
 */
import { isMcpDocError, type McpDocError } from '../../core/errors.js';
import { isRecord } from '../../core/json.js';
import { DEVELOPERS_ORIGIN } from '../../core/names.js';
import type { CallOptions, Ctx, RequestBudget, VersionOracle } from '../../core/ports.js';
import { expandTemplate } from '../../core/source-urls.js';
import type {
  Capability,
  OracleSpec,
  OracleType,
  PackageRef,
  Product,
  VersionFact,
  VersionLine,
} from '../../core/types.js';
import type { OracleOptionKey } from '../../registry/oracle-options.js';

/** Per-run context of an oracle; everything is optional so the port's three-argument call works. */
export interface OracleRun {
  /** The tool call's budget and abort signal. */
  call?: CallOptions;
  /** The version line the report is about; absent means the current line. */
  line?: VersionLine;
  /** The version the caller asked about, as written. */
  version?: string;
}

/** Result of one oracle attempt, with the reason when it produced nothing. */
export interface OracleOutcome {
  facts: VersionFact[];
  /** The upstream failure that left the oracle without an answer. */
  error?: McpDocError;
  /** The capability that is switched off, when the oracle was not run for that reason. */
  skipped?: Capability;
}

/** The function an oracle module writes: may reject with `McpDocError`. */
export type OracleReader = (
  ctx: Ctx,
  product: Product,
  spec: OracleSpec,
  run: OracleRun,
) => Promise<VersionFact[]>;

/** A {@link VersionOracle} that also reports why it had no answer. */
export interface DefinedOracle extends VersionOracle {
  /** The capability its requests need; `undefined` for `static`. */
  readonly capability: Capability | undefined;
  read(ctx: Ctx, product: Product, spec: OracleSpec, run?: OracleRun): Promise<VersionFact[]>;
  /** Like `read`, keeping the failure or the missing capability as evidence for the report. */
  attempt(ctx: Ctx, product: Product, spec: OracleSpec, run?: OracleRun): Promise<OracleOutcome>;
}

type Role = VersionFact['role'];

/**
 * Applies `OracleSpec.provides`. A fact whose role is listed (or any fact when the list is
 * empty) is kept; `released` stands for the release date of the documented version, so it
 * admits `documented` facts. An oracle that naturally reports `installable` can be declared
 * as `documented` evidence and the other way round (a GitHub release that dates the
 * documented version, a banner that is the only install signal): the fact is relabelled.
 * Everything else is dropped.
 */
function applyProvides(facts: VersionFact[], spec: OracleSpec): VersionFact[] {
  const provides = new Set<string>(spec.provides);
  if (provides.size === 0) return facts;
  if (provides.has('released')) provides.add('documented');
  const swap: Partial<Record<Role, Role>> = {
    installable: 'documented',
    documented: 'installable',
  };
  const natural = new Set(facts.map((fact) => fact.role));
  return facts.flatMap((fact) => {
    if (provides.has(fact.role)) return [fact];
    const other = swap[fact.role];
    // Relabel only when the declared role is one this oracle never produces by itself.
    if (other !== undefined && provides.has(other) && !natural.has(other)) {
      return [{ ...fact, role: other }];
    }
    return [];
  });
}

/** Wraps a reader into an oracle: capability gate, `provides` filter, failures as `[]`. */
export function defineOracle(
  type: OracleType,
  capability: Capability | undefined,
  reader: OracleReader,
): DefinedOracle {
  const attempt = async (
    ctx: Ctx,
    product: Product,
    spec: OracleSpec,
    run: OracleRun = {},
  ): Promise<OracleOutcome> => {
    if (capability !== undefined && !ctx.policy.enabled(capability)) {
      return { facts: [], skipped: capability };
    }
    try {
      return { facts: applyProvides(await reader(ctx, product, spec, run), spec) };
    } catch (error) {
      // Programming errors must surface; only upstream conditions mean "no answer".
      if (!isMcpDocError(error)) throw error;
      ctx.logger.debug('version oracle had no answer', {
        oracle: type,
        product: product.id,
        code: error.code,
        url: error.details?.url,
      });
      return { facts: [], error };
    }
  };
  return {
    type,
    capability,
    attempt,
    read: async (ctx, product, spec, run) => (await attempt(ctx, product, spec, run)).facts,
  };
}

/** The option of a spec under its one key, trimmed; an empty value counts as absent. */
export function option(spec: OracleSpec, key: OracleOptionKey): string | undefined {
  const value = spec.options[key]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

/** Budget and signal of the run, shaped for `HttpRequest` and `GithubCallOptions`. */
export function requestOptions(run: OracleRun): { budget?: RequestBudget; signal?: AbortSignal } {
  return {
    ...(run.call?.budget === undefined ? {} : { budget: run.call.budget }),
    ...(run.call?.signal === undefined ? {} : { signal: run.call.signal }),
  };
}

/**
 * The package an oracle asks a registry about: the option that names it (`package`; NuGet
 * calls it `id`), else the product's primary (or only) package there.
 */
export function packageOption(
  product: Product,
  spec: OracleSpec,
  registry: PackageRef['registry'],
  key: 'package' | 'id' = 'package',
): string | undefined {
  const named = option(spec, key);
  if (named !== undefined) return named;
  const candidates = product.packages.filter((ref) => ref.registry === registry);
  return (candidates.find((ref) => ref.primary === true) ?? candidates[0])?.name;
}

/** The current line of a product (the registry guarantees exactly one). */
export function currentLine(product: Product): VersionLine | undefined {
  return product.lines.find((line) => line.current) ?? product.lines[0];
}

/**
 * Makes a registry URL or path absolute for one version line: line variables are substituted
 * and a path is placed on developers.arcgis.com.
 */
export function resolveUrl(urlOrPath: string, line: VersionLine | undefined): string {
  const expanded = line === undefined ? urlOrPath : expandTemplate(urlOrPath, line);
  return new URL(expanded, `${DEVELOPERS_ORIGIN}/`).href;
}

/**
 * The product's entry page for a line. A non-current line that keeps its pages under a
 * `{prefix}` (native SDKs: `v200/`) gets that prefix appended, which is where its banner,
 * sitemap and release-notes stub live.
 */
export function homeUrl(product: Product, line: VersionLine | undefined): string {
  const home = resolveUrl(product.homepage, line);
  const prefix = line?.vars.prefix;
  if (prefix === undefined || prefix === '' || line?.current === true) return home;
  const base = home.endsWith('/') ? home : `${home}/`;
  return base.endsWith(`/${prefix}`) ? base : `${base}${prefix}`;
}

/**
 * A registry URL for one version line. Line variables are substituted; a URL under the
 * product's home page that does not use them is moved under the line's own home, so one
 * registry value serves `/net/release-notes/` and `/net/v200/release-notes/`.
 */
export function lineUrl(
  urlOrPath: string,
  product: Product,
  line: VersionLine | undefined,
): string {
  const url = resolveUrl(urlOrPath, line);
  const home = resolveUrl(product.homepage, line);
  const lineHome = homeUrl(product, line);
  if (lineHome === home || !url.startsWith(home) || url.startsWith(lineHome)) return url;
  return `${lineHome}${url.slice(home.length)}`;
}

/** The `url` option of a spec for the line; `undefined` when not set. */
export function urlOption(
  spec: OracleSpec,
  product: Product,
  line: VersionLine | undefined,
): string | undefined {
  const value = option(spec, 'url');
  return value === undefined ? undefined : lineUrl(value, product, line);
}

/** A plain object, or `undefined`: registries occasionally answer with a JSON string or array. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

/** A non-empty string, or `undefined`. */
export function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}
