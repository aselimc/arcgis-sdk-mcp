/**
 * The error catalogue (design section 3.9). Every failure an agent can see is one of these
 * codes; `src/mcp/errors.ts` renders them as `Error [CODE]: <what>. <why>. Next: <recovery>.`
 */
import type { Capability } from './types.js';

/** Stable machine-readable error code. */
export type ErrorCode =
  | 'UNKNOWN_PRODUCT'
  | 'AMBIGUOUS_SYMBOL'
  | 'SYMBOL_NOT_FOUND'
  | 'DOC_NOT_FOUND'
  | 'SECTION_NOT_FOUND'
  | 'HOST_NOT_ALLOWED'
  | 'LINK_ONLY'
  | 'SOURCE_DISABLED'
  | 'VERSION_UNAVAILABLE'
  | 'UPSTREAM_UNAVAILABLE'
  | 'UPSTREAM_BLOCKED'
  | 'RATE_LIMITED_GITHUB'
  | 'CURSOR_EXPIRED'
  | 'OFFLINE_MISS'
  | 'INTERNAL';

/** Every {@link ErrorCode}, for tests that must cover the whole catalogue. */
export const ERROR_CODES = [
  'UNKNOWN_PRODUCT',
  'AMBIGUOUS_SYMBOL',
  'SYMBOL_NOT_FOUND',
  'DOC_NOT_FOUND',
  'SECTION_NOT_FOUND',
  'HOST_NOT_ALLOWED',
  'LINK_ONLY',
  'SOURCE_DISABLED',
  'VERSION_UNAVAILABLE',
  'UPSTREAM_UNAVAILABLE',
  'UPSTREAM_BLOCKED',
  'RATE_LIMITED_GITHUB',
  'CURSOR_EXPIRED',
  'OFFLINE_MISS',
  'INTERNAL',
] as const satisfies readonly ErrorCode[];

/** Optional context carried by a {@link McpDocError}. */
export interface ErrorDetails {
  /** One sentence explaining the cause, without a trailing period. */
  why?: string;
  /** The exact recovery: a complete tool call or setting, without the `Next:` prefix. */
  next?: string;
  /** Nearest ids, names, section ids or `{symbol, product}` pairs, most likely first. */
  candidates?: string[];
  url?: string;
  host?: string;
  capability?: Capability;
  /** True when the same call may succeed if repeated unchanged. */
  retryable?: boolean;
}

/**
 * The only error type that may cross a package boundary. `message` is the "what" sentence;
 * everything else an agent needs to recover is in `details`.
 */
export class McpDocError extends Error {
  /** Constant so that the class survives `instanceof` failures across duplicated modules. */
  override readonly name = 'McpDocError';

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: ErrorDetails,
  ) {
    super(message);
  }
}

/** Type guard that also recognises instances created by another copy of this module. */
export function isMcpDocError(e: unknown): e is McpDocError {
  if (e instanceof McpDocError) return true;
  if (!(e instanceof Error) || e.name !== 'McpDocError') return false;
  const code = (e as { code?: unknown }).code;
  return typeof code === 'string' && (ERROR_CODES as readonly string[]).includes(code);
}

/**
 * Converts anything thrown into a {@link McpDocError}. Unknown failures become `INTERNAL`
 * and keep the original as `cause`, so the stack can be logged to stderr and never shown.
 */
export function toMcpDocError(e: unknown): McpDocError {
  if (isMcpDocError(e)) return e;
  const wrapped = new McpDocError('INTERNAL', 'Internal error', {
    why: e instanceof Error ? e.message : String(e),
  });
  wrapped.cause = e;
  return wrapped;
}
