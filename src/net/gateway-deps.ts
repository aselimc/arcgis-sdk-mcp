/**
 * Dependencies of the gateway: the ones of the `CreateHttpClient` factory contract plus two
 * seams that only tests use.
 */
import type { CreateHttpClient } from '../core/factories.js';

/** What `createHttpClient` receives. */
export interface GatewayDeps extends Readonly<Parameters<CreateHttpClient>[0]> {
  /**
   * Waits `ms` milliseconds (rate-limit pacing and retry back-off). Default: a real timer.
   * Tests pass a function that advances their fake clock instead.
   */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Uniform random number in [0, 1) for retry jitter. Default `Math.random`. */
  readonly random?: () => number;
}
