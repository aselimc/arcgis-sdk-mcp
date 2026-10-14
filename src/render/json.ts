/**
 * Defensive accessors for untyped JSON. Every structured renderer receives `unknown` input
 * that an upstream site can change without notice, so fields are read through these helpers
 * and a missing or mistyped field degrades to "absent" instead of throwing.
 */
import { isRecord as isJsonObject } from '../core/json.js';

/** A JSON object of unknown shape. */
export type Json = Record<string, unknown>;

/** True for a plain JSON object (not `null`, not an array). */
export const isRecord: (value: unknown) => value is Json = isJsonObject;

/** The value as an object, or an empty object when it is anything else. */
export function asRecord(value: unknown): Json {
  return isRecord(value) ? value : {};
}

/** The value when it is a non-blank string, otherwise `undefined`. */
export function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** The value when it is a finite number, otherwise `undefined`. */
export function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** The value as an array, or an empty array when it is anything else. */
export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

/** The object elements of an array value; other elements are skipped. */
export function records(value: unknown): Json[] {
  return list(value).filter(isRecord);
}

/** The string elements of an array value; other elements are skipped. */
export function strings(value: unknown): string[] {
  return list(value).filter((item): item is string => typeof item === 'string');
}

/**
 * A scalar as display text: strings as they are, numbers and booleans printed, everything
 * else as compact JSON. `undefined` for `undefined` and `null`.
 */
export function scalar(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}
