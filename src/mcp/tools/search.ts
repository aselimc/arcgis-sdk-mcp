/**
 * `arcgis_docs_search` (design section 3.4): ranked hits with refs, never page bodies.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { formatCall } from '../../core/budget.js';
import { decodeCursor } from '../../core/cursor.js';
import { TOOLS } from '../../core/names.js';
import type { SearchResponse } from '../../core/ports.js';
import type { SearchHit } from '../../core/types.js';
import { compact } from '../compact.js';
import type { McpContainer } from '../container.js';
import { statusLine, structuredResult } from '../envelope.js';
import { zeroHitNext } from '../presenters/search-recovery.js';
import { cursorArg, Notes, productArg, ResultKind, SearchKind, versionArg } from '../schemas.js';
import { registerDocTool, type ToolDefinition, type ToolHandler } from '../tool.js';

const DESCRIPTION =
  'Searches ArcGIS developer documentation and returns ranked hits with title, ref (URL), product, kind, version line, location in the docs and a short excerpt. Covers guides, tutorials, API reference pages and members, REST operations, samples, release notes and product help. Scope with `product` (an id, name, or "product/section" such as "rest-api/portal"); without it the search uses the SDKs detected in the current project or picks the most likely products and says which. `kind` narrows to one content type. Matching is on titles, headings, keywords, descriptions and symbol names, plus the text of pages already read through this server; the status line says whether Esri\'s full-text site search is also in use. Returns refs for arcgis_docs_read; does not return page bodies. For an exact class, method or endpoint name, arcgis_docs_lookup_symbol is more precise.';

/** Default of `limit` in the published schema. */
const DEFAULT_LIMIT = 8;

const Input = z.object({
  query: z
    .string()
    .min(2)
    .max(300)
    .describe(
      'What to find, in plain words or API names, e.g. "cluster points with popups", "applyEdits attachments", "OAuth PKCE". No boolean operators.',
    ),
  product: productArg(
    'Product id, name, package, or "product/section". Omit to search the project\'s SDKs or the most likely products.',
  ),
  kind: SearchKind.optional().describe(
    'Restrict to one content type. "api" includes REST operations, tools and spec objects.',
  ),
  version: versionArg(
    'Version line when the product has several, e.g. "v200" for native SDK 200.x, "2.3" for Python. Default: current line.',
  ),
  limit: z.number().int().min(1).max(20).default(DEFAULT_LIMIT).describe('Number of hits.'),
  cursor: cursorArg('Opaque cursor from a previous call for the next page.'),
});

const Hit = z.object({
  rank: z.number().int(),
  title: z.string(),
  ref: z.string(),
  product: z.string(),
  source: z.string(),
  kind: ResultKind,
  version: z.string().optional(),
  breadcrumb: z.string().optional(),
  excerpt: z.string().optional(),
  symbolKind: z.string().optional(),
  match: z.enum(['symbol', 'title', 'heading', 'keyword', 'description', 'body', 'site']),
  licenseTier: z.string(),
});

const Output = z.object({
  query: z.string(),
  scope: z.object({
    products: z.array(z.string()),
    sources: z.array(z.string()).optional(),
    resolvedFrom: z.string().optional(),
    kind: z.string().optional(),
    line: z.string(),
  }),
  mode: z.enum(['local', 'local+site']),
  total: z.number().int(),
  results: z.array(Hit),
  nextCursor: z.string().optional(),
  notes: Notes,
});

type Result = z.infer<typeof Output>;
type ResultHit = z.infer<typeof Hit>;

/** Name, texts and schemas of `arcgis_docs_search`. */
export const searchTool = {
  name: TOOLS.search,
  title: 'Search ArcGIS developer documentation',
  description: DESCRIPTION,
  inputSchema: Input,
  outputSchema: Output,
} satisfies ToolDefinition<typeof Input, typeof Output>;

/** Rank of the first hit of this page: cursors of this tool carry the result offset. */
function pageOffset(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  try {
    return decodeCursor(cursor, TOOLS.search).o;
  } catch {
    // The service has already accepted the cursor; an unreadable one only costs the numbering.
    return 0;
  }
}

function resultHit(hit: SearchHit, rank: number): ResultHit {
  return compact({
    rank,
    title: hit.title,
    ref: hit.ref,
    product: hit.product,
    source: hit.source,
    kind: hit.kind,
    version: hit.version,
    breadcrumb: hit.breadcrumb,
    excerpt: hit.excerpt,
    symbolKind: hit.symbolKind,
    match: hit.match,
    licenseTier: hit.license,
  });
}

function renderHit(hit: ResultHit): string {
  const kind = hit.symbolKind === undefined ? hit.kind : `${hit.kind}, ${hit.symbolKind}`;
  const version = hit.version === undefined ? '' : ` ${hit.version}`;
  return [
    `${hit.rank}. ${hit.title} [${kind}] ${hit.product}/${hit.source}${version}`,
    `   ${hit.ref}`,
    hit.breadcrumb === undefined ? undefined : `   In: ${hit.breadcrumb}`,
    hit.excerpt === undefined ? undefined : `   ${hit.excerpt.replace(/\s+/g, ' ').trim()}`,
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n');
}

/** How a scope the caller did not name was chosen, in the words of the status line. */
const SCOPE_ORIGIN: ReadonlyMap<string, string> = new Map([
  ['workspace', 'detected in the project'],
  ['query', 'named by the query'],
  ['router', 'chosen from the query'],
]);

/**
 * The searched products and where the choice came from. A `product` argument is echoed as
 * given; otherwise the origin is spelled out, since the service's own word for it ("router",
 * "workspace") means nothing to a reader.
 */
function scopeText(scope: SearchResponse['scope'], product: string | undefined): string {
  const products = scope.products.length === 0 ? 'none' : scope.products.join(', ');
  const sources = scope.sources === undefined ? '' : ` (sources: ${scope.sources.join(', ')})`;
  const origin =
    product === undefined
      ? SCOPE_ORIGIN.get(scope.resolvedFrom ?? '')
      : `resolved from "${scope.resolvedFrom ?? product}"`;
  return `products: ${products}${sources}${origin === undefined ? '' : `, ${origin}`}`;
}

const handle: ToolHandler<typeof Input> = async (args, call, container) => {
  const { ctx, services } = container;
  const response = await services.search.search(
    compact({
      query: args.query,
      product: args.product,
      kind: args.kind,
      version: args.version,
      limit: args.limit,
      cursor: args.cursor,
    }),
    call,
  );
  const offset = pageOffset(args.cursor);
  const results = response.hits.map((hit, index) => resultHit(hit, offset + index + 1));
  const result: Result = compact({
    query: response.query,
    scope: compact({ ...response.scope }),
    mode: response.mode,
    total: response.total,
    results,
    nextCursor: response.nextCursor,
    notes: response.notes,
  });
  const top = results[0];
  // A continuation repeats the call it continues, the page size included when one was chosen.
  const repeated = compact({
    product: args.product,
    kind: args.kind,
    version: args.version,
    limit: args.limit === DEFAULT_LIMIT ? undefined : args.limit,
  });
  const nextPage =
    response.nextCursor === undefined
      ? undefined
      : formatCall(TOOLS.search, { query: args.query, ...repeated, cursor: response.nextCursor });
  const openTop = top === undefined ? undefined : formatCall(TOOLS.read, { ref: top.ref });
  // On the first page opening the best hit is the useful follow-up and further pages are a
  // remark; once an agent is paging, the next page is. No hit is not proof of absence, so
  // a wider search or the catalogue is offered instead.
  const firstPage = offset === 0;
  const next =
    (firstPage ? (openTop ?? nextPage) : (nextPage ?? openTop)) ??
    zeroHitNext({ query: args.query, ...repeated }, response.scope, container);
  const notes =
    firstPage && openTop !== undefined && nextPage !== undefined
      ? [...response.notes, `More hits: ${nextPage}`]
      : response.notes;
  return structuredResult(
    {
      status: statusLine([
        `Search "${response.query}"`,
        scopeText(response.scope, args.product),
        `line: ${response.scope.line}`,
        response.scope.kind === undefined ? undefined : `kind: ${response.scope.kind}`,
        `mode: ${response.mode === 'local' ? 'local index (site search off)' : 'local index + Esri site search'}`,
        results.length === 0
          ? '0 hits'
          : `hits ${offset + 1}-${offset + results.length} of ${response.total}`,
      ]),
      notes,
      body: results.map(renderHit).join('\n'),
      next,
      attribution: {
        kind: 'listing',
        licenses: response.hits.map((hit) => hit.license),
        retrievedOn: ctx.clock.iso(),
      },
    },
    result,
  );
};

/** Registers `arcgis_docs_search`. */
export function registerSearch(server: McpServer, container: McpContainer): void {
  registerDocTool(server, container, searchTool, handle);
}
