/**
 * Stateless pagination cursors (design decision 28): base64url JSON, validated on decode.
 * The server keeps nothing between calls; a cursor that no longer matches the call or the
 * data it was issued for is rejected with `CURSOR_EXPIRED`.
 */
import * as z from 'zod/v4';
import { McpDocError } from './errors.js';

/** Contents of a cursor. */
export interface CursorData {
  /** Format version. */
  v: 1;
  /** Tool the cursor belongs to. */
  t: string;
  /** Hash of the arguments that define the result set (`shortHash`). */
  k: string;
  /** Validator of the underlying data: an ETag, index fingerprint or content hash. */
  e: string;
  /** Offset to continue from: a result index, or a character offset for `fitSections`. */
  o: number;
}

const CursorSchema = z.strictObject({
  v: z.literal(1),
  t: z.string().min(1).max(64),
  k: z.string().max(128),
  e: z.string().max(256),
  o: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

function expired(why: string): McpDocError {
  return new McpDocError('CURSOR_EXPIRED', 'The cursor is no longer valid', {
    why,
    next: 'Repeat the call without the cursor argument to restart from the beginning',
  });
}

/** Serialises a cursor to an opaque URL-safe string. */
export function encodeCursor(c: CursorData): string {
  return Buffer.from(JSON.stringify({ v: c.v, t: c.t, k: c.k, e: c.e, o: c.o }), 'utf8').toString(
    'base64url',
  );
}

/**
 * Decodes and validates a cursor.
 *
 * @param tool the tool handling the call; a cursor issued by another tool is rejected.
 * @param expect when given, the cursor's key hash `k` and validator `e` must equal these:
 *   pass the values computed for the current call so that a cursor from different arguments,
 *   or from data that has since changed, cannot be continued.
 * @throws McpDocError `CURSOR_EXPIRED` when the string is malformed, fails the schema,
 *   belongs to another tool, or does not match `expect`.
 */
export function decodeCursor(
  s: string,
  tool: string,
  expect?: { k?: string; e?: string },
): CursorData {
  // Buffer's decoder skips invalid characters silently, so reject them up front.
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw expired('The cursor is malformed');
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
  } catch {
    throw expired('The cursor is malformed');
  }
  const parsed = CursorSchema.safeParse(raw);
  if (!parsed.success) throw expired('The cursor is malformed');
  const cursor = parsed.data;
  if (cursor.t !== tool) throw expired(`The cursor was issued by ${cursor.t}, not ${tool}`);
  if (expect?.k !== undefined && cursor.k !== expect.k) {
    throw expired('The cursor belongs to a call with different arguments');
  }
  if (expect?.e !== undefined && cursor.e !== expect.e) {
    throw expired('The underlying content changed since the cursor was issued');
  }
  return cursor;
}
