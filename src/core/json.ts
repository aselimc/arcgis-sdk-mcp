/**
 * Narrowing of parsed JSON of unknown shape (index files, page data, API answers), shared by
 * every package that reads such data.
 */

/** A JSON object of unknown content. */
export type JsonObject = Record<string, unknown>;

/** True for a JSON object: not an array, not `null`. */
export function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
