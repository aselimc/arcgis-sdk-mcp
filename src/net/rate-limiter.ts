/**
 * Politeness limits: a token bucket and a concurrency semaphore per host, plus one global
 * semaphore (design section 6.2). Time comes from the injected clock and waiting from the
 * injected `sleep`, so the limiter is deterministic under a fake clock.
 */
import type { Clock } from '../core/ports.js';

/** The limits of one host, taken from its `HostPolicy`. */
export interface HostLimits {
  ratePerSec: number;
  maxConcurrent: number;
  /** Minimum time between the starts of two requests. */
  minIntervalMs?: number | undefined;
}

/** Requests in flight across all hosts. */
export const GLOBAL_CONCURRENCY = 4;

/** Returns the slot taken by {@link RateLimiter.acquire}. Safe to call more than once. */
export type Release = () => void;

/** Options of {@link RateLimiter.acquire}. */
export interface AcquireOptions {
  /** `Clock.now()` value the request must have started by. */
  deadline?: number | undefined;
}

/** Per-host and global request pacing. */
export interface RateLimiter {
  /**
   * Waits for a concurrency slot and a rate token for `key`.
   *
   * @returns the function that frees the slot, or `undefined` when the request could not
   *   start before `deadline` (nothing is held in that case).
   */
  acquire(key: string, limits: HostLimits, options?: AcquireOptions): Promise<Release | undefined>;
}

/** A counting semaphore that serves waiters in arrival order. */
class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly capacity: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.capacity) {
      this.active += 1;
      return;
    }
    // The slot is handed over by release(), so `active` is not touched on wake-up.
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  release(): void {
    const next = this.waiters.shift();
    if (next === undefined) this.active -= 1;
    else next();
  }
}

interface Bucket {
  tokens: number;
  refilledAt: number;
  /** Start time reserved for the most recent request. */
  lastStart: number;
  slots: Semaphore;
}

/** Creates the limiter. `globalConcurrent` exists for tests; production uses the default. */
export function createRateLimiter(deps: {
  clock: Clock;
  sleep: (ms: number) => Promise<void>;
  globalConcurrent?: number;
}): RateLimiter {
  const { clock, sleep } = deps;
  const global = new Semaphore(deps.globalConcurrent ?? GLOBAL_CONCURRENCY);
  const buckets = new Map<string, Bucket>();

  function bucketOf(key: string, limits: HostLimits): Bucket {
    let bucket = buckets.get(key);
    if (bucket === undefined) {
      bucket = {
        tokens: capacityOf(limits),
        refilledAt: clock.now(),
        lastStart: Number.NEGATIVE_INFINITY,
        slots: new Semaphore(Math.max(1, limits.maxConcurrent)),
      };
      buckets.set(key, bucket);
    }
    return bucket;
  }

  /**
   * Reserves the next start time in the bucket, synchronously, so that concurrent callers
   * queue up behind each other instead of all seeing the same free token.
   *
   * @returns how long to wait, or `undefined` (nothing reserved) when that passes `deadline`.
   */
  function reserve(
    bucket: Bucket,
    limits: HostLimits,
    deadline: number | undefined,
  ): number | undefined {
    const now = clock.now();
    const rate = Math.max(limits.ratePerSec, Number.EPSILON);
    const refilled = Math.min(
      capacityOf(limits),
      bucket.tokens + ((now - bucket.refilledAt) / 1000) * rate,
    );
    const afterTake = refilled - 1;
    const tokenWait = afterTake < 0 ? (-afterTake / rate) * 1000 : 0;
    const start = Math.max(now + tokenWait, bucket.lastStart + (limits.minIntervalMs ?? 0));
    if (deadline !== undefined && start >= deadline) return undefined;
    bucket.tokens = afterTake;
    bucket.refilledAt = now;
    bucket.lastStart = start;
    return Math.ceil(start - now);
  }

  return {
    async acquire(key, limits, options = {}) {
      const bucket = bucketOf(key, limits);
      await bucket.slots.acquire();
      await global.acquire();
      let held = true;
      const release: Release = () => {
        if (!held) return;
        held = false;
        global.release();
        bucket.slots.release();
      };
      const wait = reserve(bucket, limits, options.deadline);
      if (wait === undefined) {
        release();
        return undefined;
      }
      if (wait > 0) await sleep(wait);
      return release;
    },
  };
}

/** Burst size: one second's worth of requests, and never less than one. */
function capacityOf(limits: HostLimits): number {
  return Math.max(1, Math.ceil(limits.ratePerSec));
}
