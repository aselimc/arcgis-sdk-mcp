/**
 * Release-notes locator (research section 4 and 8.3). `arcgis_docs_get_versions` returns
 * refs, never release-note text: the agent opens the ref with `arcgis_docs_read`.
 *
 * `Product.releaseNotes` gives up to three ways to find a page:
 * - `current`: the page (or meta-refresh stub) of the current release;
 * - `sitemapFilter`: a URL regex over the product sitemap, which lists one page per version;
 * - `pattern`, in one of two forms. A regular expression whose first capture group is the
 *   version slug of a per-version page (`/release-notes-for-(\d+-\d+)/$`) names the pages
 *   among the sitemap URLs; a second capture group, when there is one, names the variant of
 *   a page (`net`, `java`) where a release has several, and every variant is listed (named
 *   groups `version`, `variant` and `part` may be used instead, in any order). A URL
 *   template with `{version}` (also `{dashed}`, `{compact}`, `{major}`, `{minor}`, `{patch}`
 *   and the line variables) builds the page of a version without any request.
 *
 * A ref is a statement that the page exists. Refs therefore come from the sitemap or from
 * `current`. A URL built from a template is listed only where no sitemap listing can
 * confirm or refute it, it is labelled `(unverified)`, and it never leads the list: the
 * first ref is what the tool offers as the next call.
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

/** Versions returned for one product: the requested and current ones plus the newest others. */
const MAX_VERSIONS = 6;

/** Refs returned for one product, so a release with five variants cannot flood a result. */
const MAX_REFS = 12;

/** Label of the current page when no oracle could name the version. */
export const CURRENT_LABEL = 'current';

/** Suffix of a ref label whose URL was built from a template and seen nowhere. */
export const UNVERIFIED_SUFFIX = ' (unverified)';

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

/** A per-version page, with the variant it is when a release has several pages. */
export interface ReleaseNotesPage extends VersionedPage {
  /** `net`, `java`, `cdf`: the variant group of a regex `pattern`. */
  variant?: string;
  /**
   * `api`: the part group of a regex `pattern`, for a variant whose release has more than
   * one page (the .NET overview and the .NET API changes of Enterprise SDK 12.1).
   */
  part?: string;
}

/** The version slug, variant and part of a URL that `pattern` matches. */
function pageParts(
  match: RegExpExecArray,
): { slug?: string; variant?: string; part?: string } | undefined {
  const named = match.groups;
  // Named groups may appear in any order: `(?<part>api)-` stands in front of the version.
  if (named?.version !== undefined) {
    return {
      slug: named.version,
      ...(named.variant === undefined ? {} : { variant: named.variant }),
      ...(named.part === undefined ? {} : { part: named.part }),
    };
  }
  return { ...(match[1] === undefined ? {} : { slug: match[1] }), ...(match[2] === undefined ? {} : { variant: match[2] }) };
}

/**
 * Pages whose URL matches a regex `pattern`. Newest first. The version slug is the first
 * capture group and the variant the second, or the named groups `version`, `variant` and
 * `part`, which may stand in any order.
 *
 * Without a variant there is one page per version (the first URL in sitemap order, which
 * keeps the current page ahead of a `prior-releases` copy). With one, every matching URL is
 * kept and the variants of a version are ordered as the pattern names them (`(net|java|cdf)`
 * lists the .NET page first). A `part` tells the pages of one variant apart in their label.
 */
export function pagesByPattern(urls: readonly string[], pattern: RegExp): ReleaseNotesPage[] {
  const pages: ReleaseNotesPage[] = [];
  const seenVersions = new Set<string>();
  const seenUrls = new Set<string>();
  for (const url of urls) {
    const match = pattern.exec(url);
    const parts = match === null ? undefined : pageParts(match);
    if (parts?.slug === undefined || seenUrls.has(url)) continue;
    const version = versionFromSlugText(parts.slug);
    const { variant, part } = parts;
    if (variant === undefined && seenVersions.has(version)) continue;
    seenVersions.add(version);
    seenUrls.add(url);
    pages.push({
      version,
      url,
      ...(variant === undefined ? {} : { variant }),
      ...(part === undefined ? {} : { part }),
    });
  }
  const rank = (page: ReleaseNotesPage): number => {
    const at = page.variant === undefined ? -1 : pattern.source.indexOf(page.variant);
    return at < 0 ? Number.MAX_SAFE_INTEGER : at;
  };
  // A stable sort: pages of one version and variant stay in sitemap order.
  return pages.sort((a, b) => compareVersions(b.version, a.version) || rank(a) - rank(b));
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
): Promise<ReleaseNotesPage[]> {
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

/** Outcome of {@link locateReleaseNotes}. */
export interface LocatedReleaseNotes {
  /** Verified refs first; the first one is safe to offer as the next call. */
  refs: ReleaseNotesRef[];
  notices: string[];
  /**
   * False when the per-version listing could not be read: the answer may be better on the
   * next call, so it must not be remembered.
   */
  complete: boolean;
}

/** A version an agent can have meant: it has at least one number. `""` and `"latest"` have none. */
function isVersion(text: string | undefined): text is string {
  return text !== undefined && parseVersion(normalizeVersion(text)).length > 0;
}

/**
 * Release-notes refs of a product: the pages of the requested version first, then the
 * current page, then the newest versions from the sitemap. An unreadable sitemap contributes
 * a notice; the static refs are still returned, so "unknown version plus the release-notes
 * ref" (the last rung of the version ladder) always has its ref.
 *
 * A requested version without a listed page gets a notice instead of a constructed URL
 * whenever the listing could have shown it, or the version is ahead of the current one.
 */
export async function locateReleaseNotes(
  ctx: Ctx,
  product: Product,
  request: ReleaseNotesRequest,
): Promise<LocatedReleaseNotes> {
  const config = product.releaseNotes;
  const notices: string[] = [];
  if (config === undefined) return { refs: [], notices, complete: true };

  let pages: ReleaseNotesPage[] = [];
  let complete = true;
  // A template builds its URLs without the sitemap; only a filter or a regex needs the listing.
  const listsVersions =
    config.sitemapFilter !== undefined ||
    (config.pattern !== undefined && !isTemplatePattern(config.pattern));
  if (listsVersions && ctx.policy.enabled('website')) {
    try {
      pages = await sitemapPages(ctx, product, request.line, request.call);
    } catch (error) {
      if (!isMcpDocError(error)) throw error;
      complete = false;
      notices.push(`Per-version release notes could not be listed (${error.code}).`);
    }
  }
  const same = (a: string, b: string): boolean => compareAtSharedPrecision(a, b) === 0;
  const labelOf = (page: ReleaseNotesPage, version = page.version): string => {
    const qualifiers = [page.variant, page.part].filter((word) => word !== undefined);
    return qualifiers.length === 0 ? version : `${version} (${qualifiers.join(' ')})`;
  };

  const refs: ReleaseNotesRef[] = [];
  /** The releases the refs cover, to stop at {@link MAX_VERSIONS} whatever their page count. */
  const releases = new Set<string>();
  const add = (label: string, ref: string, release: string): void => {
    releases.add(release);
    if (!refs.some((known) => known.ref === ref)) refs.push({ version: label, ref });
  };

  // An empty or wordy "version" names no release: nothing is looked up or built for it.
  const wanted = isVersion(request.version) ? request.version.trim() : undefined;
  let unverified: ReleaseNotesRef | undefined;
  if (wanted !== undefined) {
    // A coarse version (`v200`, `5`) agrees with several releases: it stands for the
    // newest, and every page of that one release is listed.
    const release = pages.find((page) => same(page.version, wanted))?.version;
    const listed = pages.filter((page) => page.version === release);
    for (const page of listed) add(labelOf(page, wanted), page.url, page.version);
    if (listed.length === 0) {
      const template =
        config.pattern !== undefined && isTemplatePattern(config.pattern)
          ? config.pattern
          : undefined;
      const ahead =
        request.current !== undefined &&
        (compareAtSharedPrecision(wanted, request.current) ?? 0) > 0;
      if (pages.length > 0) {
        // The listing answered and does not have it: a built URL would be a guess at a 404.
        notices.push(
          `No release-notes page is listed for ${wanted}; the refs are the pages that exist.`,
        );
      } else if (ahead) {
        notices.push(`${wanted} is ahead of the current version: it has no release notes yet.`);
      } else if (template !== undefined) {
        unverified = {
          version: `${wanted}${UNVERIFIED_SUFFIX}`,
          ref: expandReleaseNotesPattern(template, wanted, request.line),
        };
      }
    }
  }
  if (config.current !== undefined) {
    const label = request.current ?? CURRENT_LABEL;
    add(label, lineUrl(config.current, product, request.line), label);
  }
  for (const page of pages) {
    // The current page already stands for its version; a second ref to it adds nothing.
    const coveredByCurrent =
      config.current !== undefined &&
      request.current !== undefined &&
      same(page.version, request.current);
    if (coveredByCurrent) continue;
    if (!releases.has(page.version) && releases.size >= MAX_VERSIONS) continue;
    add(labelOf(page), page.url, page.version);
  }
  // Behind a verified ref when there is one, so the tool's next call is never a guess; with
  // nothing verified the guess is said in words rather than offered as a ref.
  if (unverified !== undefined) {
    if (refs.length > 0) refs.splice(1, 0, unverified);
    else {
      notices.push(
        `The release notes of ${wanted ?? ''} would be at ${unverified.ref}; that address is built from a pattern and was not checked.`,
      );
    }
  }
  return { refs: refs.slice(0, MAX_REFS), notices, complete };
}
