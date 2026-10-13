/**
 * Versioned pages found in a product sitemap. A product sitemap lists one release-notes page
 * per version, so both the documented version (the highest slug) and the release-notes refs
 * fall out of one request that the gateway caches for everyone.
 */
import { isMcpDocError } from '../core/errors.js';
import { DEVELOPERS_ORIGIN } from '../core/names.js';
import type { CallOptions, Ctx } from '../core/ports.js';
import { parseSitemap } from '../core/sitemap.js';
import type { Product, VersionLine } from '../core/types.js';
import { compareVersions } from '../core/version-key.js';
import { homeUrl } from './oracles/kit.js';
import { versionFromUrl, type SlugStyle } from './version-text.js';

/** The URL filter of research section 4: where release notes live across Esri's doc sites. */
export const RELEASE_NOTES_FILTER = 'release-notes|whats-new|what-s-new|changelogs';

/** Child sitemaps followed when the URL turns out to be a sitemap index. */
const MAX_CHILD_SITEMAPS = 2;

/** One page whose URL names a version. */
export interface VersionedPage {
  version: string;
  url: string;
}

/** `sitemap-0.xml` next to the product's entry page for the line. */
export function defaultSitemapUrl(product: Product, line: VersionLine | undefined): string {
  return new URL('sitemap-0.xml', homeUrl(product, line)).href;
}

/**
 * Page URLs of a sitemap. A sitemap index is followed into its first children; an upstream
 * failure rejects with the gateway's `McpDocError`.
 */
export async function readSitemapUrls(
  ctx: Ctx,
  url: string,
  call: CallOptions | undefined,
): Promise<string[]> {
  const request = (target: string) =>
    ctx.http.get({
      url: target,
      expect: 'xml',
      ...(call?.budget === undefined ? {} : { budget: call.budget }),
      ...(call?.signal === undefined ? {} : { signal: call.signal }),
    });
  const first = parseSitemap((await request(url)).text);
  if (first.kind === 'urlset') return first.entries.map((entry) => entry.loc);
  const urls: string[] = [];
  for (const child of first.entries.slice(0, MAX_CHILD_SITEMAPS)) {
    const nested = parseSitemap((await request(child.loc)).text);
    if (nested.kind === 'urlset') urls.push(...nested.entries.map((entry) => entry.loc));
  }
  return urls;
}

/**
 * Page URLs of the product's own sitemap for a line. Most products publish `sitemap-0.xml`
 * next to their entry page; a site whose entry page is a sub-directory of its host
 * (location.arcgis.com/help/) publishes it at the host root, which is tried second.
 */
export async function readProductSitemap(
  ctx: Ctx,
  product: Product,
  line: VersionLine | undefined,
  call: CallOptions | undefined,
): Promise<string[]> {
  const beside = defaultSitemapUrl(product, line);
  try {
    return await readSitemapUrls(ctx, beside, call);
  } catch (error) {
    const atRoot = new URL('/sitemap-0.xml', beside).href;
    const onDevelopers = beside.startsWith(`${DEVELOPERS_ORIGIN}/`);
    if (
      !isMcpDocError(error) ||
      error.code !== 'DOC_NOT_FOUND' ||
      onDevelopers ||
      atRoot === beside
    ) {
      throw error;
    }
    return readSitemapUrls(ctx, atRoot, call);
  }
}

/**
 * The URLs that match `filter` and name a version, newest first, one page per version (the
 * first URL in sitemap order wins, which keeps the current page ahead of a `prior-releases`
 * copy).
 */
export function versionedPages(
  urls: readonly string[],
  filter: RegExp,
  style: SlugStyle = 'auto',
): VersionedPage[] {
  const byVersion = new Map<string, string>();
  for (const url of urls) {
    if (!filter.test(url)) continue;
    const version = versionFromUrl(url, style);
    if (version !== undefined && !byVersion.has(version)) byVersion.set(version, url);
  }
  return [...byVersion]
    .map(([version, url]) => ({ version, url }))
    .sort((a, b) => compareVersions(b.version, a.version));
}

/** Compiles a registry regex; `undefined` (never a throw) when it does not compile. */
export function compilePattern(source: string, flags = 'i'): RegExp | undefined {
  try {
    return new RegExp(source, flags);
  } catch {
    return undefined;
  }
}
