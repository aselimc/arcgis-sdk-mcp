/**
 * Politeness limits: a token bucket and a concurrency semaphore per host, plus one global
 * semaphore (design section 6.2). Time comes from the injected clock and waiting from the
 * injected `sleep`, so the limiter is deterministic under a fake clock.
 *
 * A request passes three gates in this order: the host's concurrency slot, the host's rate
 * token (with the wait for it), and the global slot. The global slot comes last so that a
 * request which is only waiting for the token of a slow host does not keep the other hosts
 * from being read. Every wait ends at the caller's deadline or cancellation.
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
  /** The caller's cancellation signal: an aborted caller stops waiting at once. */
  signal?: AbortSignal | undefined;
}

/** Per-host and global request pacing. */
export interface RateLimiter {
  /**
   * Waits for a concurrency slot and a rate token for `key`.
   *
   * @returns the function that frees the slot, or `undefined` when the request could not
   *   start before `deadline` or the caller cancelled while waiting (nothing is held in
   *   either case).
   */
  acquire(key: string, limits: HostLimits, options?: AcquireOptions): Promise<Release | undefined>;
}

/**
 * Calls `fire` once, `ms` milliseconds from now, unless the returned function is called first.
 * The limiter uses it to stop waiting at a deadline.
 */
export type StartTimer = (ms: number, fire: () => void) => () => void;

/** The real timer. It never keeps the process alive: a waiter is not work in itself. */
const realTimer: StartTimer = (ms, fire) => {
  const timer = setTimeout(fire, ms);
  timer.unref();
  return () => {
    clearTimeout(timer);
  };
};

/** Longest delay a Node timer accepts; a longer one would fire at once. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/** A counting semaphore that serves waiters in arrival order and lets them give up. */
class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly capacity: number) {}

  /** Takes a free slot without waiting. */
  tryAcquire(): boolean {
    if (this.active >= this.capacity) return false;
    this.active += 1;
    return true;
  }

  /**
   * Queues for a slot.
   *
   * @param gaveUp settles when the waiter no longer wants the slot; it then leaves the queue,
   *   so that a slot is never handed to a caller that has gone.
   * @returns `true` holding a slot, `false` when the waiter gave up first.
   */
  wait(gaveUp: Promise<void>): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      // The slot is handed over by release(), so `active` is not touched on wake-up.
      const waiter = (): void => {
        resolve(true);
      };
      this.waiters.push(waiter);
      void gaveUp.then(() => {
        const at = this.waiters.indexOf(waiter);
        // Not queued any more: release() got there first and the slot is the waiter's.
        if (at < 0) return;
        this.waiters.splice(at, 1);
        resolve(false);
      });
    });
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
  /** Start time reserved for the most recent request, or the time it really started. */
  lastStart: number;
  slots: Semaphore;
}

/**
 * Creates the limiter. `globalConcurrent` and `startTimer` exist for tests; production uses
 * the defaults.
 */
export function createRateLimiter(deps: {
  clock: Clock;
  sleep: (ms: number) => Promise<void>;
  globalConcurrent?: number;
  startTimer?: StartTimer;
}): RateLimiter {
  const { clock, sleep } = deps;
  const startTimer = deps.startTimer ?? realTimer;
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

  /** True when the caller of `options` no longer wants to start a request. */
  function gone(options: AcquireOptions): boolean {
    if (options.signal?.aborted === true) return true;
    return options.deadline !== undefined && clock.now() >= options.deadline;
  }

  /**
   * Runs `wait` until it settles or the caller's deadline or cancellation comes first.
   *
   * @param wait receives the promise that settles when the caller has given up.
   */
  async function untilGone<V>(
    options: AcquireOptions,
    wait: (gaveUp: Promise<void>) => Promise<V>,
  ): Promise<V> {
    const { deadline, signal } = options;
    let giveUp: () => void = () => undefined;
    const gaveUp = new Promise<void>((resolve) => {
      giveUp = resolve;
    });
    let stopTimer: (() => void) | undefined;
    const watch = (until: number): void => {
      const ms = Math.min(MAX_TIMER_MS, Math.max(0, until - clock.now()));
      stopTimer = startTimer(ms, () => {
        // The timer measures real time and the deadline is on the injected clock, which
        // alone decides whether it has passed.
        if (clock.now() >= until) giveUp();
        else watch(until);
      });
    };
    if (deadline !== undefined) watch(deadline);
    signal?.addEventListener('abort', giveUp, { once: true });
    try {
      return await wait(gaveUp);
    } finally {
      stopTimer?.();
      signal?.removeEventListener('abort', giveUp);
    }
  }

  /** A slot of `semaphore`, or `false` when the caller is gone before one is free. */
  async function slot(semaphore: Semaphore, options: AcquireOptions): Promise<boolean> {
    if (gone(options)) return false;
    if (semaphore.tryAcquire()) return true;
    return untilGone(options, (gaveUp) => semaphore.wait(gaveUp));
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
      if (!(await slot(bucket.slots, options))) return undefined;

      const wait = reserve(bucket, limits, options.deadline);
      let started = wait !== undefined;
      if (wait !== undefined && wait > 0) {
        // The token is spent either way: a cancelled caller does not hand its turn back.
        await untilGone({ signal: options.signal }, (gaveUp) =>
          Promise.race([sleep(wait), gaveUp]),
        );
        started = options.signal?.aborted !== true;
      }
      started &&= await slot(global, options);
      if (!started) {
        bucket.slots.release();
        return undefined;
      }
      // The wait for the global slot may have moved the start past the reserved time; the
      // next request of this host keeps its distance from the real start.
      bucket.lastStart = Math.max(bucket.lastStart, clock.now());

      let held = true;
      return () => {
        if (!held) return;
        held = false;
        global.release();
        bucket.slots.release();
      };
    },
  };
}

/** Burst size: one second's worth of requests, and never less than one. */
function capacityOf(limits: HostLimits): number {
  return Math.max(1, Math.ceil(limits.ratePerSec));
}
