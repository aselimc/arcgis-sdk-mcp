/**
 * Narrowing helpers for JSON this package does not control. Every index file is read as
 * `unknown` and probed field by field, so a renamed or retyped field yields "nothing found"
 * instead of an exception.
 */
import { isRecord } from '../../../core/json.js';

/** True for a plain JSON object (not `null`, not an array). */
export const isObject: (value: unknown) => value is Record<string, unknown> = isRecord;

/** The trimmed string, or `''` when the value is not a string. */
export function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
