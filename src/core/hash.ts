/**
 * Hashing helpers. This is the only file in `src/core` allowed to import a Node module.
 */
import { createHash } from 'node:crypto';

/** SHA-256 of a UTF-8 string as 64 lower-case hex characters. */
export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/**
 * The first 16 hex characters of {@link sha256Hex}: short enough for cache keys and cursors,
 * long enough (64 bits) that collisions are not a practical concern for this data volume.
 */
export function shortHash(s: string): string {
  return sha256Hex(s).slice(0, 16);
}
