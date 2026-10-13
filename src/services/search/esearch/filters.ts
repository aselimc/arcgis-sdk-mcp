/**
 * Filters of the site-search request (`requiredfields`, `partialfields`), as a small typed
 * tree with one serialiser. The grammar and every rule below come from live tests recorded in
 * `gap-esearchapi-contract-and-coverage.md` section 2.2:
 *
 * ```
 * filter := term ( ("." | "|") term )*      "." = AND, "|" = OR, "|" binds tighter
 * term   := key ":" value | "(" filter ")"
 * ```
 *
 * The backend answers a malformed filter with HTTP 200 and **unfiltered** results, so a
 * filter that cannot be proven well-formed is never sent: {@link serializeFilter} throws
 * {@link FilterError} and the provider skips the request.
 */

/** `key:value`. */
export interface FilterTerm {
  kind: 'term';
  key: string;
  value: string;
}

/** A filter expression. */
export type FilterNode =
  FilterTerm | { kind: 'and'; nodes: FilterNode[] } | { kind: 'or'; nodes: FilterNode[] };

/** Which request parameter a filter is for; the two accept different shapes. */
export type FilterParam = 'requiredfields' | 'partialfields';

/** Raised instead of producing a filter the backend would misread. */
export class FilterError extends Error {
  override readonly name = 'FilterError';
}

/**
 * Meta-field keys that exist on the indexed documents. Top-level document fields
 * (`language`) and keys containing a colon (`article:published_time`) cannot be addressed
 * and silently match nothing, so anything else is refused.
 */
export const FILTER_KEYS = [
  'product',
  'version',
  'content_type',
  'search-collection',
  'searchCollection',
  'search-category',
  'sub_category',
  'content-language',
  'Content-Language',
  'site-id',
  'Content-Location',
  'generator',
  'published_at',
  'article-type',
] as const;

const KNOWN_KEYS: ReadonlySet<string> = new Set(FILTER_KEYS);

/** Key of the URL-prefix filter, a phrase match that only `partialfields` supports. */
const URL_KEY = 'Content-Location';

/** `key:value` shorthand. */
export function term(key: string, value: string): FilterTerm {
  return { kind: 'term', key, value };
}

/** All of `nodes`. */
export function and(...nodes: FilterNode[]): FilterNode {
  return { kind: 'and', nodes };
}

/** Any of `nodes`. */
export function or(...nodes: FilterNode[]): FilterNode {
  return { kind: 'or', nodes };
}

function serializeTerm(node: FilterTerm, param: FilterParam): string {
  if (!KNOWN_KEYS.has(node.key)) {
    throw new FilterError(`"${node.key}" is not a filterable meta field`);
  }
  const { value } = node;
  if (value.trim() === '' || value !== value.trim()) {
    throw new FilterError(`The value of ${node.key} is empty or padded with spaces`);
  }
  // The structural characters of the grammar, a percent sign (only %2E is decoded, so any
  // other escape would be matched literally) and a leading minus (there is no negation).
  if (/[|():%]|\p{Cc}/u.test(value) || value.startsWith('-')) {
    throw new FilterError(`The value of ${node.key} contains a character the grammar reserves`);
  }
  if (node.key === URL_KEY) {
    if (param !== 'partialfields') {
      throw new FilterError('A URL prefix is a phrase match and belongs in partialfields');
    }
    // The host is one token of the phrase: without it the prefix matches nothing.
    if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/|$)/.test(value)) {
      throw new FilterError('A URL prefix starts with the host name and has no scheme');
    }
  }
  // A raw dot would be read as AND.
  return `${node.key}:${value.replaceAll('.', '%2E')}`;
}

function serializeNode(
  node: FilterNode,
  param: FilterParam,
  parent: 'and' | 'or' | undefined,
): string {
  if (node.kind === 'term') return serializeTerm(node, param);
  const [only] = node.nodes;
  if (only === undefined) throw new FilterError(`An ${node.kind} group needs a member`);
  if (node.nodes.length === 1) return serializeNode(only, param, parent);
  if (node.kind === 'and' && parent === 'or' && param === 'partialfields') {
    // Verified live: AND groups inside OR match nothing in partialfields.
    throw new FilterError('partialfields cannot hold AND groups inside OR');
  }
  const joined = node.nodes
    .map((child) => serializeNode(child, param, node.kind))
    .join(node.kind === 'and' ? '.' : '|');
  return parent === undefined ? joined : `(${joined})`;
}

const TERM_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*:[^|().:]+$/;

/** Parses `filter` by the grammar; returns the index after it, or -1. */
function parseFilter(text: string, from: number): number {
  let index = from;
  for (;;) {
    if (text[index] === '(') {
      const close = parseFilter(text, index + 1);
      if (close === -1 || text[close] !== ')') return -1;
      index = close + 1;
    } else {
      const end = text.slice(index).search(/[|().]/);
      const stop = end === -1 ? text.length : index + end;
      if (!TERM_PATTERN.test(text.slice(index, stop))) return -1;
      index = stop;
    }
    if (text[index] !== '.' && text[index] !== '|') return index;
    index += 1;
  }
}

/**
 * True when `text` is a well-formed filter string: balanced parentheses, every term a
 * `key:value` with no raw dot, no negation and no empty member. The last check before a
 * filter leaves the process, independent of how the string was produced.
 */
export function isValidFilterString(text: string): boolean {
  return text !== '' && parseFilter(text, 0) === text.length;
}

/**
 * Serialises a filter for one request parameter.
 *
 * @throws FilterError for an unknown key, a value with reserved characters, a URL prefix
 *   outside `partialfields` or without its host, an empty group, or AND inside OR in
 *   `partialfields`.
 */
export function serializeFilter(node: FilterNode, param: FilterParam): string {
  const text = serializeNode(node, param, undefined);
  if (!isValidFilterString(text)) throw new FilterError(`Refusing malformed filter "${text}"`);
  return text;
}
