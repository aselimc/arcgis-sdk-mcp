/**
 * What a symbol lookup is aimed at: a product, the version line to search, and the version
 * to read where sources address versions themselves (design decision 7).
 */
import type { Ctx, SymbolRequest } from '../../core/ports.js';
import type { Product, SourceDef, VersionLine } from '../../core/types.js';
import type { Scope } from '../scope.js';

/** Adapters that address versions themselves and so can answer for any released version. */
export const VERSION_ADDRESSED: ReadonlySet<string> = new Set([
  'npm-dts',
  'npm-cem',
  'npm-json',
  'github-repo',
  'xmldoc',
]);

/** One product of the scope with the line and version being looked up. */
export interface Target {
  product: Product;
  line: VersionLine;
  /** The version asked for or detected in the project, as written. */
  version?: string;
  /** True when `version` came from the caller rather than from the project. */
  explicit: boolean;
  /** True when versioned packages should answer before the site reference. */
  preferVersioned: boolean;
}

/**
 * The target for one product. The version is the caller's, else the one detected in the
 * project. Versioned packages are preferred when a version was asked for, or when the
 * detected one belongs to a line other than the current.
 *
 * @throws McpDocError `VERSION_UNAVAILABLE` when the caller's version names no line and the
 *   product has no source that can read arbitrary versions.
 */
export function targetOf(ctx: Ctx, product: Product, scope: Scope, req: SymbolRequest): Target {
  const detected = scope.workspace.find((sdk) => sdk.product === product.id)?.version;
  const version = req.version ?? detected;
  const explicit = req.version !== undefined;
  const base = { product, explicit, ...(version === undefined ? {} : { version }) };
  try {
    const line = ctx.registry.line(product, version);
    return {
      ...base,
      line,
      preferVersioned: version !== undefined && (explicit || !line.current),
    };
  } catch (error) {
    // A version without a documentation line can still be read from versioned packages;
    // a detected one that fits no line just means "use the current docs".
    const versioned = product.sources.some((source) => VERSION_ADDRESSED.has(source.adapter));
    if (explicit && !versioned) throw error;
    return { ...base, line: ctx.registry.line(product), preferVersioned: explicit };
  }
}

/**
 * The sources of a product whose indexes hold symbols: the scoped one when the caller wrote
 * `product/source`, else every API-reference and spec source (all sources when none is
 * marked as such).
 */
export function symbolSources(
  product: Product,
  scoped: SourceDef | undefined,
): string[] | undefined {
  if (scoped !== undefined) return [scoped.id];
  const reference = product.sources.filter(
    (source) => source.kinds.includes('api') || source.kinds.includes('spec'),
  );
  return reference.length === 0 ? undefined : reference.map((source) => source.id);
}

/**
 * Rank of a record's source for a target: the source order of the product, with versioned
 * packages moved to the front when the target prefers them.
 */
export function sourceRank(target: Target, sourceId: string): number {
  const { sources } = target.product;
  const rank = sources.findIndex((source) => source.id === sourceId);
  const source = sources[rank];
  const versioned = source !== undefined && VERSION_ADDRESSED.has(source.adapter);
  return target.preferVersioned && versioned ? rank - sources.length : rank;
}
