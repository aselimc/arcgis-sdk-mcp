/**
 * The loaded catalogue indexes and their life cycle: load from the snapshot, build through
 * the adapter, swap in a rebuilt index only when it is not much smaller than the old one
 * (design section 6.4), and step down the enumeration ladder (section 6.6) on failure:
 * previous snapshot, then the registry's entry links.
 */
import { singleFlight } from '../../core/async.js';
import type { AdapterRegistry, Ctx, IndexState } from '../../core/ports.js';
import type { Product, SourceDef, VersionLine } from '../../core/types.js';
import { canEnumerate, enumerateSource, makeUnit, seedRecords } from './builder.js';
import { FAILING_SKIP_MS, type HealthTracker } from './health.js';
import {
  deleteSnapshot,
  loadSnapshot,
  saveSnapshot,
  sourceFingerprint,
  unitKey,
} from './snapshot.js';
import {
  INDEX_SCHEMA_VERSION,
  MAX_SNAPSHOT_AGE_MS,
  REVALIDATE_AFTER_MS,
  type Unit,
} from './types.js';

/** A failed build is not repeated before this much time has passed. */
export const RETRY_AFTER_MS = 60 * 1000;

/** Share of `memoryMaxMb` that loaded catalogue indexes may use. */
const INDEX_MEMORY_SHARE = 0.5;

const STATE_OF_ORIGIN = { fresh: 'ready', stale: 'stale', seed: 'partial' } as const;

/** The public state of a loaded unit. */
export function stateOf(unit: Unit): IndexState {
  return {
    product: unit.product,
    source: unit.source,
    line: unit.line,
    state: STATE_OF_ORIGIN[unit.origin],
    records: unit.records.length,
    builtAt: new Date(unit.builtAt).toISOString(),
  };
}

/** The public state of a source that has no loaded unit. */
export function stateWithout(
  product: Product,
  source: SourceDef,
  line: VersionLine,
  state: 'building' | 'unavailable',
): IndexState {
  return { product: product.id, source: source.id, line: line.id, state, records: 0 };
}

/** The units in memory and the one operation that brings a unit up to date. */
export interface UnitManager {
  /** Loaded units by `product/source/line`. */
  readonly units: Map<string, Unit>;
  /**
   * Makes the index of one source current: answers from memory when it is fresh, otherwise
   * loads the snapshot or builds, one build at a time per unit. Never rejects for an
   * upstream failure.
   */
  ensureUnit(product: Product, source: SourceDef, line: VersionLine): Promise<IndexState>;
}

/** Creates the unit manager. Health transitions are reported to `health`. */
export function createUnitManager(
  ctx: Ctx,
  adapters: AdapterRegistry,
  health: HealthTracker,
): UnitManager {
  const units = new Map<string, Unit>();
  const flights = singleFlight<string, IndexState>();
  const memoryLimit = ctx.config.memoryMaxMb * 1024 * 1024 * INDEX_MEMORY_SHARE;

  /** Puts a unit in memory and drops least recently used fresh ones beyond the memory bound. */
  const install = (unit: Unit): void => {
    units.set(unit.key, unit);
    let total = [...units.values()].reduce((sum, loaded) => sum + loaded.bytes, 0);
    const evictable = [...units.values()]
      // Only fresh units have a snapshot to come back from.
      .filter((loaded) => loaded.key !== unit.key && loaded.origin === 'fresh')
      .sort((a, b) => a.lastUsed - b.lastUsed);
    for (const candidate of evictable) {
      if (total <= memoryLimit) break;
      units.delete(candidate.key);
      total -= candidate.bytes;
    }
  };

  /** The rung below a fresh build: the previous snapshot if it may still be served, else entry links. */
  const fallBack = async (
    product: Product,
    source: SourceDef,
    line: VersionLine,
    previous: Unit | undefined,
    reason: string,
    retryAfterMs: number,
  ): Promise<IndexState> => {
    const now = ctx.clock.now();
    if (previous !== undefined && previous.origin !== 'seed') {
      if (now - previous.builtAt <= MAX_SNAPSHOT_AGE_MS) {
        previous.origin = 'stale';
        previous.reason = reason;
        previous.retryAt = now + retryAfterMs;
        units.set(previous.key, previous);
        return stateOf(previous);
      }
      await deleteSnapshot(ctx, product.id, source.id, line.id);
    }
    const links = seedRecords(ctx, product, source, line);
    const seeds = makeUnit(ctx, product, source, line, links, 'seed', now, reason);
    seeds.retryAt = now + retryAfterMs;
    install(seeds);
    return stateOf(seeds);
  };

  /** The previous index of a unit: the one in memory, else its snapshot on disk. */
  const previousOf = async (
    product: Product,
    source: SourceDef,
    line: VersionLine,
  ): Promise<Unit | undefined> => {
    const loaded = units.get(unitKey(product.id, source.id, line.id));
    if (loaded !== undefined) return loaded;
    const snapshot = await loadSnapshot(ctx, product.id, source, line);
    if (snapshot === undefined) return undefined;
    const current = ctx.clock.now() - snapshot.builtAt < REVALIDATE_AFTER_MS;
    const unit = makeUnit(
      ctx,
      product,
      source,
      line,
      snapshot.records,
      current ? 'fresh' : 'stale',
      snapshot.builtAt,
      current ? undefined : 'the snapshot is older than a day and is being revalidated',
    );
    install(unit);
    return unit;
  };

  const refresh = async (
    product: Product,
    source: SourceDef,
    line: VersionLine,
  ): Promise<IndexState> => {
    if (!canEnumerate(adapters, source)) {
      // A read-only source has nothing to enumerate: its entry links are its whole catalogue.
      const links = seedRecords(ctx, product, source, line);
      const fixed = makeUnit(ctx, product, source, line, links, 'fresh', ctx.clock.now());
      install(fixed);
      return stateOf(fixed);
    }

    const wasLoaded = units.has(unitKey(product.id, source.id, line.id));
    const previous = await previousOf(product, source, line);
    // A snapshot younger than a day that was just read from disk needs no rebuild.
    if (!wasLoaded && previous?.origin === 'fresh') return stateOf(previous);

    if (health.skip(product.id, source.id)) {
      const reason = health.get(product.id, source.id)?.lastError ?? 'the source is failing';
      return fallBack(product, source, line, previous, reason, RETRY_AFTER_MS);
    }

    const outcome = await enumerateSource(ctx, adapters, product, source, line);
    if (!outcome.ok) {
      if (outcome.disabled === true) {
        health.disabled(product.id, source.id, outcome.reason);
        return stateWithout(product, source, line, 'unavailable');
      }
      health.failed(product.id, source.id, outcome.reason);
      return fallBack(product, source, line, previous, outcome.reason, RETRY_AFTER_MS);
    }

    const { records } = outcome;
    const expected = source.probe.minRecords ?? 0;
    const previousCount =
      previous !== undefined && previous.origin !== 'seed' ? previous.records.length : 0;
    // Swap rule: a rebuilt index must not be much smaller than the one it replaces.
    const required = previousCount === 0 ? 1 : Math.max(expected, Math.ceil(previousCount / 2));
    if (records.length < required) {
      const reason =
        previousCount === 0
          ? 'the source returned no records'
          : `the rebuilt index had ${records.length} records, fewer than the ${required} needed to replace the previous ${previousCount}`;
      health.degraded(product.id, source.id, reason, previousCount);
      // An upstream that answers with a thin index will not improve within a minute.
      const retryAfter = previousCount === 0 ? RETRY_AFTER_MS : FAILING_SKIP_MS;
      return fallBack(product, source, line, previous, reason, retryAfter);
    }

    const builtAt = ctx.clock.now();
    const unit = makeUnit(ctx, product, source, line, records, 'fresh', builtAt);
    install(unit);
    await saveSnapshot(ctx, {
      v: INDEX_SCHEMA_VERSION,
      fingerprint: sourceFingerprint(source, line),
      product: product.id,
      source: source.id,
      line: line.id,
      builtAt,
      records,
    });
    if (records.length < expected) {
      const reason = `only ${records.length} records where at least ${expected} are expected`;
      health.degraded(product.id, source.id, reason, records.length);
    } else {
      health.ok(product.id, source.id, records.length, builtAt);
    }
    return stateOf(unit);
  };

  return {
    units,

    async ensureUnit(product, source, line) {
      const key = unitKey(product.id, source.id, line.id);
      const { capability } = source;
      if (capability !== undefined && !ctx.policy.enabled(capability)) {
        health.disabled(product.id, source.id, `capability "${capability}" is switched off`);
        units.delete(key);
        return stateWithout(product, source, line, 'unavailable');
      }
      if (
        line.access === 'link-only' &&
        (capability === 'website' || capability === 'site-index')
      ) {
        return stateWithout(product, source, line, 'unavailable');
      }

      const loaded = units.get(key);
      const now = ctx.clock.now();
      if (loaded !== undefined) {
        loaded.lastUsed = now;
        const current =
          loaded.origin === 'fresh'
            ? now - loaded.builtAt < REVALIDATE_AFTER_MS
            : loaded.retryAt !== undefined && now < loaded.retryAt;
        if (current) return stateOf(loaded);
      }
      return flights.run(key, () => refresh(product, source, line));
    },
  };
}
