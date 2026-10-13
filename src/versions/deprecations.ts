/**
 * Formal deprecation notices from the Esri Knowledge Base (research section 6.2). The
 * article sitemap lists about 7,900 URLs; the notices are the ones whose slug starts with
 * `deprecation-`. Only the slug-derived title and the URL are reported: the agent opens the
 * article with `arcgis_docs_read` when it needs the text.
 */
import { humanizeSlug } from '../core/adapter-helpers.js';
import type { CallOptions, Ctx } from '../core/ports.js';
import { parseSitemap } from '../core/sitemap.js';
import type { Product } from '../core/types.js';
import { slugify } from '../core/url.js';

/** The Knowledge Base article sitemap (1.1 MB, one request, cached). */
export const KB_SITEMAP_URL = 'https://support.esri.com/en-us/knowledge-base/sitemap-articles.xml';

/** How long the filtered notice list is reused before the sitemap is read again. */
const NOTICE_LIST_TTL_MS = 24 * 60 * 60 * 1000;

const CACHE_KEY = 'kb-deprecations';

/** Characters of a product name that must be present before a cut-off slug is taken to name it. */
const MIN_TAIL = 12;

/** The Knowledge Base cuts article slugs at this many characters, before the article id. */
const SLUG_CUT = 55;

/** One deprecation notice. */
export interface DeprecationNotice {
  /** The article slug without the `deprecation-` prefix and the trailing article id. */
  subject: string;
  title: string;
  url: string;
  /** True when the slug reached the length at which the Knowledge Base cuts it off. */
  truncated: boolean;
}

interface CachedNotices {
  at: number;
  notices: DeprecationNotice[];
}

/** Filters sitemap URLs down to the formal notices. Pure. */
export function noticesFromUrls(urls: readonly string[]): DeprecationNotice[] {
  const notices: DeprecationNotice[] = [];
  for (const url of urls) {
    const slug = /\/knowledge-base\/(deprecation-[^/?#]+)/.exec(url)?.[1];
    if (slug === undefined) continue;
    // Articles end in their id (`-000032164`), which says nothing to a reader.
    const named = slug.replace(/(?:^|-)\d{6,}$/, '');
    const subject = named.replace(/^deprecation-?(?:notice-)?/, '');
    if (subject === '') continue;
    notices.push({
      subject,
      title: `Deprecation: ${humanizeSlug(subject)}`,
      url,
      truncated: named.length >= SLUG_CUT,
    });
  }
  return notices;
}

/**
 * Slug phrases that identify a product: its name and the aliases that are specific enough
 * (several words, or at least eight characters), so that `js` or `net` never match.
 */
function productPhrases(product: Product): string[] {
  return [product.name, ...product.aliases]
    .map((name) => slugify(name))
    .filter((phrase) => phrase.includes('-') || phrase.length >= 8);
}

/**
 * True when the notice names the product. Phrases match on hyphen boundaries, so
 * `arcgis-maps-sdk-for-java` does not claim a notice about `...-for-javascript`. A slug that
 * was cut off may end in the middle of the product name; its tail is then matched as a
 * prefix of the name.
 */
export function noticeConcerns(notice: DeprecationNotice, product: Product): boolean {
  const subject = `-${notice.subject}-`;
  return productPhrases(product).some((phrase) => {
    if (subject.includes(`-${phrase}-`)) return true;
    if (!notice.truncated) return false;
    const start = subject.indexOf(`-${phrase.slice(0, MIN_TAIL)}`);
    if (start < 0) return false;
    const tail = notice.subject.slice(start);
    return tail.length < phrase.length && phrase.startsWith(tail);
  });
}

/** Every formal notice in the Knowledge Base, from the derived cache when it is fresh. */
export async function listDeprecations(
  ctx: Ctx,
  call: CallOptions | undefined,
): Promise<DeprecationNotice[]> {
  const cached = await ctx.cache.getDerived<CachedNotices>('versions', CACHE_KEY);
  if (cached !== undefined && ctx.clock.now() - cached.at < NOTICE_LIST_TTL_MS) {
    return cached.notices;
  }
  const res = await ctx.http.get({
    url: KB_SITEMAP_URL,
    expect: 'xml',
    ttl: 'index',
    maxBytes: ctx.config.limits.indexMaxBytes,
    ...(call?.budget === undefined ? {} : { budget: call.budget }),
    ...(call?.signal === undefined ? {} : { signal: call.signal }),
  });
  const notices = noticesFromUrls(parseSitemap(res.text).entries.map((entry) => entry.loc));
  await ctx.cache.putDerived<CachedNotices>('versions', CACHE_KEY, {
    at: ctx.clock.now(),
    notices,
  });
  return notices;
}

/** The notices that concern one product, as notice lines for the version report. */
export async function deprecationNotices(
  ctx: Ctx,
  product: Product,
  call: CallOptions | undefined,
): Promise<string[]> {
  if (!ctx.policy.enabled('website')) return [];
  const all = await listDeprecations(ctx, call);
  return all
    .filter((notice) => noticeConcerns(notice, product))
    .map((notice) => `${notice.title} (${notice.url})`);
}
