/**
 * The `docc` adapter: Swift API references published as a DocC archive. The HTML of such a
 * site is a client-rendered shell, so nothing is read from it: the catalogue comes from the
 * navigator tree (`index/index.json`) and every page from its render JSON
 * (`data/documentation/<path>.json`), which the `docc` renderer converts.
 */
import { formatCall } from '../../core/budget.js';
import { McpDocError } from '../../core/errors.js';
import { TOOLS } from '../../core/names.js';
import type { BoundSource, Ctx, ReadTarget, SourceAdapter } from '../../core/ports.js';
import type { CatalogRecord, DocKind, DocPage } from '../../core/types.js';
import {
  assertLive,
  budgetOf,
  indexRequest,
  oneLine,
  probeSource,
  recordOf,
  renderMeta,
  renderOptionsOf,
  siteIndexEnabled,
  symbolTarget,
  unusableIndex,
} from './dartdoc.js';

/** One node of the navigator tree. Group markers have no `path`. */
interface DoccNode {
  path?: unknown;
  title?: unknown;
  type?: unknown;
  children?: unknown;
}

/** Node types that own members; their names form the qualified name of what is below them. */
const OWNERS: ReadonlySet<string> = new Set([
  'class',
  'struct',
  'enum',
  'protocol',
  'extension',
  'actor',
  'union',
  'namespace',
]);

/** Node types that are prose rather than symbols. */
const PROSE: Readonly<Record<string, DocKind>> = {
  article: 'guide',
  overview: 'guide',
  learn: 'guide',
  resources: 'guide',
  section: 'tutorial',
  tutorial: 'tutorial',
  project: 'tutorial',
  sampleCode: 'sample',
};

/** Navigator abbreviations spelled out; other types are used as they are. */
const KINDS: Readonly<Record<string, string>> = {
  init: 'initializer',
  op: 'operator',
  func: 'function',
  var: 'variable',
};

/** Declaration keywords in front of a member name in a navigator title. */
const MODIFIERS =
  /^(?:(?:static|class|func|var|let|case|mutating|nonmutating|nonisolated|final|override|convenience|required|indirect|prefix|postfix|infix|typealias|associatedtype|macro)\s+)+/;

/** `func queryFeatures(using: QueryParameters) -> FeatureQueryResult` gives `queryFeatures`. */
function simpleName(title: string): string {
  const name = /^[^\s(:<]+/.exec(title.replace(MODIFIERS, ''))?.[0] ?? title;
  return name.replace(/^(init)[?!]$/, '$1');
}

interface Walk {
  /** Simple names of the enclosing types, outermost first. */
  owners: readonly string[];
  /** Titles of every ancestor that has a page, outermost first. */
  trail: readonly string[];
  /** 1 for the module, 2 for what it lists, and so on. */
  depth: number;
}

/**
 * Catalogue records of a DocC navigator tree: one per node with a path, the first occurrence
 * winning where the tree lists a page under several groups. Members are qualified with the
 * names of their enclosing types (`MapView.onSingleTapGesture`); the module is left out, as
 * it is in code. Nodes deeper than `maxDepth` are skipped, which keeps the inherited SwiftUI
 * modifiers of a toolkit view out of the catalogue.
 */
export function doccRecords(
  src: BoundSource<'docc'>,
  roots: readonly unknown[],
  maxDepth = src.source.config.maxDepth ?? Number.POSITIVE_INFINITY,
): CatalogRecord[] {
  const root = src.url();
  const records = new Map<string, CatalogRecord>();

  const visit = (nodes: unknown, at: Walk): void => {
    if (!Array.isArray(nodes) || at.depth > maxDepth) return;
    for (const node of nodes as readonly (DoccNode | null)[]) {
      const { path, title, children } = node ?? {};
      const type = typeof node?.type === 'string' ? node.type : 'symbol';
      if (typeof path !== 'string' || typeof title !== 'string' || title === '') {
        // A grouping node without a page of its own does not add a level.
        visit(children, at);
        continue;
      }
      const ref = new URL(`${path.replace(/^\/+/, '')}/`, root).href;
      const below = { trail: [...at.trail, title], depth: at.depth + 1 };
      if (records.has(ref)) {
        visit(children, { ...below, owners: at.owners });
        continue;
      }
      const prose = PROSE[type];
      if (prose !== undefined || type === 'module') {
        const extras =
          prose === undefined
            ? { symbol: title, qualified: title, symbolKind: 'module' }
            : { kind: prose };
        records.set(ref, recordOf(src, ref, title, { ...extras, breadcrumb: at.trail }));
        visit(children, { ...below, owners: prose === undefined ? [] : at.owners });
        continue;
      }
      const owner = OWNERS.has(type);
      const name = owner ? title : simpleName(title);
      const parent = at.owners.length === 0 ? undefined : at.owners.join('.');
      const qualified = parent === undefined ? name : `${parent}.${name}`;
      records.set(
        ref,
        recordOf(src, ref, qualified, {
          symbol: name,
          qualified,
          symbolKind: KINDS[type] ?? type,
          parent,
          breadcrumb: at.trail,
          description: owner ? undefined : oneLine(title),
        }),
      );
      visit(children, { ...below, owners: owner ? [...at.owners, name] : at.owners });
    }
  };

  visit(roots, { owners: [], trail: [], depth: 1 });
  return [...records.values()];
}

/** The navigator trees of an index, one list per interface language (`swift`, `occ`). */
function navigatorRoots(index: unknown): unknown[] {
  const languages = (index as { interfaceLanguages?: unknown } | null)?.interfaceLanguages;
  if (typeof languages !== 'object' || languages === null) return [];
  return Object.values(languages).flatMap((tree) => (Array.isArray(tree) ? (tree as unknown[]) : []));
}

/**
 * Where a page of the archive lives: the public URL (shown as the ref) and the render JSON
 * that is fetched. Accepts either form. Archive paths are lower-case and case-sensitive, so
 * a URL written with the symbol's own capitalisation is folded.
 *
 * @throws McpDocError `DOC_NOT_FOUND` for a URL that names no page of the archive.
 */
export function doccLocation(src: BoundSource, url: URL): { page: string; data: string } {
  const root = src.url();
  const bare = url.href.replace(/[?#].*$/, '');
  const relative = bare.startsWith(root) ? bare.slice(root.length).toLowerCase() : '';
  const path = relative
    .replace(/^data\//, '')
    .replace(/\.json$/, '')
    .replace(/\/+$/, '');
  if (!/^(?:documentation|tutorials)\/./.test(path)) {
    throw new McpDocError('DOC_NOT_FOUND', `${bare} is not a page of ${src.source.title}`, {
      why: 'Pages of this reference live under documentation/<module>/',
      next: formatCall(TOOLS.search, { query: src.source.title, product: src.product.id }),
      url: bare,
      host: url.host,
    });
  }
  return { page: `${root}${path}/`, data: `${root}data/${path}.json` };
}

async function read(ctx: Ctx, src: BoundSource, target: ReadTarget): Promise<DocPage> {
  assertLive(src, target.url.href);
  const location = doccLocation(src, target.url);
  const { data, res } = await ctx.http.getJson({
    url: location.data,
    ttl: 'page',
    ...budgetOf(src),
  });
  const prose = PROSE[String((data as { kind?: unknown } | null)?.kind)];
  const meta = renderMeta(src, target, `${location.page}${target.url.hash}`, res);
  return ctx.render.render(
    'docc',
    { json: data },
    target.record === undefined && prose !== undefined ? { ...meta, kind: prose } : meta,
    renderOptionsOf(target),
  );
}

/** Number of pages a navigator index lists; `undefined` for any other JSON. */
function countPages(text: string): number | undefined {
  try {
    const roots = navigatorRoots(JSON.parse(text));
    if (roots.length === 0) return undefined;
    let pages = 0;
    const stack = [...roots];
    for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
      const { path, children } = (node ?? {}) as DoccNode;
      if (typeof path === 'string') pages += 1;
      if (Array.isArray(children)) stack.push(...(children as unknown[]));
    }
    return pages;
  } catch {
    return undefined;
  }
}

/**
 * `docc`: one request for the navigator tree lists every symbol and article; a page is one
 * request for its render JSON. Every symbol has a page of its own, so no selector is needed.
 */
export const doccAdapter: SourceAdapter<'docc'> = {
  type: 'docc',
  maxEnumerateRequests: 1,

  async enumerate(ctx, src) {
    const url = src.url('index/index.json');
    assertLive(src, url);
    if (!siteIndexEnabled(ctx, src)) return [];
    const { data } = await ctx.http.getJson(indexRequest(src, url, 'json'));
    const roots = navigatorRoots(data);
    if (roots.length === 0) throw unusableIndex(url, 'The index has no interfaceLanguages tree');
    const records = doccRecords(src, roots);
    if (records.length === 0) throw unusableIndex(url, 'No node of the index has a path and a title');
    return records;
  },

  read,
  symbol: (ctx, src, record, detail) => read(ctx, src, symbolTarget(record, detail)),
  probe: (ctx, src) => probeSource(ctx, src, { count: countPages }),
};
