/**
 * Renders the error catalogue as tool results:
 * `Error [CODE]: <what>. <why>. Next: <exact recovery>.` followed by the candidates, if any.
 *
 * Every code ends with a recovery. Services supply the precise one in `details.next`; when
 * they do not, the fallback here is built from the arguments of the failed call.
 */
import type { CallToolResult } from '@modelcontextprotocol/server';
import { humanizeSlug } from '../core/adapter-helpers.js';
import { formatCall } from '../core/budget.js';
import { type ErrorCode, type McpDocError, toMcpDocError } from '../core/errors.js';
import { shortHash } from '../core/hash.js';
import { BRIEF_PREFIX, ENV_PREFIX, TOOLS, type ToolName } from '../core/names.js';
import type { Clock, Logger } from '../core/ports.js';
import { productShortlist } from './shortlist.js';

/** The call that failed: the recovery is phrased in terms of it. */
export interface ErrorSite {
  tool: ToolName;
  /** Arguments as the client sent them (wire names). */
  args: Readonly<Record<string, unknown>>;
}

/** What error rendering needs from the application. */
export interface ErrorDeps {
  logger: Logger;
  clock: Clock;
  /** Where to report an internal error. */
  repoUrl: string;
}

/** How the candidates of each code are introduced, and how many are shown. */
const CANDIDATES: Partial<Record<ErrorCode, { label: string; max: number }>> = {
  UNKNOWN_PRODUCT: { label: 'Nearest product ids', max: 5 },
  AMBIGUOUS_SYMBOL: { label: 'Candidates', max: 8 },
  SYMBOL_NOT_FOUND: {
    label: 'Nearest names (not verified; this does not prove the symbol does not exist)',
    max: 5,
  },
  SECTION_NOT_FOUND: { label: 'Section ids', max: 30 },
  HOST_NOT_ALLOWED: { label: 'Documentation hosts', max: 12 },
  VERSION_UNAVAILABLE: { label: 'Available lines', max: 12 },
};
const OTHER_CANDIDATES = { label: 'See also', max: 5 };

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/** One sentence: trimmed, with exactly one closing period. */
function sentence(value: string): string {
  return `${value.trim().replace(/[.\s]+$/, '')}.`;
}

/** Search words derived from the slug of a URL or brief ref, for "page not found". */
function slugQuery(ref: string | undefined): string | undefined {
  if (ref === undefined) return undefined;
  const path = ref.toLowerCase().startsWith(BRIEF_PREFIX)
    ? ref.slice(BRIEF_PREFIX.length)
    : ref.replace(/^[a-z]+:\/\/[^/]*/i, '');
  const last = path
    .replace(/[?#].*$/, '')
    .split('/')
    .filter((segment) => segment.length > 0 && !/^(latest|index\.html?)$/i.test(segment))
    .at(-1);
  if (last === undefined) return undefined;
  const words = humanizeSlug(last).trim();
  return words.length > 0 ? words : undefined;
}

/** Shortest `query` that `arcgis_docs_search` accepts. */
const MIN_QUERY_CHARS = 2;

/**
 * A search for `query`. A recovery has to be a call that can be made: text the search tool
 * would reject (nothing, or one character such as the symbol `x`) is replaced by a
 * placeholder the agent fills in.
 */
function searchFor(query: string | undefined, extra: Record<string, unknown> = {}): string {
  const usable = query !== undefined && query.trim().length >= MIN_QUERY_CHARS;
  return formatCall(TOOLS.search, {
    query: usable ? query.trim() : 'what you are looking for',
    ...extra,
  });
}

/** The recovery used when the thrower did not supply one. */
function fallbackNext(error: McpDocError, site: ErrorSite, ref: string, deps: ErrorDeps): string {
  const { args } = site;
  const details = error.details ?? {};
  const product = text(args.product);
  const url = details.url ?? text(args.ref);
  switch (error.code) {
    case 'UNKNOWN_PRODUCT':
      return product === undefined ? formatCall(TOOLS.listProducts, {}) : productShortlist(product);
    case 'AMBIGUOUS_SYMBOL':
      return 'Repeat the lookup with one of the candidates below';
    case 'SYMBOL_NOT_FOUND':
      return searchFor(text(args.symbol), { ...(product ? { product } : {}), kind: 'api' });
    case 'DOC_NOT_FOUND':
      return searchFor(slugQuery(url) ?? text(args.query));
    case 'SECTION_NOT_FOUND':
      return formatCall(TOOLS.read, { ref: text(args.ref) ?? url ?? '<ref>', view: 'outline' });
    case 'HOST_NOT_ALLOWED':
      return `Pass a URL on an Esri documentation host, or find one with ${searchFor(slugQuery(url))}`;
    case 'LINK_ONLY':
      return `This content is linked, not fetched${url ? `: open ${url} yourself` : ''}; for the current documentation call ${formatCall(TOOLS.listProducts, product ? { product } : {})}`;
    case 'SOURCE_DISABLED':
      return details.capability === undefined
        ? `Enable the source in ${ENV_PREFIX}SOURCES and restart the server`
        : `Set ${ENV_PREFIX}SOURCES=+${details.capability} and restart the server`;
    case 'VERSION_UNAVAILABLE':
      return formatCall(TOOLS.getVersions, product ? { product } : {});
    case 'UPSTREAM_UNAVAILABLE':
      return `${details.host ?? 'The host'} is temporarily unavailable; retry the same call once`;
    case 'UPSTREAM_BLOCKED':
      return `Do not retry${url ? `; open ${url} directly` : '; the host refused the request'}`;
    case 'RATE_LIMITED_GITHUB':
      return 'Set GITHUB_TOKEN to raise the GitHub quota, or retry after the quota resets';
    case 'CURSOR_EXPIRED': {
      const { cursor: _cursor, ...restart } = args;
      return formatCall(site.tool, restart);
    }
    case 'OFFLINE_MISS':
      return `Unset ${ENV_PREFIX}OFFLINE and restart the server to allow network access`;
    case 'INTERNAL':
      return `Retry once; if it fails again, report ref ${ref} at ${deps.repoUrl}/issues`;
  }
}

function candidateLines(error: McpDocError): string[] {
  const all = error.details?.candidates ?? [];
  if (all.length === 0) return [];
  const { label, max } = CANDIDATES[error.code] ?? OTHER_CANDIDATES;
  const shown = all.slice(0, max);
  if (error.code === 'AMBIGUOUS_SYMBOL') {
    // Each candidate is the JSON text of a { symbol, product } pair: show it as a whole call.
    return [`${label}:`, ...shown.map((pair) => `- ${TOOLS.lookupSymbol}(${pair})`)];
  }
  return [`${label}: ${shown.join(', ')}`];
}

/**
 * The text of an error result.
 *
 * @param ref correlation id printed for `INTERNAL`, which is also in the stderr log entry.
 */
export function errorText(
  error: McpDocError,
  site: ErrorSite,
  deps: ErrorDeps,
  ref: string,
): string {
  const internal = error.code === 'INTERNAL';
  // An internal failure's message can hold paths or upstream text: it goes to stderr only.
  const what = internal ? `Internal error (ref ${ref})` : error.message;
  const why = internal ? undefined : error.details?.why;
  const next = error.details?.next ?? fallbackNext(error, site, ref, deps);
  const first = [
    `Error [${error.code}]: ${sentence(what)}`,
    ...(why === undefined || why.trim().length === 0 ? [] : [sentence(why)]),
    `Next: ${sentence(next)}`,
  ].join(' ');
  return [first, ...candidateLines(error)].join('\n');
}

/**
 * Converts anything a handler threw into an `isError` tool result. Never throws and never
 * exposes a stack trace: the stack of an internal error is logged (stderr) under the same
 * ref the agent is shown.
 */
export function renderError(thrown: unknown, site: ErrorSite, deps: ErrorDeps): CallToolResult {
  const error = toMcpDocError(thrown);
  const ref = shortHash(`${deps.clock.now()}:${site.tool}:${error.details?.why ?? ''}`);
  if (error.code === 'INTERNAL') {
    const cause = error.cause instanceof Error ? error.cause : error;
    deps.logger.error('internal error in tool call', {
      ref,
      tool: site.tool,
      message: cause.message,
      stack: cause.stack,
    });
  } else {
    deps.logger.debug('tool call failed', { tool: site.tool, code: error.code });
  }
  return {
    content: [{ type: 'text', text: errorText(error, site, deps, ref) }],
    isError: true,
  };
}
