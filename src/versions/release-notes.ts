/**
 * Release-notes locator (research section 4 and 8.3). `arcgis_docs_get_versions` returns
 * refs, never release-note text: the agent opens the ref with `arcgis_docs_read`.
 *
 * `Product.releaseNotes` gives up to three ways to find a page:
 * - `current`: the page (or meta-refresh stub) of the current release;
 * - `sitemapFilter`: a URL regex over the product sitemap, which lists one page per version;
 * - `pattern`, in one of two forms. A regular expression whose first capture group is the
 *   version slug of a per-version page (`/release-notes-for-(\d+-\d+)/$`) names the pages
 *   among the sitemap URLs. A URL template with `{version}` (also `{dashed}`, `{compact}`,
 *   `{major}`, `{minor}`, `{patch}` and the line variables) builds the page of a version
 *   without any request.
 */
import { isMcpDocError } from '../core/errors.js';
import type { CallOptions, Ctx, VersionReport } from '../core/ports.js';
import type { Product, VersionLine } from '../core/types.js';
import { compareVersions, parseVersion } from '../core/version-key.js';
import { lineUrl, resolveUrl } from './oracles/kit.js';
import {
  RELEASE_NOTES_FILTER,
  compilePattern,
  readProductSitemap,
  versionedPages,
  type VersionedPage,
} from './sitemap-versions.js';
import { compareAtSharedPrecision, normalizeVersion, versionFromSlugText } from './version-text.js';

/** One release-notes ref, as in `VersionReport`. */
export type ReleaseNotesRef = VersionReport['products'][number]['releaseNotes'][number];

/** Refs returned for one product: the requested and current versions plus the newest others. */
const MAX_REFS = 6;

/** Label of the current page when no oracle could name the version. */
export const CURRENT_LABEL = 'current';

const TEMPLATE_PLACEHOLDER = /\{(?:version|dashed|compact|major|minor|patch)\}/;

/** True when a `releaseNotes.pattern` is a URL template rather than a regular expression. */
export function isTemplatePattern(pattern: string): boolean {
  return TEMPLATE_PLACEHOLDER.test(pattern);
}

/** Fills the version placeholders of a template `releaseNotes.pattern`. */
export function expandReleaseNotesPattern(
  pattern: string,
  version: string,
  line: VersionLine | undefined,
): string {
  const numbers = parseVersion(normalizeVersion(version));
  const values: Record<string, string> = {
    version,
    dashed: numbers.join('-'),
    compact: numbers.join(''),
    major: String(numbers[0] ?? 0),
    minor: String(numbers[1] ?? 0),
    patch: String(numbers[2] ?? 0),
  };
  const filled = pattern.replace(
    /\{([A-Za-z]+)\}/g,
    (whole, name: string) => values[name] ?? whole,
  );
  return resolveUrl(filled, line);
}

/**
 * Pages whose URL matches a regex `pattern`, newest first. The version slug is the first
 * capture group that took part in the match. A pattern with several groups lists its URL
 * shapes in order of preference: when two URLs name one version, the one matched by the
 * earlier group is kept (a real page ahead of the redirect stub that points to it), and
 * among URLs of the same group the first in sitemap order.
 */
export function pagesByPattern(urls: readonly string[], pattern: RegExp): VersionedPage[] {
  const byVersion = new Map<string, { url: string; group: number }>();
  for (const url of urls) {
    const match = pattern.exec(url);
    const group = match?.findIndex((part, index) => index > 0 && part !== undefined) ?? -1;
    const slug = group > 0 ? match?.[group] : undefined;
    if (slug === undefined) continue;
    const version = versionFromSlugText(slug);
    const known = byVersion.get(version);
    if (known === undefined || group < known.group) byVersion.set(version, { url, group });
  }
  return [...byVersion]
    .map(([version, { url }]) => ({ version, url }))
    .sort((a, b) => compareVersions(b.version, a.version));
}

/**
 * Per-version pages of the product sitemap: by the regex `pattern` when there is one, else
 * by reading the version out of every URL the filter keeps.
 */
async function sitemapPages(
  ctx: Ctx,
  product: Product,
  line: VersionLine | undefined,
  call: CallOptions | undefined,
): Promise<VersionedPage[]> {
  const config = product.releaseNotes ?? {};
  const urls = await readProductSitemap(ctx, product, line, call);
  const filter =
    (config.sitemapFilter === undefined ? undefined : compilePattern(config.sitemapFilter)) ??
    new RegExp(RELEASE_NOTES_FILTER, 'i');
  const kept = urls.filter((url) => filter.test(url));
  if (config.pattern !== undefined && !isTemplatePattern(config.pattern)) {
    const pattern = compilePattern(config.pattern);
    if (pattern !== undefined) return pagesByPattern(kept, pattern);
  }
  const separated = versionedPages(kept, filter, 'auto');
  // Slugs that run their digits together (`release-notes-244`) are read as a second try.
  return separated.length > 0 ? separated : versionedPages(kept, filter, 'compact');
}

/** Options of {@link locateReleaseNotes}. */
export interface ReleaseNotesRequest {
  line?: VersionLine;
  /** The version the caller asked about. */
  version?: string;
  /** The current version, to label the `current` page. */
  current?: string;
  call?: CallOptions;
}

/**
 * Release-notes refs of a product: the requested version first, then the current page, then
 * the newest versions from the sitemap. An unreadable sitemap contributes a notice; the
 * static refs are still returned, so "unknown version plus the release-notes ref" (the last
 * rung of the version ladder) always has its ref.
 */
export async function locateReleaseNotes(
  ctx: Ctx,
  product: Product,
  request: ReleaseNotesRequest,
): Promise<{ refs: ReleaseNotesRef[]; notices: string[] }> {
  const config = product.releaseNotes;
  const notices: string[] = [];
  if (config === undefined) return { refs: [], notices };

  let pages: VersionedPage[] = [];
  // A template builds its URLs without the sitemap; only a filter or a regex needs the listing.
  const listsVersions =
    config.sitemapFilter !== undefined ||
    (config.pattern !== undefined && !isTemplatePattern(config.pattern));
  if (listsVersions && ctx.policy.enabled('website')) {
    try {
      pages = await sitemapPages(ctx, product, request.line, request.call);
    } catch (error) {
      if (!isMcpDocError(error)) throw error;
      notices.push(`Per-version release notes could not be listed (${error.code}).`);
    }
  }
  const same = (a: string, b: string): boolean => compareAtSharedPrecision(a, b) === 0;

  const refs: ReleaseNotesRef[] = [];
  const add = (version: string, ref: string): void => {
    if (!refs.some((known) => known.ref === ref)) refs.push({ version, ref });
  };

  const wanted = request.version;
  if (wanted !== undefined) {
    const listed = pages.find((page) => same(page.version, wanted));
    if (listed !== undefined) add(wanted, listed.url);
    else if (config.pattern !== undefined && isTemplatePattern(config.pattern)) {
      add(wanted, expandReleaseNotesPattern(config.pattern, wanted, request.line));
    }
  }
  if (config.current !== undefined) {
    add(request.current ?? CURRENT_LABEL, lineUrl(config.current, product, request.line));
  }
  for (const page of pages) {
    // The current page already stands for its version; a second ref to it adds nothing.
    const coveredByCurrent =
      config.current !== undefined &&
      request.current !== undefined &&
      same(page.version, request.current);
    if (!coveredByCurrent) add(page.version, page.url);
  }
  return { refs: refs.slice(0, MAX_REFS), notices };
}
