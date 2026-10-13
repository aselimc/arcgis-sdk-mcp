/**
 * `symbols: 'rest-operations'`: REST reference sites title an operation page with its path,
 * optionally followed by a label and the resource it belongs to:
 *
 * ```
 * /applyEdits: Apply Edits (Feature Service)
 * /findAddressCandidates
 * ```
 *
 * Every page titled that way becomes an `operation` symbol named after the last path segment.
 */
import type { SymbolEntry, SymbolInput } from './symbols.js';

/** `/<path>` with an optional `: label`; the path may hold `{parameters}`. */
const OPERATION_TITLE = /^\/([A-Za-z0-9_{}<>.\-/]*[A-Za-z0-9_}>])(?::\s*(.+))?$/;

/** A trailing `(Resource Name)` in the label. */
const RESOURCE = /\(([^()]+)\)\s*$/;

/** `Feature Service` to `FeatureService`: a resource name usable inside a qualified name. */
function resourceName(label: string | undefined): string | undefined {
  const resource = RESOURCE.exec(label ?? '')?.[1];
  const name = resource
    ?.replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '');
  return name === undefined || name === '' ? undefined : name;
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
  const resource = resourceName(match[2]);
  if (resource !== undefined) return { symbol, qualified: `${resource}.${symbol}` };
  return segments.length > 1 ? { symbol, qualified: segments.join('.') } : { symbol };
}

/** Operation symbols of a REST reference site. */
export function restSymbols(input: SymbolInput): SymbolEntry[] {
  const entries: SymbolEntry[] = [];
  for (const page of input.pages) {
    const operation = parseOperationTitle(page.title);
    if (operation !== undefined) {
      entries.push({ url: page.url, symbolKind: 'operation', ...operation });
    }
  }
  return entries;
}
