/**
 * Builds one catalogue index: asks the source's adapter to enumerate within its own request
 * budget, cleans the records, and assembles the searchable unit. Failures are returned as
 * values, because an index build must never fail a tool call.
 */
import { bindSource } from '../../core/adapter-helpers.js';
import { budgetExhausted, newBudget } from '../../core/async.js';
import { isMcpDocError } from '../../core/errors.js';
import type { AdapterRegistry, Ctx } from '../../core/ports.js';
import type { CatalogRecord, Product, SourceDef, VersionLine } from '../../core/types.js';
import { buildCatalogIndex } from './minisearch-index.js';
import { contentHash, unitKey } from './snapshot.js';
import { buildSymbolMap } from './symbol-map.js';
import type { Unit, UnitOrigin } from './types.js';

/**
 * A build may run this many times longer than a tool call waits for it. The call gives up
 * waiting at `indexBuildDeadlineMs` and the build finishes in the background, so its own
 * request budget needs a later deadline than the wait.
 */
const BACKGROUND_DEADLINE_FACTOR = 6;

/** Result of one enumeration. */
export type BuildOutcome =
  { ok: true; records: CatalogRecord[] } | { ok: false; reason: string; disabled?: boolean };

function describe(error: unknown): string {
  if (isMcpDocError(error)) {
    const why = error.details?.why === undefined ? '' : ` (${error.details.why})`;
    return `${error.code}: ${error.message}${why}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Drops unusable and duplicate records and stamps the unit's identity on the rest. */
function clean(
  records: readonly CatalogRecord[],
  product: Product,
  source: SourceDef,
  line: VersionLine,
): CatalogRecord[] {
  const seen = new Set<string>();
  const kept: CatalogRecord[] = [];
  for (const record of records) {
    if (typeof record.ref !== 'string' || record.ref === '' || typeof record.title !== 'string') {
      continue;
    }
    if (seen.has(record.ref)) continue;
    seen.add(record.ref);
    kept.push({ ...record, product: product.id, source: source.id, line: line.id });
  }
  return kept;
}

/**
 * Enumerates a source through its adapter. The adapter gets a fresh budget of at most its
 * own `maxEnumerateRequests`; whatever it throws becomes a failed outcome with a reason.
 */
export async function enumerateSource(
  ctx: Ctx,
  adapters: AdapterRegistry,
  product: Product,
  source: SourceDef,
  line: VersionLine,
): Promise<BuildOutcome> {
  const { limits } = ctx.config;
  let budget;
  try {
    const adapter = adapters.get(source.adapter);
    if (adapter.enumerate === undefined) return { ok: true, records: [] };
    budget = newBudget(
      Math.min(limits.requestsPerIndexBuild, adapter.maxEnumerateRequests),
      limits.indexBuildDeadlineMs * BACKGROUND_DEADLINE_FACTOR,
      ctx.clock,
    );
    const records = await adapter.enumerate(
      ctx,
      bindSource(product, source, line, undefined, budget),
    );
    if (!Array.isArray(records))
      return { ok: false, reason: 'the adapter returned no record list' };
    return { ok: true, records: clean(records, product, source, line) };
  } catch (error) {
    if (!isMcpDocError(error)) {
      ctx.logger.warn('index build failed unexpectedly', {
        product: product.id,
        source: source.id,
        error,
      });
    }
    const spent = budget !== undefined && budgetExhausted(budget, ctx.clock);
    return {
      ok: false,
      reason: spent
        ? `request budget of the index build spent; ${describe(error)}`
        : describe(error),
      disabled: isMcpDocError(error) && error.code === 'SOURCE_DISABLED',
    };
  }
}

/** True when the source's adapter can enumerate; false also when no adapter is registered. */
export function canEnumerate(adapters: AdapterRegistry, source: SourceDef): boolean {
  try {
    return adapters.get(source.adapter).enumerate !== undefined;
  } catch {
    return false;
  }
}

/**
 * The last rung of the enumeration ladder: entry links from the registry. The source's root
 * page, the product's start-here links that belong to this source and, on the floor source,
 * the product homepage.
 */
export function seedRecords(
  ctx: Ctx,
  product: Product,
  source: SourceDef,
  line: VersionLine,
): CatalogRecord[] {
  const base = {
    product: product.id,
    source: source.id,
    line: line.id,
    kind: source.kinds[0] ?? 'guide',
    license: source.license ?? product.licenseTier,
  } as const;
  const records = new Map<string, CatalogRecord>();
  const add = (ref: string, title: string): void => {
    if (ref.startsWith('https://') && !records.has(ref)) records.set(ref, { ...base, ref, title });
  };

  add(bindSource(product, source, line).url(), `${product.name}: ${source.title}`);
  for (const entry of product.startHere) {
    let owner;
    try {
      owner = ctx.registry.ownerOf(new URL(entry.ref));
    } catch {
      continue;
    }
    if (owner?.product.id === product.id && owner.source.id === source.id) {
      add(entry.ref, entry.title);
    }
  }
  if (source.floor === true) add(product.homepage, product.name);
  return [...records.values()];
}

/** Rough heap cost of a record list with its search structures. */
function estimateBytes(records: readonly CatalogRecord[]): number {
  let chars = 0;
  for (const record of records) {
    chars +=
      record.ref.length +
      record.title.length +
      (record.description?.length ?? 0) +
      (record.qualified?.length ?? 0) +
      (record.breadcrumb?.length ?? 0);
  }
  // UTF-16 strings, plus the inverted index and per-object overhead.
  return chars * 4 + records.length * 400;
}

/** Assembles a loaded unit from records: search index, symbol sidecar and ref map. */
export function makeUnit(
  ctx: Ctx,
  product: Product,
  source: SourceDef,
  line: VersionLine,
  records: CatalogRecord[],
  origin: UnitOrigin,
  builtAt: number,
  reason?: string,
): Unit {
  return {
    key: unitKey(product.id, source.id, line.id),
    product: product.id,
    source: source.id,
    line: line.id,
    sourceRank: Math.max(
      0,
      product.sources.findIndex((candidate) => candidate.id === source.id),
    ),
    records,
    builtAt,
    origin,
    contentHash: contentHash(records),
    ...(reason === undefined ? {} : { reason }),
    search: buildCatalogIndex(records),
    symbols: buildSymbolMap(records),
    byRef: new Map(records.map((record) => [record.ref, record])),
    bytes: estimateBytes(records),
    lastUsed: ctx.clock.now(),
  };
}
