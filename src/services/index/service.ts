/**
 * The index service (design section 6.4): one catalogue index per (product, source, line),
 * built on first use within its own request budget, and queried synchronously afterwards.
 * A tool call waits for builds only up to a deadline; they finish in the background.
 * The life cycle of a single index is in `units.ts`.
 */
import { DeadlineExceededError, withDeadline } from '../../core/async.js';
import { shortHash } from '../../core/hash.js';
import type { AdapterRegistry, CallOptions, Ctx, IndexState } from '../../core/ports.js';
import { createBodyIndex } from './body-index.js';
import { createHealthTracker } from './health.js';
import { runCatalogQuery, unitsInScope } from './query.js';
import { unitKey } from './snapshot.js';
import { mergeSymbolMaps } from './symbol-map.js';
import type { IndexInternals } from './types.js';
import { createUnitManager, stateOf, stateWithout } from './units.js';

/** Index builds of one `ensure` call that run at the same time. */
const BUILD_CONCURRENCY = 3;

/** Shortest time `ensure` waits, so that loading from memory or disk is never cut off. */
const MIN_WAIT_MS = 100;

/** Runs the tasks in order, at most `width` at a time. The tasks must not reject. */
async function runPool(tasks: Array<() => Promise<void>>, width: number): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let task = tasks[next++]; task !== undefined; task = tasks[next++]) await task();
  };
  await Promise.all(Array.from({ length: Math.min(width, tasks.length) }, worker));
}

/** Creates the index service. Holds no state outside the returned object and `ctx.cache`. */
export function createIndexService(ctx: Ctx, adapters: AdapterRegistry): IndexInternals {
  const health = createHealthTracker(ctx.clock);
  const bodies = createBodyIndex(ctx);
  const manager = createUnitManager(ctx, adapters, health);
  const { units } = manager;
  const running = new Set<Promise<void>>();

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
          // Held for the call: a later product of the same call must not evict it.
          settled.set(
            source.id,
            await manager.ensureUnit(product, source, line, call.budget.deadline),
          );
        } catch (error) {
          ctx.logger.error('index build crashed', {
            product: product.id,
            source: source.id,
            error,
          });
          settled.set(source.id, stateWithout(product, source, line, 'unavailable'));
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
          ? stateWithout(product, source, line, 'building')
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
        if (unit.product === product && unit.source === source && unit.origin !== 'fresh') {
          return unit.reason;
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
