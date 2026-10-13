/**
 * Enumeration of a gatsby source, down the ladder of design section 6.6:
 *
 * 1. the site's own index files, found through page-data (navigation tree, search store,
 *    pagination file, manifests), which give titles, descriptions, breadcrumbs and symbols;
 * 2. the sitemap, which gives every URL and, where rung 1 is silent, a title from the slug.
 *
 * Both are read and merged. With capability `site-index` off only the sitemap is read. The
 * call fails (typed) only when neither rung yields a single page.
 */
import { isMcpDocError, McpDocError, toMcpDocError } from '../../../core/errors.js';
import type { BoundSource, Ctx } from '../../../core/ports.js';
import { parseSitemap } from '../../../core/sitemap.js';
import type { CatalogRecord } from '../../../core/types.js';
import { absoluteUrl, continueWithout } from '../static.js';
import { buildCatalog, describedPages } from './catalog.js';
import { discoverFrom, emptyIndex, type DiscoveryWants, type SiteIndex } from './discovery.js';
import { rememberPrefix, storedPrefix } from './prefix.js';
import { GatsbySession } from './session.js';
import { ownsPage, pageKey, prefixCandidates, relativeTo, type GatsbySite } from './site.js';

/** Hard cap on the upstream requests of one enumeration (`SourceAdapter.maxEnumerateRequests`). */
export const MAX_ENUMERATE_REQUESTS = 24;

/** Sections beyond the seed page whose index is looked up, at most. */
const MAX_EXTRA_SECTIONS = 8;

/** Requests one further section may need: its page-data, a static query and a store. */
const SECTION_COST = 3;

/** A group of undescribed pages smaller than this is not worth a request. */
const MIN_SECTION_PAGES = 3;

/** The sitemap of a source: the prefix it was found under and its pages below the base. */
interface LocatedSitemap {
  prefix: string;
  pages: string[];
}

function noPages(src: BoundSource<'gatsby'>, url: string): McpDocError {
  return new McpDocError('UPSTREAM_UNAVAILABLE', `No page of ${src.source.title} could be listed`, {
    why: 'Neither the sitemap nor the index files of the site name a page under the source base',
    url,
    host: new URL(url).host,
    retryable: false,
  });
}

/**
 * Finds and reads `sitemap-0.xml`, walking up from the base to the site prefix. A missing
 * file moves on to the parent directory; any other failure stops the search, because a
 * failing host fails for every candidate.
 *
 * @returns the sitemap, or the error that explains why there is none.
 */
async function locateSitemap(
  session: GatsbySession,
  base: string,
): Promise<LocatedSitemap | McpDocError> {
  const filter = session.src.source.config;
  let failure: McpDocError | undefined;
  for (const prefix of prefixCandidates(base)) {
    const url = `${prefix}sitemap-0.xml`;
    try {
      const entries = parseSitemap((await session.xml(url)).text).entries;
      if (entries.length === 0) {
        failure ??= noPages(session.src, url);
        continue;
      }
      const site = { base, prefix };
      const pages = new Set<string>();
      for (const entry of entries) {
        let page: string;
        try {
          page = pageKey(entry.loc);
        } catch {
          continue;
        }
        if (ownsPage(site, filter, page)) pages.add(page);
      }
      return { prefix, pages: [...pages] };
    } catch (error) {
      continueWithout(session.ctx, session.src, error, `Sitemap ${url}`);
      const typed = toMcpDocError(error);
      failure ??= typed;
      if (typed.code !== 'DOC_NOT_FOUND') break;
    }
  }
  return failure ?? noPages(session.src, base);
}

/**
 * A page of the largest group of sitemap pages no index file describes yet, or `undefined`
 * when no group is worth asking about. Groups are the first path segment below the site
 * prefix, which is how these sites split into sections with their own navigation and store.
 */
function nextSection(
  site: GatsbySite,
  pages: readonly string[],
  index: SiteIndex,
  spent: Set<string>,
): { group: string; page: string } | undefined {
  const described = describedPages(site, index);
  const groups = new Map<string, string[]>();
  for (const page of pages) {
    if (described.has(page)) continue;
    const group = (relativeTo(site.prefix, page) ?? '').split('/')[0] ?? '';
    if (spent.has(group)) continue;
    const members = groups.get(group);
    if (members === undefined) groups.set(group, [page]);
    else members.push(page);
  }
  let best: { group: string; members: string[] } | undefined;
  for (const [group, members] of groups) {
    if (members.length >= MIN_SECTION_PAGES && members.length > (best?.members.length ?? 0)) {
      best = { group, members };
    }
  }
  if (best === undefined) return undefined;
  // The middle page: a section's first URL is often a landing page without navigation.
  const sorted = [...best.members].sort();
  const page = sorted[Math.floor(sorted.length / 2)];
  return page === undefined ? undefined : { group: best.group, page };
}

/** Reads the index files: from the seed page, then from one page of every undescribed section. */
async function discoverIndex(
  session: GatsbySession,
  site: GatsbySite,
  pages: readonly string[],
): Promise<SiteIndex> {
  const { config } = session.src.source;
  const index = emptyIndex();
  const wants: DiscoveryWants = {
    glossary: config.symbols === 'glossary',
    pagination: config.symbols === 'sphinx-pagination',
  };
  const seed =
    config.seedPage === undefined ? site.base : absoluteUrl(config.seedPage, session.src);
  await discoverFrom(session, site, pageKey(seed), index, wants);

  const spent = new Set<string>();
  for (let round = 0; round < MAX_EXTRA_SECTIONS; round += 1) {
    if (session.remaining() < SECTION_COST) break;
    const section = nextSection(site, pages, index, spent);
    if (section === undefined) break;
    // A section is asked once: if its page had nothing new, its other pages will not either.
    spent.add(section.group);
    await discoverFrom(session, site, section.page, index, wants);
  }
  return index;
}

/**
 * Catalogue records of one gatsby source and version line.
 *
 * @throws McpDocError when no page can be listed: the sitemap's failure when it failed,
 *   else `UPSTREAM_UNAVAILABLE` (not retryable) for a site that lists nothing under the base.
 */
export async function enumerateGatsby(
  ctx: Ctx,
  src: BoundSource<'gatsby'>,
): Promise<CatalogRecord[]> {
  // The pages of a link-only line are never fetched, and neither are its index files.
  if (src.line.access === 'link-only') return [];
  const session = new GatsbySession(ctx, src, MAX_ENUMERATE_REQUESTS);
  const base = src.url();
  const located = await locateSitemap(session, base);
  const sitemap = isMcpDocError(located) ? undefined : located;
  if (sitemap !== undefined) await rememberPrefix(ctx, base, sitemap.prefix);
  const site: GatsbySite = {
    base,
    prefix: sitemap?.prefix ?? (await storedPrefix(ctx, base)) ?? base,
  };
  const pages = sitemap?.pages ?? [];

  const index = session.indexFilesAllowed()
    ? await discoverIndex(session, site, pages)
    : emptyIndex();
  const records = buildCatalog(src, site, pages, index);
  if (records.length > 0) return records;
  throw isMcpDocError(located) ? located : noPages(src, base);
}
