/**
 * What every oracle shares: the run options the version service passes down, option lookup
 * with the accepted spellings, the capability gate, and the rule that an oracle without an
 * answer returns `[]` instead of throwing.
 */
import { isMcpDocError, type McpDocError } from '../../core/errors.js';
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
  /** The capability its requests need (design section 4.8); `undefined` for `static`. */
  readonly capability: Capability | undefined;
  read(ctx: Ctx, product: Product, spec: OracleSpec, run?: OracleRun): Promise<VersionFact[]>;
  /** Like `read`, keeping the failure or the missing capability as evidence for the report. */
  attempt(ctx: Ctx, product: Product, spec: OracleSpec, run?: OracleRun): Promise<OracleOutcome>;
}

type Role = VersionFact['role'];

/**
 * Applies `OracleSpec.provides`. A fact whose role is listed (or any fact when the list is
 * empty) is kept. An oracle that naturally reports `installable` can be declared as
 * `documented` evidence and the other way round (a GitHub release that marks the documented
 * version, a banner that is the only install signal): the fact is relabelled. Everything else
 * is dropped.
 */
function applyProvides(facts: VersionFact[], spec: OracleSpec): VersionFact[] {
  const provides = new Set<string>(spec.provides);
  if (provides.size === 0) return facts;
  const swap: Partial<Record<Role, Role>> = { installable: 'documented', documented: 'installable' };
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

/** The first option present under any of the accepted keys, trimmed; empty values count as absent. */
export function option(spec: OracleSpec, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = spec.options[key]?.trim();
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}

/** Budget and signal of the run, shaped for `HttpRequest` and `GithubCallOptions`. */
export function requestOptions(run: OracleRun): { budget?: RequestBudget; signal?: AbortSignal } {
  return {
    ...(run.call?.budget === undefined ? {} : { budget: run.call.budget }),
    ...(run.call?.signal === undefined ? {} : { signal: run.call.signal }),
  };
}

/** The package an oracle asks a registry about: the `package` option, else the product's primary (or only) package there. */
export function packageOption(
  product: Product,
  spec: OracleSpec,
  registry: PackageRef['registry'],
): string | undefined {
  const named = option(spec, 'package', 'pkg', 'id', 'name');
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

/** The URL option of a spec (`url`, `page` or `path`), absolute for the line; `undefined` when not set. */
export function urlOption(spec: OracleSpec, line: VersionLine | undefined): string | undefined {
  const value = option(spec, 'url', 'page', 'path');
  return value === undefined ? undefined : resolveUrl(value, line);
}

/** A plain object, or `undefined`: registries occasionally answer with a JSON string or array. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** A non-empty string, or `undefined`. */
export function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}
