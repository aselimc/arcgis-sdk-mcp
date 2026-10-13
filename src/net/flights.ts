/**
 * Single-flight for gateway requests: concurrent identical requests share one fetch. The
 * fetch runs on the budget and cancellation signal of the caller that started it, so its
 * failure can be that caller's alone, and the callers that joined must not inherit it.
 */
import { singleFlight } from '../core/async.js';
import { declinedBy } from './errors.js';

/**
 * Flights of other callers that one caller joins before their failure is passed on. A bound
 * for the pathological case; in practice the second round is the caller's own flight.
 */
const MAX_JOINED_FLIGHTS = 3;

/** The flights in the air, by cache key. */
export class Flights<V> {
  private readonly inFlight = singleFlight<string, V>();

  /**
   * Runs `load` unless a flight with this key is in the air, in which case its outcome is
   * shared, with one exception: when a joined flight ends because the gateway gave up on
   * behalf of the caller that started it (budget, pacing, cancellation; `declined` in
   * `errors.ts`) and this caller is `stillAsking`, the request is made again, this time on
   * this caller's own budget and signal unless yet another caller got there first.
   *
   * @param stillAsking false once this caller's own budget is spent or its signal aborted.
   */
  async run(key: string, load: () => Promise<V>, stillAsking: () => boolean): Promise<V> {
    for (let joined = 0; ; joined += 1) {
      const flight = { own: false };
      try {
        return await this.inFlight.run(key, () => {
          flight.own = true;
          return load();
        });
      } catch (error) {
        const foreign = !flight.own && declinedBy(error) !== undefined;
        if (!foreign || joined >= MAX_JOINED_FLIGHTS || !stillAsking()) throw error;
      }
    }
  }
}
