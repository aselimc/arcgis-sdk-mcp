/**
 * The `legacy-help` adapter: help in the older page layout on doc.arcgis.com,
 * enterprise.arcgis.com and the numbered releases on pro.arcgis.com.
 *
 * These sites have no usable site-wide sitemap; every book (a directory of topics) is listed
 * on its own, from the best of three places:
 *
 * 1. its table-of-contents script `<NNNN>.js` (titles, hierarchy, reading order): a
 *    site-published index file, read only while `site-index` is enabled. The registry may
 *    name the script; otherwise, or when the named one is gone, its name is read from a
 *    topic page of the book;
 * 2. `flisting.htm`, the link list for browsers without scripts (live topics, short titles);
 * 3. the book's `sitemap.xml` (titles from the slug; it also lists redirect stubs).
 *
 * `config.enumerate: 'on-demand'` and `config.lines` are scheduling hints for the index
 * service (a book of an old release is listed only when a search names that release). The
 * adapter lists whichever line it is bound to, whenever it is asked.
 */
import { humanizeSlug } from '../../core/adapter-helpers.js';
import { McpDocError, toMcpDocError } from '../../core/errors.js';
import { BREADCRUMB_SEPARATOR } from '../../core/names.js';
import type { BoundSource, Ctx, ProbeResult, SourceAdapter } from '../../core/ports.js';
import { expandTemplate } from '../../core/source-urls.js';
import type { AdapterConfigMap, CatalogRecord, DocKind } from '../../core/types.js';
import {
  findTocScripts,
  parseFileListing,
  parseTreedata,
  treePages,
  type TreePage,
} from './legacy-treedata.js';
import { readSitemap } from './sitemap.js';
import {
  assertLive,
  budgetOf,
  tolerate,
  probeSource,
  readHtmlPage,
  recordOf,
} from '../kit/index.js';

type LegacySource = BoundSource<'legacy-help'>;
type Book = AdapterConfigMap['legacy-help']['books'][number];

/**
 * Requests one book may use: a named script that is gone, the link list, a topic page and
 * the script that page names. The usual case is one.
 */
const REQUESTS_PER_BOOK = 4;
/** Covers the largest source of the registry (21 books) in the worst case. */
const MAX_ENUMERATE_REQUESTS = 84;
/** The table of contents of a large book is several megabytes. */
const SCRIPT_MAX_BYTES = 32 * 1024 * 1024;

/** A topic found in a book: its URL, a title when the listing has one, and its headings. */
interface Listed {
  ref: string;
  title: string;
  ancestors: string[];
}

/** Requests a book may still issue. */
interface Allowance {
  left: number;
}

function unusable(url: string, what: string, why: string): McpDocError {
  return new McpDocError('UPSTREAM_UNAVAILABLE', `${url} is not a readable ${what}`, {
    why,
    url,
    host: new URL(url).host,
    retryable: false,
  });
}

function pageKind(src: LegacySource): DocKind {
  return src.source.kinds[0] ?? 'help';
}

/** `https://<host><base><book>/`, the directory every topic of the book lives in. */
function bookBase(src: LegacySource, book: Book): string {
  return src.url(`${book.path.replace(/^\/+|\/+$/g, '')}/`);
}

/**
 * The URL of a topic inside a book, or `undefined` when `href` points elsewhere.
 *
 * Listings of a book that is addressed as `latest` spell the release number instead
 * (`/en/cityengine/2026.0/cga/...`), so a `latest` segment of the book directory matches any
 * segment; the result is always written with the book's own directory. Fragments are dropped.
 */
function topicUrl(base: string, href: string, from: string): string | undefined {
  if (!URL.canParse(href, from)) return undefined;
  const url = new URL(href, from);
  const book = new URL(base);
  if (url.host !== book.host) return undefined;
  const segments = book.pathname
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) =>
      segment === 'latest' ? '[^/]+' : segment.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&'),
    );
  const rest = new RegExp(`^/${segments.join('/')}/(.+)$`).exec(url.pathname)?.[1];
  if (rest === undefined || /^flisting\.html?$/i.test(rest)) return undefined;
  return `${base}${rest}${url.search}`;
}

function unique(listed: readonly Listed[]): Listed[] {
  const byRef = new Map<string, Listed>();
  for (const topic of listed) if (!byRef.has(topic.ref)) byRef.set(topic.ref, topic);
  return [...byRef.values()];
}

/** The topics a table-of-contents script lists for a book. */
async function readTree(
  ctx: Ctx,
  src: LegacySource,
  scriptUrl: string,
  base: string,
): Promise<Listed[]> {
  const res = await ctx.http.get({
    url: scriptUrl,
    expect: 'text',
    ttl: 'index',
    maxBytes: SCRIPT_MAX_BYTES,
    ...budgetOf(src),
  });
  const pages: TreePage[] = treePages(parseTreedata(res.text));
  const listed = unique(
    pages.flatMap((page) => {
      const ref = topicUrl(base, page.url, scriptUrl);
      return ref === undefined ? [] : [{ ref, title: page.title, ancestors: page.ancestors }];
    }),
  );
  if (listed.length === 0) {
    throw unusable(scriptUrl, 'table-of-contents script', 'It names no topic of the book');
  }
  return listed;
}

/** The topics `flisting.htm` links to. */
async function readListing(ctx: Ctx, src: LegacySource, base: string): Promise<Listed[]> {
  const url = `${base}flisting.htm`;
  const res = await ctx.http.get({ url, expect: 'html', ttl: 'index', ...budgetOf(src) });
  const listed = unique(
    parseFileListing(res.text).flatMap((link) => {
      const ref = topicUrl(base, link.href, url);
      return ref === undefined ? [] : [{ ref, title: link.title, ancestors: [] }];
    }),
  );
  if (listed.length === 0) throw unusable(url, 'topic list', 'It links to no topic of the book');
  return listed;
}

/** The topics the book's own sitemap lists; they have no titles. */
async function readBookSitemap(ctx: Ctx, src: LegacySource, base: string): Promise<Listed[]> {
  const url = `${base}sitemap.xml`;
  const locs = await readSitemap(ctx, src, url, 1);
  const listed = unique(
    locs.flatMap((loc) => {
      const ref = topicUrl(base, loc.replace(/^http:/i, 'https:'), url);
      return ref === undefined ? [] : [{ ref, title: '', ancestors: [] }];
    }),
  );
  if (listed.length === 0) throw unusable(url, 'sitemap', 'It lists no topic of the book');
  return listed;
}

/** The table-of-contents script a topic page of the book loads, preferring one inside the book. */
async function discoverScript(
  ctx: Ctx,
  src: LegacySource,
  pageUrl: string,
  base: string,
): Promise<string | undefined> {
  const res = await ctx.http.get({ url: pageUrl, expect: 'html', ttl: 'page', ...budgetOf(src) });
  const scripts = findTocScripts(res.text)
    .filter((script) => URL.canParse(script, res.finalUrl))
    .map((script) => new URL(script, res.finalUrl))
    .filter((script) => script.host === new URL(base).host);
  // `x` stands in for a topic: the script sits in the book directory, next to its topics.
  const inBook = scripts.find(
    (script) => topicUrl(base, new URL('x', script).href, pageUrl) !== undefined,
  );
  return (inBook ?? scripts[0])?.href;
}

/**
 * Lists one book within its request allowance, from the best listing that answers.
 *
 * @throws McpDocError when none of the listings is available, or the request budget of the
 *   call is spent.
 */
async function enumerateBook(
  ctx: Ctx,
  src: LegacySource,
  book: Book,
  allowance: Allowance,
): Promise<Listed[]> {
  const base = bookBase(src, book);
  const siteIndex = ctx.policy.enabled('site-index');
  let failure: McpDocError | undefined;
  const attempt = async <V>(what: string, run: () => Promise<V>): Promise<V | undefined> => {
    if (allowance.left <= 0) return undefined;
    allowance.left -= 1;
    try {
      return await run();
    } catch (error) {
      failure ??= toMcpDocError(error);
      tolerate(ctx, src, error, what);
      return undefined;
    }
  };

  const named =
    book.tocScript === undefined
      ? undefined
      : new URL(expandTemplate(book.tocScript, src.line), base).href;
  if (siteIndex && named !== undefined) {
    const tree = await attempt(`Table-of-contents script ${named}`, () =>
      readTree(ctx, src, named, base),
    );
    if (tree !== undefined) return tree;
  }

  const listed =
    (await attempt(`Topic list ${base}flisting.htm`, () => readListing(ctx, src, base))) ??
    (await attempt(`Sitemap ${base}sitemap.xml`, () => readBookSitemap(ctx, src, base)));
  if (listed === undefined) {
    throw failure ?? unusable(base, 'book', 'The request allowance of the enumeration is spent');
  }

  // Titles and hierarchy are worth two more requests: a topic page names the script.
  const first = listed[0];
  if (!siteIndex || first === undefined || allowance.left < 2) return listed;
  const script = await attempt(`Topic page ${first.ref}`, () =>
    discoverScript(ctx, src, first.ref, base),
  );
  if (script === undefined || script === named) return listed;
  const tree = await attempt(`Table-of-contents script ${script}`, () =>
    readTree(ctx, src, script, base),
  );
  // The script is the book's navigation; a live topic it omits keeps its place at the end.
  return tree === undefined ? listed : unique([...tree, ...listed]);
}

/**
 * `legacy-help`: the books of one product on one of the older help hosts, for the version
 * line the source is bound to. Pages are converted by the `legacy-help` HTML profile.
 */
export const legacyHelpAdapter: SourceAdapter<'legacy-help'> = {
  type: 'legacy-help',
  maxEnumerateRequests: MAX_ENUMERATE_REQUESTS,

  async enumerate(ctx, src) {
    const root = src.url();
    assertLive(src, root);
    const { books } = src.source.config;
    const records = new Map<string, CatalogRecord>();
    let firstFailure: McpDocError | undefined;
    let remaining = MAX_ENUMERATE_REQUESTS;

    for (const book of books) {
      if (remaining <= 0) {
        ctx.logger.warn('The source has more books than one enumeration may request', {
          product: src.product.id,
          source: src.source.id,
          books: books.length,
        });
        break;
      }
      const allowance = { left: Math.min(REQUESTS_PER_BOOK, remaining) };
      const granted = allowance.left;
      // In a source of several books the book is the outermost level of the breadcrumb.
      const lead = books.length > 1 ? [humanizeSlug(book.path)] : [];
      try {
        for (const topic of await enumerateBook(ctx, src, book, allowance)) {
          if (records.has(topic.ref)) continue;
          const trail = [...lead, ...topic.ancestors];
          records.set(topic.ref, {
            ...recordOf(src, topic.ref, pageKind(src), topic.title || humanizeSlug(topic.ref)),
            ...(trail.length === 0 ? {} : { breadcrumb: trail.join(BREADCRUMB_SEPARATOR) }),
          });
        }
      } catch (error) {
        firstFailure ??= toMcpDocError(error);
        tolerate(ctx, src, error, `Book ${bookBase(src, book)}`);
      }
      remaining -= granted - allowance.left;
    }

    if (records.size > 0) return [...records.values()];
    if (firstFailure !== undefined) throw firstFailure;
    throw new McpDocError(
      'UPSTREAM_UNAVAILABLE',
      `No page of ${src.source.title} could be listed`,
      {
        why: 'The source names no book',
        url: root,
        host: new URL(root).host,
        retryable: false,
      },
    );
  },

  read(ctx, src, target) {
    return readHtmlPage(ctx, src, target, { kind: pageKind(src) });
  },

  probe(ctx, src): Promise<ProbeResult> {
    const probe = { ...src.source.probe };
    if (/\/flisting\.html?$/i.test(probe.url)) {
      // A link list is not a help topic, so the page family the source declares cannot hold for it.
      delete probe.family;
      return probeSource(
        ctx,
        { ...src, source: { ...src.source, probe } },
        { count: (body) => parseFileListing(body).length },
      );
    }
    if (/\/\d+\.js$/.test(probe.url)) {
      return probeSource(ctx, src, {
        siteIndex: true,
        count: (body) => parseTreedata(body).size,
      });
    }
    return probeSource(ctx, src);
  },
};
