/**
 * The `sitemap` adapter: the floor for products that publish nothing but a sitemap. Titles
 * come from URL slugs, pages are read as HTML. The sitemap reader is shared with the Astro
 * adapter, whose lowest rung is the same file.
 */
import { classifyUrl, humanizeSlug, matchUrlFilter } from '../../core/adapter-helpers.js';
import { McpDocError } from '../../core/errors.js';
import type { BoundSource, Ctx, SourceAdapter } from '../../core/ports.js';
import { parseSitemap } from '../../core/sitemap.js';
import { sourceBaseUrls } from '../../core/source-urls.js';
import type { CatalogRecord, DocKind, UrlFilter } from '../../core/types.js';
import {
  absoluteUrl,
  assertLive,
  budgetOf,
  continueWithout,
  probeSource,
  readHtmlPage,
  recordOf,
} from './static.js';

/** A sitemap index may fan out; this many requests are spent on one sitemap at most. */
const MAX_REQUESTS_PER_SITEMAP = 4;

function emptySitemap(url: string): McpDocError {
  return new McpDocError('UPSTREAM_UNAVAILABLE', `${url} lists no pages`, {
    why: 'The sitemap has no <loc> entries, so its format may have changed',
    url,
    host: new URL(url).host,
    retryable: false,
  });
}

async function fetchSitemap(ctx: Ctx, src: BoundSource, url: string) {
  const res = await ctx.http.get({ url, expect: 'xml', ttl: 'index', ...budgetOf(src) });
  return parseSitemap(res.text);
}

/**
 * Page URLs of a sitemap, in document order and de-duplicated. A sitemap index is followed
 * one level down, within `maxRequests` requests in total; child sitemaps beyond that are
 * skipped with a warning.
 *
 * @throws McpDocError when the file is missing or not XML (from the gateway), or lists no
 *   page at all (`UPSTREAM_UNAVAILABLE`, not retryable). A child sitemap that fails is
 *   skipped as long as another one answered.
 */
export async function readSitemap(
  ctx: Ctx,
  src: BoundSource,
  url: string,
  maxRequests = MAX_REQUESTS_PER_SITEMAP,
): Promise<string[]> {
  assertLive(src, url);
  const top = await fetchSitemap(ctx, src, url);
  if (top.kind === 'urlset') {
    if (top.entries.length === 0) throw emptySitemap(url);
    return top.entries.map((entry) => entry.loc);
  }

  const children = top.entries.map((entry) => entry.loc);
  const reachable = children.slice(0, Math.max(0, maxRequests - 1));
  if (reachable.length < children.length) {
    ctx.logger.warn('Sitemap index is larger than the request budget; reading its first files', {
      url,
      files: children.length,
      read: reachable.length,
    });
  }
  const locs = new Set<string>();
  let firstFailure: unknown;
  for (const child of reachable) {
    try {
      const nested = await fetchSitemap(ctx, src, child);
      // A second level of indexes does not occur on the documentation hosts; it is not followed.
      if (nested.kind === 'urlset') for (const entry of nested.entries) locs.add(entry.loc);
    } catch (error) {
      firstFailure ??= error;
      continueWithout(ctx, src, error, `Sitemap ${child}`);
    }
  }
  if (locs.size > 0) return [...locs];
  if (firstFailure !== undefined) throw firstFailure;
  throw emptySitemap(url);
}

/**
 * Turns sitemap URLs into catalogue records: a URL is kept when it lies under one of `bases`
 * and its path relative to that base passes `filter`; its kind is the first matching
 * `classify` rule, else `fallback`; its title is derived from the slug.
 */
export function sitemapRecords(
  src: BoundSource,
  locs: readonly string[],
  bases: readonly string[],
  filter: UrlFilter,
  fallback: DocKind,
): CatalogRecord[] {
  const records = new Map<string, CatalogRecord>();
  for (const loc of locs) {
    const ref = loc.replace(/^http:/i, 'https:');
    const base = bases.find((candidate) => ref.startsWith(candidate));
    if (base === undefined || records.has(ref)) continue;
    const path = ref.slice(base.length);
    if (!matchUrlFilter(path, filter)) continue;
    // The base page itself has an empty path; its title is the source's.
    const title = (path === '' ? '' : humanizeSlug(path)) || src.source.title;
    records.set(ref, recordOf(src, ref, classifyUrl(path, filter, fallback), title));
  }
  return [...records.values()];
}

function sitemapUrls(src: BoundSource<'sitemap'>): string[] {
  const { url, urls = [] } = src.source.config;
  return [...new Set([...(url === undefined ? [] : [url]), ...urls])].map((value) =>
    absoluteUrl(value, src),
  );
}

function fallbackKind(src: BoundSource<'sitemap'>): DocKind {
  return src.source.config.kind ?? src.source.kinds[0] ?? 'guide';
}

/**
 * `sitemap`: every page a sitemap lists under its own directory, filtered and classified by
 * the source's URL rules. One request per sitemap file.
 */
export const sitemapAdapter: SourceAdapter<'sitemap'> = {
  type: 'sitemap',
  maxEnumerateRequests: 8,

  async enumerate(ctx, src) {
    const urls = sitemapUrls(src);
    // Each sitemap gets an equal share of the budget, so a large index cannot starve the rest.
    const share = Math.max(1, Math.floor(this.maxEnumerateRequests / Math.max(1, urls.length)));
    const locs: string[] = [];
    let firstFailure: unknown;
    for (const url of urls.slice(0, this.maxEnumerateRequests)) {
      try {
        locs.push(...(await readSitemap(ctx, src, url, Math.min(share, MAX_REQUESTS_PER_SITEMAP))));
      } catch (error) {
        firstFailure ??= error;
        continueWithout(ctx, src, error, `Sitemap ${url}`);
      }
    }
    const records = sitemapRecords(
      src,
      locs,
      sourceBaseUrls(src.source, src.line),
      src.source.config,
      fallbackKind(src),
    );
    if (records.length > 0) return records;
    if (firstFailure !== undefined) throw firstFailure;
    throw new McpDocError('UPSTREAM_UNAVAILABLE', `No page of ${src.source.title} could be listed`, {
      why: 'No sitemap URL lies under the source base and passes its URL filter',
      ...(urls[0] === undefined ? {} : { url: urls[0], host: new URL(urls[0]).host }),
      retryable: false,
    });
  },

  read(ctx, src, target) {
    let kind = target.record?.kind;
    if (kind === undefined) {
      const href = target.url.href;
      const base = sourceBaseUrls(src.source, src.line).find((candidate) =>
        href.startsWith(candidate),
      );
      const path = base === undefined ? '' : href.slice(base.length).replace(/#.*$/, '');
      kind = classifyUrl(path, src.source.config, fallbackKind(src));
    }
    return readHtmlPage(ctx, src, target, kind);
  },

  probe: (ctx, src) => probeSource(ctx, src),
};
