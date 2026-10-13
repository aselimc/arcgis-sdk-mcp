/**
 * Live `robots.txt` (design decision 24): read lazily, at most once per host per 24 hours,
 * and only ever able to add denials on top of the static rules compiled into the host table.
 *
 * Parsing and matching are those of the static rules (`src/policy/robots-matcher.ts`), so a
 * live file and the compiled host table are read by one RFC 9309 implementation.
 */
import { singleFlight } from '../core/async.js';
import type { Cache, Clock, Logger } from '../core/ports.js';
import {
  denyingPattern,
  parseRobotsTxt,
  robotsTarget,
  type RobotsRules,
} from '../policy/robots-matcher.js';
import { TransportError, send } from './fetch-transport.js';
import type { RateLimiter } from './rate-limiter.js';

/** What is remembered per host, in memory and in the `robots` namespace of the cache. */
export interface RobotsRecord extends RobotsRules {
  fetchedAt: number;
  /** `Clock.now()` value after which the file is read again. */
  expiresAt: number;
}

/** Outcome of requesting a host's `robots.txt`. */
export type RobotsFetch =
  /** 2xx: the body. */
  | { kind: 'rules'; text: string }
  /** 4xx: the host publishes no rules. */
  | { kind: 'none' }
  /** 5xx, redirect, network failure: nothing learned. */
  | { kind: 'unreachable' };

/** How long a successfully read file (or its absence) is trusted. */
export const ROBOTS_TTL_MS = 24 * 3_600_000;

/** How long to wait before asking again after a failed read. */
export const ROBOTS_RETRY_MS = 3_600_000;

const FETCH_TIMEOUT_MS = 10_000;
const FETCH_MAX_BYTES = 512 * 1024;

/**
 * Builds the function that requests `https://<host>/robots.txt`. The read is outside any
 * request budget (one request per host per day) and is paced on a key of its own, so that it
 * does not use up the rate slot of the page that triggered it. Redirects are not followed.
 */
export function createRobotsFetcher(deps: {
  fetchImpl: typeof fetch;
  limiter: RateLimiter;
  userAgent: string;
}): (host: string) => Promise<RobotsFetch> {
  return async (host) => {
    const release = await deps.limiter.acquire(`${host}#robots`, {
      ratePerSec: 1,
      maxConcurrent: 1,
    });
    try {
      const response = await send(deps.fetchImpl, {
        url: `https://${host}/robots.txt`,
        method: 'GET',
        headers: { accept: 'text/plain,*/*;q=0.1', 'user-agent': deps.userAgent },
        timeoutMs: FETCH_TIMEOUT_MS,
        maxBytes: FETCH_MAX_BYTES,
      });
      if (response.status >= 200 && response.status < 300) {
        return { kind: 'rules', text: response.body.toString('utf8') };
      }
      return response.status >= 400 && response.status < 500
        ? { kind: 'none' }
        : { kind: 'unreachable' };
    } catch (error) {
      if (!(error instanceof TransportError)) throw error;
      return { kind: 'unreachable' };
    } finally {
      release?.();
    }
  };
}

/** Collaborators of {@link LiveRobots}. */
export interface LiveRobotsDeps {
  cache: Cache;
  clock: Clock;
  logger: Logger;
  /** Product token of the User-Agent, matched against `User-agent` lines. */
  agentToken: string;
  /** Requests `https://<host>/robots.txt`. Must not throw. */
  fetchRobots: (host: string) => Promise<RobotsFetch>;
}

/** Per-host live robots rules with a 24-hour memory. */
export class LiveRobots {
  private readonly known = new Map<string, RobotsRecord>();
  private readonly flights = singleFlight<string, RobotsRecord>();

  constructor(private readonly deps: LiveRobotsDeps) {}

  /**
   * The live `Disallow` pattern that forbids `url` on `host`, reading the host's file first
   * when it has not been read in the last 24 hours. Never rejects: a host whose file cannot
   * be read is governed by its static rules alone until the next attempt.
   */
  async denial(host: string, url: URL): Promise<string | undefined> {
    const record = await this.rulesFor(host);
    return denyingPattern(record, robotsTarget(url));
  }

  private async rulesFor(host: string): Promise<RobotsRecord> {
    const now = this.deps.clock.now();
    const inMemory = this.known.get(host);
    if (inMemory !== undefined && now < inMemory.expiresAt) return inMemory;
    return this.flights.run(host, () => this.refresh(host, inMemory));
  }

  private async refresh(host: string, inMemory: RobotsRecord | undefined): Promise<RobotsRecord> {
    const { cache, clock, logger } = this.deps;
    const previous = inMemory ?? (await this.stored(host));
    if (previous !== undefined && clock.now() < previous.expiresAt) {
      this.known.set(host, previous);
      return previous;
    }

    const fetched = await this.deps.fetchRobots(host);
    const now = clock.now();
    let record: RobotsRecord;
    if (fetched.kind === 'unreachable') {
      // Keep whatever was known: a failed re-read must not lift a denial.
      record = {
        allow: previous?.allow ?? [],
        disallow: previous?.disallow ?? [],
        fetchedAt: previous?.fetchedAt ?? now,
        expiresAt: now + ROBOTS_RETRY_MS,
      };
      logger.debug('robots.txt unreachable; using static rules', { host });
    } else {
      const rules =
        fetched.kind === 'rules'
          ? parseRobotsTxt(fetched.text, this.deps.agentToken)
          : { allow: [], disallow: [] };
      record = { ...rules, fetchedAt: now, expiresAt: now + ROBOTS_TTL_MS };
    }
    this.known.set(host, record);
    try {
      await cache.putDerived('robots', host, record);
    } catch (error) {
      logger.warn('could not store robots rules', { host, error: String(error) });
    }
    return record;
  }

  private async stored(host: string): Promise<RobotsRecord | undefined> {
    try {
      return await this.deps.cache.getDerived<RobotsRecord>('robots', host);
    } catch {
      return undefined;
    }
  }
}
