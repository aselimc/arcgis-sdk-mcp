/**
 * The index service (design section 6.4): one catalogue index per (product, source, line),
 * built on first use, persisted as a snapshot, revalidated after a day, and never replaced
 * by a worse one. Every failure ends on a lower rung of the enumeration ladder (previous
 * snapshot, then registry entry links) instead of an error.
 */
import { DeadlineExceededError, singleFlight, withDeadline } from '../../core/async.js';
import { shortHash } from '../../core/hash.js';
import type { AdapterRegistry, CallOptions, Ctx, IndexState } from '../../core/ports.js';
import type { Product, SourceDef, VersionLine } from '../../core/types.js';
import { createBodyIndex } from './body-index.js';
import { canEnumerate, enumerateSource, makeUnit, seedRecords } from './builder.js';
import { createHealthTracker, FAILING_SKIP_MS } from './health.js';
import { runCatalogQuery, unitsInScope } from './query.js';
import {
  deleteSnapshot,
  loadSnapshot,
  saveSnapshot,
  sourceFingerprint,
  unitKey,
} from './snapshot.js';
import { mergeSymbolMaps } from './symbol-map.js';
import {
  INDEX_SCHEMA_VERSION,
  MAX_SNAPSHOT_AGE_MS,
  REVALIDATE_AFTER_MS,
  type IndexInternals,
  type Unit,
} from './types.js';

/** Index builds of one `ensure` call that run at the same time. */
const BUILD_CONCURRENCY = 3;

/** A failed build is not repeated before this much time has passed. */
export const RETRY_AFTER_MS = 60 * 1000;

/** Shortest time `ensure` waits, so that loading from memory or disk is never cut off. */
const MIN_WAIT_MS = 100;

/** Share of `memoryMaxMb` that loaded catalogue indexes may use. */
const INDEX_MEMORY_SHARE = 0.5;

const STATE_OF_ORIGIN = { fresh: 'ready', stale: 'stale', seed: 'partial' } as const;

async function runPool(tasks: Array<() => Promise<void>>, width: number): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let task = tasks[next++]; task !== undefined; task = tasks[next++]) await task();
  };
  await Promise.all(Array.from({ length: Math.min(width, tasks.length) }, worker));
}

/** Creates the index service. Holds no state outside the returned object and `ctx.cache`. */
export function createIndexService(ctx: Ctx, adapters: AdapterRegistry): IndexInternals {
  const units = new Map<string, Unit>();
  const health = createHealthTracker(ctx.clock);
  const bodies = createBodyIndex(ctx);
  const flights = singleFlight<string, IndexState>();
  const running = new Set<Promise<void>>();
  const memoryLimit = ctx.config.memoryMaxMb * 1024 * 1024 * INDEX_MEMORY_SHARE;

  const stateOf = (unit: Unit): IndexState => ({
    product: unit.product,
    source: unit.source,
    line: unit.line,
    state: STATE_OF_ORIGIN[unit.origin],
    records: unit.records.length,
    builtAt: new Date(unit.builtAt).toISOString(),
  });

  const without = (
    product: Product,
    source: SourceDef,
    line: VersionLine,
    state: 'building' | 'unavailable',
  ): IndexState => ({ product: product.id, source: source.id, line: line.id, state, records: 0 });

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
    const seeds = makeUnit(
      ctx,
      product,
      source,
      line,
      seedRecords(ctx, product, source, line),
      'seed',
      now,
      reason,
    );
    seeds.retryAt = now + retryAfterMs;
    install(seeds);
    return stateOf(seeds);
  };

  const refresh = async (
    product: Product,
    source: SourceDef,
    line: VersionLine,
  ): Promise<IndexState> => {
    const key = unitKey(product.id, source.id, line.id);
    if (!canEnumerate(adapters, source)) {
      // A read-only source has nothing to enumerate: its entry links are its whole catalogue.
      const fixed = makeUnit(
        ctx,
        product,
        source,
        line,
        seedRecords(ctx, product, source, line),
        'fresh',
        ctx.clock.now(),
      );
      install(fixed);
      return stateOf(fixed);
    }

    let previous = units.get(key);
    if (previous === undefined) {
      const snapshot = await loadSnapshot(ctx, product.id, source, line);
      if (snapshot !== undefined) {
        const current = ctx.clock.now() - snapshot.builtAt < REVALIDATE_AFTER_MS;
        previous = makeUnit(
          ctx,
          product,
          source,
          line,
          snapshot.records,
          current ? 'fresh' : 'stale',
          snapshot.builtAt,
          current ? undefined : 'the snapshot is older than a day and is being revalidated',
        );
        install(previous);
        if (current) return stateOf(previous);
      }
    }

    if (health.skip(product.id, source.id)) {
      const reason = health.get(product.id, source.id)?.lastError ?? 'the source is failing';
      return fallBack(product, source, line, previous, reason, RETRY_AFTER_MS);
    }

    const outcome = await enumerateSource(ctx, adapters, product, source, line);
    if (!outcome.ok) {
      if (outcome.disabled === true) {
        health.disabled(product.id, source.id, outcome.reason);
        return without(product, source, line, 'unavailable');
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
      health.degraded(
        product.id,
        source.id,
        `only ${records.length} records where at least ${expected} are expected`,
        records.length,
      );
    } else {
      health.ok(product.id, source.id, records.length, builtAt);
    }
    return stateOf(unit);
  };

  const ensureUnit = async (
    product: Product,
    source: SourceDef,
    line: VersionLine,
  ): Promise<IndexState> => {
    const key = unitKey(product.id, source.id, line.id);
    const { capability } = source;
    if (capability !== undefined && !ctx.policy.enabled(capability)) {
      health.disabled(product.id, source.id, `capability "${capability}" is switched off`);
      units.delete(key);
      return without(product, source, line, 'unavailable');
    }
    if (line.access === 'link-only' && (capability === 'website' || capability === 'site-index')) {
      return without(product, source, line, 'unavailable');
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
  };

  return {
    async ensure(product, sourceIds, line, call: CallOptions) {
      const sources = product.sources
        .filter(
          (source) =>
            (sourceIds === undefined || sourceIds.includes(source.id)) &&
            (source.lines === undefined || source.lines.includes(line.id)),
        )
        .sort((a, b) => (a.priority ?? 5) - (b.priority ?? 5));

      await bodies.load(product.id);
      const settled = new Map<string, IndexState>();
      const tasks = sources.map((source) => async (): Promise<void> => {
        try {
          settled.set(source.id, await ensureUnit(product, source, line));
        } catch (error) {
          ctx.logger.error('index build crashed', {
            product: product.id,
            source: source.id,
            error,
          });
          settled.set(source.id, without(product, source, line, 'unavailable'));
        }
      });
      const all = runPool(tasks, BUILD_CONCURRENCY);
      running.add(all);
      void all.finally(() => running.delete(all));

      const remaining = call.budget.deadline - ctx.clock.now();
      const wait = Math.min(
        ctx.config.limits.indexBuildDeadlineMs,
        Math.max(MIN_WAIT_MS, remaining),
      );
      try {
        await withDeadline(all, wait);
      } catch (error) {
        // The builds go on in the background; this call answers with what is loaded now.
        if (!(error instanceof DeadlineExceededError)) throw error;
      }

      return sources.map((source) => {
        const done = settled.get(source.id);
        if (done !== undefined) return done;
        const loaded = units.get(unitKey(product.id, source.id, line.id));
        return loaded === undefined
          ? without(product, source, line, 'building')
          : { ...stateOf(loaded), state: 'stale' as const };
      });
    },

    query(q) {
      const scoped = unitsInScope(units.values(), q);
      const now = ctx.clock.now();
      for (const unit of scoped) unit.lastUsed = now;
      return runCatalogQuery(scoped, q);
    },

    symbols(product, line) {
      const scoped = unitsInScope(units.values(), { products: [product], line }).sort(
        (a, b) => a.sourceRank - b.sourceRank,
      );
      return mergeSymbolMaps(scoped.map((unit) => unit.symbols));
    },

    samples: (product, line) =>
      unitsInScope(units.values(), { products: [product], line })
        .sort((a, b) => a.sourceRank - b.sourceRank)
        .flatMap((unit) => unit.records.filter((record) => record.kind === 'sample')),

    toc: (product, source, line) =>
      (units.get(unitKey(product, source, line))?.records ?? []).filter(
        (record) => record.parent === undefined,
      ),

    addBody: (page) => {
      bodies.add(page);
    },

    health: () => health.all(),

    queryBodies: (q) => bodies.query(q),

    flush: () => bodies.flush(),

    validator: (scope) =>
      shortHash(
        unitsInScope(units.values(), scope)
          .map((unit) => `${unit.key}:${unit.contentHash}`)
          .sort()
          .join('\n'),
      ),

    record(ref) {
      const page = ref.replace(/#.*$/, '');
      for (const unit of units.values()) {
        const found = unit.byRef.get(ref) ?? unit.byRef.get(page);
        if (found !== undefined) return found;
      }
      return undefined;
    },

    reason(product, source) {
      for (const unit of units.values()) {
        if (unit.product === product && unit.source === source && unit.reason !== undefined) {
          return unit.origin === 'fresh' ? undefined : unit.reason;
        }
      }
      const known = health.get(product, source);
      return known === undefined || known.state === 'ok' ? undefined : known.lastError;
    },

    async idle() {
      while (running.size > 0) await Promise.allSettled([...running]);
    },
  };
}
