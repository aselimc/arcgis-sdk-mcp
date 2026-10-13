/**
 * Discovery of a site's index files, starting from the page-data of one page:
 *
 * ```
 * page-data.json ──► nav tree, publicStoreURL, publicPaginationURL, manifests   (inline)
 *       └─ staticQueryHashes ──► sq/d/<hash>.json ──► the same pointers          (when not inline)
 * publicStoreURL ──► static/<hash>.store.json        publicPaginationURL ──► static/<hash>.pagination.json
 * ```
 *
 * The hashed file names change with every site build while the gateway may still hold
 * yesterday's page-data. When a hashed file has gone, the pointers are read once more with
 * a revalidating request and the new name is tried once; after that the file is given up
 * for this call and enumeration continues from the navigation tree and the sitemap.
 */
import { isMcpDocError } from '../../../core/errors.js';
import { tolerate } from '../../kit/index.js';
import type { NavTree } from './nav.js';
import {
  fetchPageData,
  mergePointers,
  pointersOf,
  type IndexPointers,
  type TitleUrl,
} from './page-data.js';
import type { GatsbySession, SessionRequest } from './session.js';
import type { GatsbySite } from './site.js';
import { loadStaticQueries, type StaticQueryRole } from './static-queries.js';
import { parsePagination, parseStore, type PaginationEntry, type StoreRecord } from './store.js';

/** Everything the index files of a site said, accumulated over the pages asked. */
export interface SiteIndex {
  navTrees: NavTree[];
  hierarchies: NavTree[];
  store: StoreRecord[];
  pagination: PaginationEntry[];
  typedocNodes: TitleUrl[];
  mdxPages: TitleUrl[];
  glossaryTerms: unknown[];
  /** Hashed files already requested in this call, whatever the outcome. */
  requested: Set<string>;
}

/** Optional index files a `symbols` mode needs on top of navigation and store. */
export interface DiscoveryWants {
  glossary: boolean;
  pagination: boolean;
}

/** A {@link SiteIndex} with nothing in it. */
export function emptyIndex(): SiteIndex {
  return {
    navTrees: [],
    hierarchies: [],
    store: [],
    pagination: [],
    typedocNodes: [],
    mdxPages: [],
    glossaryTerms: [],
    requested: new Set(),
  };
}

/** Pointers of one page: its own page-data plus the static queries it needs for the rest. */
async function pagePointers(
  session: GatsbySession,
  site: GatsbySite,
  pageUrl: string,
  wantGlossary: boolean,
  options: SessionRequest,
): Promise<IndexPointers | undefined> {
  const pageData = await session.optional(`Page-data of ${pageUrl}`, async () => {
    try {
      return await fetchPageData(session, site.prefix, pageUrl, options);
    } catch (error) {
      // A page without page-data is ordinary (a site root that only redirects): the caller
      // starts from another page, so this is not worth a warning in the host's log.
      if (!isMcpDocError(error) || error.code !== 'DOC_NOT_FOUND') throw error;
      session.ctx.logger.debug(`Page-data of ${pageUrl} does not exist`, {
        product: session.src.product.id,
        source: session.src.source.id,
      });
      return undefined;
    }
  });
  if (pageData === undefined) return undefined;
  const pointers = pointersOf(pageData.data);
  const wanted: StaticQueryRole[] = [];
  if (pointers.navTrees.length === 0) wanted.push('nav');
  if (pointers.storeUrl === undefined && pointers.inlineStore === undefined) wanted.push('search');
  if (wantGlossary && pointers.glossaryTerms.length === 0) wanted.push('glossary');
  mergePointers(
    pointers,
    await loadStaticQueries(session, site.prefix, pageData.staticQueryHashes, wanted, options),
  );
  return pointers;
}

/**
 * Loads one hashed file. When it has gone (`DOC_NOT_FOUND`), `rediscover` supplies the
 * current name and that one is tried, once.
 */
async function loadHashed<V>(
  session: GatsbySession,
  site: GatsbySite,
  index: SiteIndex,
  published: string,
  parse: (raw: unknown, source: string) => V[],
  rediscover: () => Promise<string | undefined>,
): Promise<V[]> {
  const absolute = (path: string): string | undefined => {
    try {
      return new URL(path, site.prefix).href;
    } catch {
      return undefined;
    }
  };
  /** `'gone'` when the file does not exist under this name any more. */
  const attempt = async (url: string): Promise<V[] | 'gone'> => {
    index.requested.add(url);
    try {
      return parse((await session.json(url)).data, url);
    } catch (error) {
      if (isMcpDocError(error) && error.code === 'DOC_NOT_FOUND') return 'gone';
      tolerate(session.ctx, session.src, error, `Index file ${url}`);
      return [];
    }
  };

  const url = absolute(published);
  if (url === undefined || index.requested.has(url)) return [];
  const first = await attempt(url);
  if (first !== 'gone') return first;

  const rotated = await rediscover();
  const next = rotated === undefined ? undefined : absolute(rotated);
  if (next !== undefined && !index.requested.has(next)) {
    const second = await attempt(next);
    if (second !== 'gone') return second;
  }
  session.ctx.logger.warn('Hashed index file is gone and was not rediscovered', {
    product: session.src.product.id,
    source: session.src.source.id,
    url,
  });
  return [];
}

/**
 * Reads the index files reachable from one page and adds them to `index`.
 *
 * @returns `'missing'` when the page has no page-data to start from (a root that only
 *   redirects, a page that has gone), so the caller can start from another page; `'read'`
 *   otherwise, whether or not the page contributed anything new.
 * @throws McpDocError only when the call budget is spent or the failure is not upstream's
 *   (see `tolerate`); a missing or malformed file is skipped.
 */
export async function discoverFrom(
  session: GatsbySession,
  site: GatsbySite,
  pageUrl: string,
  index: SiteIndex,
  wants: DiscoveryWants,
): Promise<'missing' | 'read'> {
  const wantGlossary = wants.glossary && index.glossaryTerms.length === 0;
  const pointers = await pagePointers(session, site, pageUrl, wantGlossary, {});
  if (pointers === undefined) return 'missing';
  // One revalidating pass serves both hashed files, should both have rotated.
  let refreshed: Promise<IndexPointers | undefined> | undefined;
  const rediscover = (): Promise<IndexPointers | undefined> =>
    (refreshed ??= pagePointers(session, site, pageUrl, false, { fresh: true }));

  const known = new Set(index.navTrees.map((tree) => tree.key));
  for (const tree of pointers.navTrees) {
    if (known.has(tree.key)) continue;
    index.navTrees.push(tree);
  }
  if (index.hierarchies.length === 0) index.hierarchies.push(...pointers.hierarchies);
  if (index.glossaryTerms.length === 0) index.glossaryTerms.push(...pointers.glossaryTerms);
  for (const manifest of ['typedocNodes', 'mdxPages'] as const) {
    if (index[manifest].length > 0 || pointers[manifest].length === 0) continue;
    index[manifest].push(...pointers[manifest]);
  }

  const records: StoreRecord[] = [];
  if (pointers.storeUrl !== undefined) {
    const fromFile = await loadHashed(
      session,
      site,
      index,
      pointers.storeUrl,
      parseStore,
      async () => (await rediscover())?.storeUrl,
    );
    records.push(...fromFile);
  } else if (pointers.inlineStore !== undefined && index.store.length === 0) {
    const inline = pointers.inlineStore;
    const parsed = await session.optional(`Search store embedded in ${pageUrl}`, () =>
      Promise.resolve(parseStore(inline, pageUrl)),
    );
    records.push(...(parsed ?? []));
  }
  index.store.push(...records);

  if (wants.pagination && index.pagination.length === 0 && pointers.paginationUrl !== undefined) {
    const entries = await loadHashed(
      session,
      site,
      index,
      pointers.paginationUrl,
      parsePagination,
      async () => (await rediscover())?.paginationUrl,
    );
    index.pagination.push(...entries);
  }
  return 'read';
}
