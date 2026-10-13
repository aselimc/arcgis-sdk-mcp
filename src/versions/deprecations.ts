/**
 * Formal deprecation notices from the Esri Knowledge Base (research section 6.2). The
 * article sitemap lists about 7,900 URLs; the notices are the ones whose slug starts with
 * `deprecation-`.
 *
 * Two things keep a notice from saying more than it does:
 *
 * - **Whom it concerns.** A notice is attached to a product only when its address names
 *   that product and no other product is named by a longer phrase in the same place:
 *   `arcgis-geoanalytics-server` is about the server role, not about GeoAnalytics Engine,
 *   whatever aliases the two share. Package names (`arcgis_maps`) never identify a product
 *   here; they are substrings of many product names.
 * - **What it says.** The address is cut at 55 characters and often holds nothing but the
 *   product name, although the article deprecates one platform or feature. The line of a
 *   notice therefore carries the article's own title, read from the article (one small
 *   page, remembered for a month). When the title cannot be read the line says that only
 *   the address is known, and never reads as "the product is deprecated".
 */
import { humanizeSlug } from '../core/adapter-helpers.js';
import { budgetExhausted } from '../core/async.js';
import { isMcpDocError } from '../core/errors.js';
import type { CallOptions, Ctx } from '../core/ports.js';
import { parseSitemap } from '../core/sitemap.js';
import type { Product } from '../core/types.js';
import { slugify } from '../core/url.js';

/** The Knowledge Base article sitemap (1.1 MB, one request, cached). */
export const KB_SITEMAP_URL = 'https://support.esri.com/en-us/knowledge-base/sitemap-articles.xml';

/** How long the filtered notice list is reused before the sitemap is read again. */
const NOTICE_LIST_TTL_MS = 24 * 60 * 60 * 1000;

/** An article keeps its title; a month bounds how long a corrected one goes unnoticed. */
const TITLE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** The key changed with the shape of the cached notices: entries of the old shape are ignored. */
const CACHE_KEY = 'kb-deprecations/v2';

/** Article pages one report may read for their titles; the rest are read by later reports. */
const MAX_TITLE_READS = 3;

/** Characters of a product name that must be present before a cut-off slug is taken to name it. */
const MIN_TAIL = 12;

/** The Knowledge Base cuts article slugs at this many characters, before the article id. */
const SLUG_CUT = 55;

/** Characters of package and namespace syntax: an alias with one is not a product name. */
const PACKAGE_SYNTAX = /[_@/.:]/;

/** One deprecation notice, as its address describes it. */
export interface DeprecationNotice {
  /** The article slug without the `deprecation-` prefix and the trailing article id. */
  subject: string;
  url: string;
  /** True when the slug reached the length at which the Knowledge Base cuts it off. */
  truncated: boolean;
}

interface CachedNotices {
  at: number;
  notices: DeprecationNotice[];
}

interface CachedTitle {
  at: number;
  title: string;
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
    notices.push({ subject, url, truncated: named.length >= SLUG_CUT });
  }
  return notices;
}

/** The words of a notice's address, with an ellipsis where the site cut them off. */
export function slugWords(notice: DeprecationNotice): string {
  return `${humanizeSlug(notice.subject)}${notice.truncated ? '…' : ''}`;
}

/**
 * Slug phrases that identify a product: its name, and the aliases that are specific enough
 * (several words, or at least eight characters) and are names rather than package or
 * namespace spellings, so that `js`, `net` and `arcgis_maps` never match.
 */
function productPhrases(product: Product): string[] {
  const packages = new Set(product.packages.map((ref) => ref.name.toLowerCase()));
  const aliases = product.aliases.filter(
    (alias) => !PACKAGE_SYNTAX.test(alias) && !packages.has(alias.toLowerCase()),
  );
  const phrases = [product.name, ...aliases]
    .map((name) => slugify(name))
    .filter((phrase) => phrase.includes('-') || phrase.length >= 8);
  return [...new Set(phrases)];
}

/** Where a phrase occurs in a subject on hyphen boundaries, as `[start, end)` offsets. */
function occurrences(subject: string, phrase: string): Array<[number, number]> {
  const found: Array<[number, number]> = [];
  const padded = `-${subject}-`;
  const needle = `-${phrase}-`;
  for (let at = padded.indexOf(needle); at >= 0; at = padded.indexOf(needle, at + 1)) {
    found.push([at, at + phrase.length]);
  }
  return found;
}

/** Decides which products a notice concerns, over one product list. */
export interface NoticeMatcher {
  concerns(notice: DeprecationNotice, product: Product): boolean;
}

/**
 * Builds the matcher for a registry. A notice concerns a product when one of the product's
 * phrases occurs in its address on hyphen boundaries and no longer phrase of **another**
 * product covers that occurrence. An alias that merely begins another product's name
 * (`arcgis-geoanalytics` before `-server`) identifies nothing and is dropped up front; the
 * product's own name always counts.
 *
 * A slug that was cut off may end in the middle of the product name; its tail is then
 * matched as a prefix of the name.
 */
export function createNoticeMatcher(products: readonly Product[]): NoticeMatcher {
  const names = products.map((product) => ({ id: product.id, name: slugify(product.name) }));
  const phrasesOf = new Map<string, string[]>();
  for (const product of products) {
    const ownName = slugify(product.name);
    const own = productPhrases(product).filter(
      (phrase) =>
        phrase === ownName ||
        !names.some((other) => other.id !== product.id && other.name.startsWith(`${phrase}-`)),
    );
    phrasesOf.set(product.id, own);
  }
  const phrases = (product: Product): string[] =>
    // A product that is not part of the list (a test double) is matched by its own phrases.
    phrasesOf.get(product.id) ?? productPhrases(product);

  return {
    concerns(notice, product) {
      const rivals = [...phrasesOf]
        .filter(([id]) => id !== product.id)
        .flatMap(([, list]) => list);
      return phrases(product).some((phrase) => {
        const claimed = occurrences(notice.subject, phrase).some(
          ([start, end]) =>
            !rivals.some(
              (rival) =>
                rival.length > phrase.length &&
                occurrences(notice.subject, rival).some(
                  ([from, to]) => from <= start && to >= end,
                ),
            ),
        );
        if (claimed) return true;
        if (!notice.truncated) return false;
        const at = `-${notice.subject}-`.indexOf(`-${phrase.slice(0, MIN_TAIL)}`);
        if (at < 0) return false;
        const tail = notice.subject.slice(at);
        return tail.length < phrase.length && phrase.startsWith(tail);
      });
    },
  };
}

/** True when the notice names the product (see {@link createNoticeMatcher}). */
export function noticeConcerns(
  notice: DeprecationNotice,
  product: Product,
  products: readonly Product[] = [product],
): boolean {
  return createNoticeMatcher(products).concerns(notice, product);
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

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** The `<title>` of an article page, as plain text; `undefined` when there is none. */
export function titleOfArticle(html: string): string | undefined {
  const raw = /<title\b[^>]*>([^<]*)<\/title\s*>/i.exec(html)?.[1];
  const title = raw
    ?.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
      if (!body.startsWith('#')) return ENTITIES[body.toLowerCase()] ?? whole;
      const hex = /^#x/i.test(body);
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    })
    .replace(/\s+/g, ' ')
    .trim();
  return title === undefined || title === '' ? undefined : title;
}

/** How one notice is read for its title. */
type TitleOutcome = { title: string } | { title?: undefined; retry: boolean };

/**
 * The article title of a notice: from the derived cache, else from the article page.
 * `retry` tells whether a later report may succeed where this one did not.
 */
async function articleTitle(
  ctx: Ctx,
  notice: DeprecationNotice,
  call: CallOptions | undefined,
  mayRead: () => boolean,
): Promise<TitleOutcome> {
  const key = `kb-title/${notice.url}`;
  const cached = await ctx.cache.getDerived<CachedTitle>('versions', key);
  if (cached !== undefined && ctx.clock.now() - cached.at < TITLE_TTL_MS) {
    return { title: cached.title };
  }
  if (!mayRead()) return { retry: true };
  try {
    const res = await ctx.http.get({
      url: notice.url,
      expect: 'html',
      ttl: 'page',
      ...(call?.budget === undefined ? {} : { budget: call.budget }),
      ...(call?.signal === undefined ? {} : { signal: call.signal }),
    });
    const title = titleOfArticle(res.text);
    // An article without a title will not grow one: the address is all there is.
    if (title === undefined) return { retry: false };
    await ctx.cache.putDerived<CachedTitle>('versions', key, { at: ctx.clock.now(), title });
    return { title };
  } catch (error) {
    // The notice is still worth reporting; only programming errors surface.
    if (!isMcpDocError(error)) throw error;
    return { retry: true };
  }
}

/** The notice line of a report: the article title when known, else what the address says. */
export function noticeLine(notice: DeprecationNotice, title: string | undefined): string {
  if (title !== undefined) {
    return `Deprecation notice (Esri Knowledge Base): "${title}" (${notice.url})`;
  }
  return `Deprecation notice (Esri Knowledge Base) whose address names this product: "${slugWords(notice)}" (${notice.url}). The address does not say what is deprecated; it may be one platform or feature. Read the article.`;
}

/** Outcome of {@link deprecationNotices}. */
export interface ProductDeprecations {
  lines: string[];
  /** False when a title could not be read yet: the report must not be remembered as final. */
  complete: boolean;
}

/** The notices that concern one product, as notice lines for the version report. */
export async function deprecationNotices(
  ctx: Ctx,
  product: Product,
  call: CallOptions | undefined,
): Promise<ProductDeprecations> {
  if (!ctx.policy.enabled('website')) return { lines: [], complete: true };
  const all = await listDeprecations(ctx, call);
  const matcher = createNoticeMatcher(ctx.registry.all());
  const lines: string[] = [];
  let complete = true;
  let reads = 0;
  const mayRead = (): boolean => {
    if (reads >= MAX_TITLE_READS) return false;
    if (call?.budget !== undefined && budgetExhausted(call.budget, ctx.clock)) return false;
    reads += 1;
    return true;
  };
  for (const notice of all.filter((candidate) => matcher.concerns(candidate, product))) {
    const outcome = await articleTitle(ctx, notice, call, mayRead);
    if (outcome.title === undefined && outcome.retry) complete = false;
    lines.push(noticeLine(notice, outcome.title));
  }
  return { lines, complete };
}
