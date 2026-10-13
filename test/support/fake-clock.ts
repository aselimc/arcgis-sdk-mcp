import type { Clock } from '../../src/core/ports.js';

/** The instant every test starts at unless it says otherwise: 2026-10-13T12:00:00Z. */
export const FAKE_NOW = Date.UTC(2026, 9, 13, 12, 0, 0);

/** A clock that only moves when the test moves it. */
export class FakeClock implements Clock {
  private current: number;

  constructor(start: number | string = FAKE_NOW) {
    this.current = typeof start === 'string' ? Date.parse(start) : start;
  }

  now(): number {
    return this.current;
  }

  iso(): string {
    return new Date(this.current).toISOString();
  }

  today(): string {
    return this.iso().slice(0, 10);
  }

  /** Moves time forward by `ms` and returns the new instant. */
  advance(ms: number): number {
    this.current += ms;
    return this.current;
  }

  /** Jumps to an absolute instant (epoch milliseconds or an ISO string). */
  set(instant: number | string): void {
    this.current = typeof instant === 'string' ? Date.parse(instant) : instant;
  }
}

/** Common durations, so tests read as `clock.advance(2 * HOUR)`. */
export const SECOND = 1000;
/** One minute in milliseconds. */
export const MINUTE = 60 * SECOND;
/** One hour in milliseconds. */
export const HOUR = 60 * MINUTE;
/** One day in milliseconds. */
export const DAY = 24 * HOUR;
