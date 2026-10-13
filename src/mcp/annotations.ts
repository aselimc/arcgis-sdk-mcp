/**
 * Constants every tool and resource registration shares (design sections 3.1 and 3.8).
 */
import type { CacheHint, ToolAnnotations } from '@modelcontextprotocol/server';

/**
 * Annotations of all six tools: they only read, repeat safely, and reach outside the process
 * (Esri's documentation hosts).
 */
export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const satisfies ToolAnnotations;

/** `_meta` key by which a host raises its cap on the size of a text result. */
export const MAX_RESULT_SIZE_META_KEY = 'anthropic/maxResultSizeChars';

/** `_meta` of the two tools that return document bodies, so hosts do not truncate them. */
export const LARGE_RESULT_META = { [MAX_RESULT_SIZE_META_KEY]: 100_000 } as const;

/** Catalogue data and briefs change only with a release of this package. */
export const STATIC_RESOURCE_CACHE: CacheHint = { ttlMs: 3_600_000, cacheScope: 'public' };

/** The status resource describes this process and the user's project: never shared or reused. */
export const LIVE_RESOURCE_CACHE: CacheHint = { ttlMs: 0, cacheScope: 'private' };
