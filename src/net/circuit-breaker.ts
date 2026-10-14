/**
 * Per-host circuit breaker: five failures within a minute open a host
 * for five minutes; after that a single probe decides whether it closes again.
 */
import type { Clock } from '../core/ports.js';

/** Tunables of the breaker; the defaults are the design values. */
export interface BreakerOptions {
  /** Failures within `windowMs` that open the circuit. */
  threshold: number;
  windowMs: number;
  /** How long an open circuit rejects before allowing a probe. */
  openMs: number;
}

/** The design values. */
export const BREAKER_DEFAULTS: Readonly<BreakerOptions> = {
  threshold: 5,
  windowMs: 60_000,
  openMs: 300_000,
};

/** Breaker state as reported by `HttpClient.hostStates`. */
export type BreakerState = 'closed' | 'open' | 'half-open';

interface HostCircuit {
  /** Times of recent failures, oldest first. */
  failures: number[];
  /** `Clock.now()` value until which the circuit rejects; `undefined` while closed. */
  openUntil?: number;
  /** True while the half-open probe is in flight. */
  probing: boolean;
  lastError?: string;
}

/** The breakers of every contacted host. */
export class CircuitBreakers {
  private readonly circuits = new Map<string, HostCircuit>();
  private readonly options: BreakerOptions;

  constructor(
    private readonly clock: Clock,
    options: Partial<BreakerOptions> = {},
  ) {
    this.options = { ...BREAKER_DEFAULTS, ...options };
  }

  /**
   * Asks to send one request to `host`. `false` means the circuit is open, or half-open with
   * its probe already in flight. Every `true` must be answered with exactly one of
   * {@link success}, {@link failure} or {@link abandon}.
   */
  allow(host: string): boolean {
    const circuit = this.circuit(host);
    if (circuit.openUntil === undefined) return true;
    if (this.clock.now() < circuit.openUntil || circuit.probing) return false;
    circuit.probing = true;
    return true;
  }

  /** The host answered (any status that is not a failure, including 404). */
  success(host: string): void {
    const circuit = this.circuit(host);
    circuit.failures = [];
    circuit.probing = false;
    delete circuit.openUntil;
  }

  /** The host failed: 5xx, network error, timeout, or a 403 / 429 refusal. */
  failure(host: string, reason: string): void {
    const circuit = this.circuit(host);
    const now = this.clock.now();
    circuit.lastError = reason;
    if (circuit.probing) {
      // A failed probe re-opens the circuit for a full period.
      circuit.probing = false;
      circuit.openUntil = now + this.options.openMs;
      return;
    }
    circuit.failures = circuit.failures.filter((at) => now - at < this.options.windowMs);
    circuit.failures.push(now);
    if (circuit.failures.length >= this.options.threshold) {
      circuit.openUntil = now + this.options.openMs;
      circuit.failures = [];
    }
  }

  /** The request never produced an outcome (cancelled, or no rate slot before the deadline). */
  abandon(host: string): void {
    this.circuit(host).probing = false;
  }

  /** State of one host. An open circuit whose period has passed reads as `half-open`. */
  state(host: string): BreakerState {
    const circuit = this.circuits.get(host);
    if (circuit?.openUntil === undefined) return 'closed';
    return this.clock.now() < circuit.openUntil ? 'open' : 'half-open';
  }

  /** Every host seen so far, in first-contact order. */
  states(): Array<{ host: string; breaker: BreakerState; lastError?: string }> {
    return [...this.circuits].map(([host, circuit]) => ({
      host,
      breaker: this.state(host),
      ...(circuit.lastError === undefined ? {} : { lastError: circuit.lastError }),
    }));
  }

  private circuit(host: string): HostCircuit {
    let circuit = this.circuits.get(host);
    if (circuit === undefined) {
      circuit = { failures: [], probing: false };
      this.circuits.set(host, circuit);
    }
    return circuit;
  }
}
