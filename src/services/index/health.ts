/**
 * In-memory health of each source (design section 6.6): `ok`, `degraded` when a lower rung
 * answered, `failing` after three consecutive hard failures (skipped for fifteen minutes,
 * then probed once), `disabled` by policy. Nothing is persisted: a restart starts from `unknown`.
 */
import type { Clock } from '../../core/ports.js';
import type { SourceHealth } from '../../core/types.js';

/** Consecutive hard failures after which a source is `failing`. */
export const FAILURES_BEFORE_FAILING = 3;

/** How long a failing source is skipped before the next probe. */
export const FAILING_SKIP_MS = 15 * 60 * 1000;

/** Tracks the health of sources by `product/source`. */
export interface HealthTracker {
  /** A build succeeded on the first rung. */
  ok(product: string, source: string, records: number, builtAt: number): void;
  /** A lower rung answered (stale snapshot, rejected swap, thin index); not a hard failure. */
  degraded(product: string, source: string, reason: string, records?: number): void;
  /** A build failed outright. The third in a row marks the source `failing`. */
  failed(product: string, source: string, reason: string): void;
  /** The source cannot be used with the current policy. */
  disabled(product: string, source: string, reason: string): void;
  /** True while a failing source is inside its skip window. */
  skip(product: string, source: string): boolean;
  get(product: string, source: string): SourceHealth | undefined;
  all(): Array<{ product: string; source: string } & SourceHealth>;
}

interface Entry {
  product: string;
  source: string;
  health: SourceHealth;
  consecutiveFailures: number;
  skipUntil: number;
}

/** Creates an empty tracker. */
export function createHealthTracker(clock: Clock): HealthTracker {
  const entries = new Map<string, Entry>();

  const entry = (product: string, source: string): Entry => {
    const key = `${product}/${source}`;
    let found = entries.get(key);
    if (found === undefined) {
      found = {
        product,
        source,
        health: { state: 'unknown' },
        consecutiveFailures: 0,
        skipUntil: 0,
      };
      entries.set(key, found);
    }
    return found;
  };

  return {
    ok(product, source, records, builtAt) {
      const found = entry(product, source);
      found.consecutiveFailures = 0;
      found.skipUntil = 0;
      found.health = {
        state: 'ok',
        lastOk: clock.iso(),
        records,
        builtAt: new Date(builtAt).toISOString(),
      };
    },

    degraded(product, source, reason, records) {
      const found = entry(product, source);
      const { lastOk, builtAt } = found.health;
      found.health = {
        state: found.health.state === 'failing' ? 'failing' : 'degraded',
        lastError: reason,
        stale: true,
        ...(lastOk === undefined ? {} : { lastOk }),
        ...(builtAt === undefined ? {} : { builtAt }),
        ...(records === undefined ? {} : { records }),
      };
    },

    failed(product, source, reason) {
      const found = entry(product, source);
      found.consecutiveFailures += 1;
      const failing = found.consecutiveFailures >= FAILURES_BEFORE_FAILING;
      if (failing) found.skipUntil = clock.now() + FAILING_SKIP_MS;
      const { lastOk, builtAt, records } = found.health;
      found.health = {
        state: failing ? 'failing' : 'degraded',
        lastError: reason,
        ...(lastOk === undefined ? {} : { lastOk }),
        ...(builtAt === undefined ? {} : { builtAt }),
        ...(records === undefined ? {} : { records }),
      };
    },

    disabled(product, source, reason) {
      const found = entry(product, source);
      found.consecutiveFailures = 0;
      found.skipUntil = 0;
      found.health = { state: 'disabled', lastError: reason };
    },

    skip(product, source) {
      const found = entries.get(`${product}/${source}`);
      return found !== undefined && clock.now() < found.skipUntil;
    },

    get: (product, source) => entries.get(`${product}/${source}`)?.health,

    all: () =>
      [...entries.values()].map(({ product, source, health }) => ({ product, source, ...health })),
  };
}
