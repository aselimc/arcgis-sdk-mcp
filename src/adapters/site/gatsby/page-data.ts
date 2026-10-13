/**
 * Gatsby `page-data.json`: the JSON twin of every page. It never holds the body of a prose
 * page, but it does hold, depending on the layout that rendered the page:
 *
 * - pointers to the site's index files (navigation tree, search store, pagination file),
 *   under keys that differ per layout (`nav`, `topics`, `topic`, `topicNavigation`,
 *   `apiRefNav`, `navigationYaml`; `search`, `searchIndex`);
 * - whole manifests (`allTypedocPage`, `allMdxPage`);
 * - the structured body of generated pages (OpenAPI operations, TypeDoc reflections, Sphinx
 *   and notebook HTML).
 *
 * Because the key names drift between sites and builds, pointers are found by shape, not by
 * name: anything with a `nav.children` array is a navigation tree, anything with a
 * `publicStoreURL` is a search block.
 */
import { McpDocError } from '../../../core/errors.js';
import type { HttpResponse } from '../../../core/ports.js';
import { hierarchyTreeOf, navTreeOf, type NavTree } from './nav.js';
import type { GatsbySession, SessionRequest } from './session.js';
import { isObject } from './shape.js';
import { pageDataUrl } from './site.js';

/** A parsed `page-data.json`. */
export interface PageData {
  /** `result.data`: the page query result. Empty for pages without a query. */
  data: Record<string, unknown>;
  /** Hashes of the static queries the page uses; their results live under `sq/d/`. */
  staticQueryHashes: string[];
  res: HttpResponse;
}

/** A `{ title, url }` pair from a manifest. */
export interface TitleUrl {
  title: string;
  url: string;
}

/** What a page-data or static-query document says about the site's index files. */
export interface IndexPointers {
  navTrees: NavTree[];
  /** REST resource hierarchies (`resourceHierarchy.childRawYaml.raw`). */
  hierarchies: NavTree[];
  /** `publicStoreURL` as published (a path including the site prefix). */
  storeUrl?: string;
  /** A store embedded in the document itself (web scene specification). */
  inlineStore?: unknown;
  /** `publicPaginationURL` of the first navigation tree that has one. */
  paginationUrl?: string;
  /** `allTypedocPage.nodes`: every page of a TypeDoc API reference. */
  typedocNodes: TitleUrl[];
  /** `allMdxPage.edges[].node`: every page of a site that lists them inline. */
  mdxPages: TitleUrl[];
  /** `glossaryData.terms`, unvalidated. */
  glossaryTerms: unknown[];
}

function titleUrls(items: unknown): TitleUrl[] {
  if (!Array.isArray(items)) return [];
  const pairs: TitleUrl[] = [];
  for (const item of items) {
    const node: unknown = isObject(item) && isObject(item.node) ? item.node : item;
    if (!isObject(node)) continue;
    if (typeof node.title === 'string' && typeof node.url === 'string' && node.title !== '') {
      pairs.push({ title: node.title, url: node.url });
    }
  }
  return pairs;
}

/** An {@link IndexPointers} with nothing in it. */
export function noPointers(): IndexPointers {
  return { navTrees: [], hierarchies: [], typedocNodes: [], mdxPages: [], glossaryTerms: [] };
}

/**
 * Collects the index pointers of a page-data `result.data` object or of a static query's
 * `data` object. Unknown keys are ignored; a value of an unexpected shape contributes nothing.
 */
export function pointersOf(data: Record<string, unknown>): IndexPointers {
  const found = noPointers();
  for (const [key, value] of Object.entries(data)) {
    if (!isObject(value)) continue;
    const tree = navTreeOf(value.nav);
    if (tree !== undefined) {
      found.navTrees.push(tree);
      const pagination = isObject(value.nav) ? value.nav.publicPaginationURL : undefined;
      if (typeof pagination === 'string' && pagination !== '') found.paginationUrl ??= pagination;
    }
    if (typeof value.publicStoreURL === 'string' && value.publicStoreURL !== '') {
      found.storeUrl ??= value.publicStoreURL;
    } else if (typeof value.store === 'string' || Array.isArray(value.store)) {
      found.inlineStore ??= value.store;
    }
    if (key === 'allTypedocPage') found.typedocNodes.push(...titleUrls(value.nodes));
    if (key === 'allMdxPage') found.mdxPages.push(...titleUrls(value.edges));
    if (key === 'glossaryData' && Array.isArray(value.terms)) {
      found.glossaryTerms.push(...(value.terms as unknown[]));
    }
    if (key === 'resourceHierarchy' && isObject(value.childRawYaml)) {
      const hierarchy = hierarchyTreeOf(value.childRawYaml.raw);
      if (hierarchy !== undefined) found.hierarchies.push(hierarchy);
    }
  }
  return found;
}

/** Adds the pointers of `more` to `into`; single-valued pointers keep their first value. */
export function mergePointers(into: IndexPointers, more: IndexPointers): void {
  const known = new Set(into.navTrees.map((tree) => tree.key));
  into.navTrees.push(...more.navTrees.filter((tree) => !known.has(tree.key)));
  if (into.hierarchies.length === 0) into.hierarchies.push(...more.hierarchies);
  if (more.storeUrl !== undefined) into.storeUrl ??= more.storeUrl;
  if (more.inlineStore !== undefined) into.inlineStore ??= more.inlineStore;
  if (more.paginationUrl !== undefined) into.paginationUrl ??= more.paginationUrl;
  if (into.typedocNodes.length === 0) into.typedocNodes.push(...more.typedocNodes);
  if (into.mdxPages.length === 0) into.mdxPages.push(...more.mdxPages);
  if (into.glossaryTerms.length === 0) into.glossaryTerms.push(...more.glossaryTerms);
}

/**
 * Validates the envelope of a `page-data.json` document.
 *
 * @throws McpDocError `UPSTREAM_UNAVAILABLE` (not retryable) when the document has no
 *   `result` object: the page exists but its JSON twin has changed shape.
 */
export function parsePageData(json: unknown, res: HttpResponse): PageData {
  if (!isObject(json) || !isObject(json.result)) {
    throw new McpDocError(
      'UPSTREAM_UNAVAILABLE',
      'The page-data document has an unexpected shape',
      {
        why: 'It has no "result" object, so the Gatsby page-data format may have changed',
        url: res.url,
        host: new URL(res.url).host,
        retryable: false,
      },
    );
  }
  const hashes = Array.isArray(json.staticQueryHashes) ? (json.staticQueryHashes as unknown[]) : [];
  return {
    data: isObject(json.result.data) ? json.result.data : {},
    staticQueryHashes: hashes.filter((hash): hash is string => typeof hash === 'string'),
    res,
  };
}

/**
 * Fetches the page-data of a page of the site with the given prefix.
 *
 * @throws McpDocError `DOC_NOT_FOUND` when the page is not below the prefix or has no
 *   page-data (the gateway reports a catch-all HTML answer the same way); otherwise as
 *   {@link parsePageData} and the gateway.
 */
export async function fetchPageData(
  session: GatsbySession,
  prefix: string,
  pageUrl: string,
  options: SessionRequest = {},
): Promise<PageData> {
  const url = pageDataUrl(prefix, pageUrl);
  if (url === undefined) {
    throw new McpDocError('DOC_NOT_FOUND', `${pageUrl} is not a page of ${prefix}`, {
      url: pageUrl,
      host: new URL(pageUrl).host,
    });
  }
  const { data, res } = await session.json(url, { ttl: 'page', ...options });
  return parsePageData(data, res);
}
