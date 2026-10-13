/**
 * `symbols: 'rest-operations'`: REST reference sites name an operation page in one of two ways.
 *
 * Some title it with its path, optionally followed by a label and the resource it belongs to
 * (the portal and routing references):
 *
 * ```
 * /applyEdits: Apply Edits (Feature Service)
 * /findAddressCandidates
 * ```
 *
 * The others (the services directory and the administration references) title it with the
 * label alone and place it in a resource hierarchy:
 *
 * ```
 * Apply Edits (Feature Service/Layer)        Catalog > Feature Service > Layer
 * Unregister - Machine                       Site > Machines > Machine
 * ```
 *
 * For those the operation name is the label in camelCase, which is how these APIs spell
 * their URL segments (`applyEdits`, `queryRelatedRecords`). It is a derived name: the page
 * itself states the real URL, and a lookup that misses falls back to the nearest names.
 */
import type { PageRow, SymbolEntry, SymbolInput } from './symbols.js';

/** `/<path>` with an optional `: label`; the path may hold `{parameters}`. */
const OPERATION_TITLE = /^\/([A-Za-z0-9_{}<>.\-/]*[A-Za-z0-9_}>])(?::\s*(.+))?$/;

/** A trailing `(Resource Name)` in the label. */
const RESOURCE = /\(([^()]+)\)\s*$/;

/** A label that can be a name: a few plain words. */
const LABEL_WORDS = /^[A-Za-z][A-Za-z0-9]*(?: [A-Za-z0-9]+){0,5}$/;

/** `<Name> object`: a JSON data type of the API. */
const OBJECT_TITLE = /^([A-Z][A-Za-z0-9]+) object$/;

/** `Feature Service` to `FeatureService`: a resource name usable inside a qualified name. */
function compactName(text: string | undefined): string | undefined {
  const name = text
    ?.replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '');
  return name === undefined || name === '' ? undefined : name;
}

/** `Apply Edits` to `applyEdits`; a single word (`CreateWatersheds`, `Query`) keeps its humps. */
function camelName(label: string): string {
  const words = label.split(' ');
  const [first = '', ...rest] = words;
  if (rest.length === 0) {
    // One capitalised word is a verb (`Query`); one with inner capitals is already a name.
    return /[a-z][A-Z]/.test(first) ? first : first.charAt(0).toLowerCase() + first.slice(1);
  }
  const lead = /^[A-Z0-9]+$/.test(first)
    ? first.toLowerCase()
    : first.charAt(0).toLowerCase() + first.slice(1);
  return lead + rest.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('');
}

/**
 * The operation a page title names, or `undefined` when the title is not an operation.
 * Path parameters are not names: `/items/{itemId}/update` is `update`.
 */
export function parseOperationTitle(
  title: string,
): { symbol: string; qualified?: string } | undefined {
  const match = OPERATION_TITLE.exec(title.trim());
  if (match?.[1] === undefined) return undefined;
  const segments = match[1]
    .split('/')
    .filter((segment) => segment !== '' && !/^[{<].*[}>]$/.test(segment));
  const symbol = segments.at(-1);
  if (symbol === undefined) return undefined;
  const resource = compactName(RESOURCE.exec(match[2] ?? '')?.[1]);
  if (resource !== undefined) return { symbol, qualified: `${resource}.${symbol}` };
  return segments.length > 1 ? { symbol, qualified: segments.join('.') } : { symbol };
}

/**
 * The name a labelled page of a resource hierarchy stands for, or `undefined` when its
 * title is prose. The resource is the trailing `(Resource)`, else the part after ` - `,
 * else the innermost breadcrumb level.
 */
export function parseLabelTitle(
  title: string,
  crumbs: readonly string[],
): { symbol: string; qualified?: string } | undefined {
  const trimmed = title.trim();
  const parenthetical = RESOURCE.exec(trimmed)?.[1];
  const bare = parenthetical === undefined ? trimmed : trimmed.replace(RESOURCE, '').trim();
  const [label = '', ...after] = bare.split(' - ');
  if (!LABEL_WORDS.test(label.trim())) return undefined;
  const symbol = camelName(label.trim());
  const resource = compactName(parenthetical ?? (after.join(' ') || crumbs.at(-1)));
  return resource === undefined ? { symbol } : { symbol, qualified: `${resource}.${symbol}` };
}

function entryOf(page: PageRow, parents: ReadonlySet<string>): SymbolEntry | undefined {
  const operation = parseOperationTitle(page.title);
  if (operation !== undefined) return { url: page.url, symbolKind: 'operation', ...operation };
  const object = OBJECT_TITLE.exec(page.title.trim())?.[1];
  if (object !== undefined) return { url: page.url, symbolKind: 'type', symbol: object };
  // Only pages inside a hierarchy are resources and operations; the rest is guide prose.
  if (page.crumbs.length === 0) return undefined;
  const labelled = parseLabelTitle(page.title, page.crumbs);
  if (labelled === undefined) return undefined;
  const label = page.title.replace(RESOURCE, '').trim();
  return {
    url: page.url,
    symbolKind: parents.has(label) ? 'resource' : 'operation',
    ...labelled,
  };
}

/** Operation, resource and data-type symbols of a REST reference site. */
export function restSymbols(input: SymbolInput): SymbolEntry[] {
  // A title that other pages have as their innermost breadcrumb level is a resource.
  const parents = new Set<string>();
  for (const page of input.pages) {
    const parent = page.crumbs.at(-1);
    if (parent !== undefined) parents.add(parent);
  }
  const entries: SymbolEntry[] = [];
  for (const page of input.pages) {
    const entry = entryOf(page, parents);
    if (entry !== undefined) entries.push(entry);
  }
  return entries;
}
