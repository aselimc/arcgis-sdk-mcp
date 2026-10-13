/**
 * Narrowing helpers for JSON this package does not control. Every index file is read as
 * `unknown` and probed field by field, so a renamed or retyped field yields "nothing found"
 * instead of an exception.
 */

/** True for a plain JSON object (not `null`, not an array). */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The trimmed string, or `''` when the value is not a string. */
export function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
