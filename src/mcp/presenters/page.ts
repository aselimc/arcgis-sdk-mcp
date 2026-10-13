/**
 * The status line and remarks of a result built from one document (`arcgis_docs_read`,
 * `arcgis_docs_lookup_symbol`): product, version, kind, cache state and degradation.
 */
import type { CacheState, DocPage } from '../../core/types.js';
import type { McpContainer } from '../container.js';
import { statusLine } from '../envelope.js';

const CACHE_TEXT: Record<CacheState, string> = {
  miss: 'fetched now',
  hit: 'cached',
  revalidated: 'cached, revalidated',
  stale: 'stale cached copy',
};

/**
 * The version to print for a page: the exact one its adapter reported, else the label the
 * version service knows for the page's line, else the line's own label when it names a
 * version (`300.x`). The label of an unversioned line (`Current`) says nothing and is left out.
 */
export async function pageVersion(
  page: DocPage,
  { ctx, services }: McpContainer,
): Promise<string | undefined> {
  if (page.version !== undefined) return page.version;
  const product = page.product === undefined ? undefined : ctx.registry.get(page.product);
  if (product === undefined) return undefined;
  const line =
    product.lines.find((candidate) => candidate.id === page.line) ??
    product.lines.find((candidate) => candidate.current);
  if (line === undefined) return undefined;
  const own = /\d/.test(line.label) ? line.label : undefined;
  try {
    return (await services.versions.label(product, line)) ?? own;
  } catch {
    // The label is decoration: a failing oracle must not fail a read that succeeded.
    return own;
  }
}

/** `Name (id)` of the page's product, or the id alone when the registry does not know it. */
export function pageProduct(page: DocPage, { ctx }: McpContainer): string | undefined {
  if (page.product === undefined) return undefined;
  const product = ctx.registry.get(page.product);
  return product === undefined ? page.product : `${product.name} (${product.id})`;
}

/**
 * The status line of a page result.
 *
 * @param lead what was resolved, shown first (the page title, or the symbol and its kind).
 */
export function pageStatus(
  lead: string,
  page: DocPage,
  product: string | undefined,
  version: string | undefined,
): string {
  return statusLine(
    [
      lead,
      product,
      version === undefined ? undefined : `version ${version}`,
      page.kind,
      CACHE_TEXT[page.cache],
    ],
    page.degraded === undefined ? undefined : `${page.degraded.level}, ${page.degraded.reason}`,
  );
}

/** Remarks of a page result: the adapter's notices and the redirect that was followed. */
export function pageNotes(page: DocPage): string[] {
  const from = page.redirectedFrom[0];
  return [
    ...page.notices,
    ...(from === undefined || from === page.url ? [] : [`Redirected from ${from}`]),
  ];
}
