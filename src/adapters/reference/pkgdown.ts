/**
 * The `pkgdown` adapter: R package sites built with pkgdown, one site per package under a
 * shared host. Each site is catalogued from its `search.json`; a package whose index does
 * not answer is skipped, because not every package has a site yet. A page is read as the
 * Markdown twin recent pkgdown versions publish next to it, where the site has one, and as
 * HTML otherwise.
 */
import { type McpDocError, toMcpDocError } from '../../core/errors.js';
import type { BoundSource, Ctx, ReadTarget, SourceAdapter } from '../../core/ports.js';
import type { CatalogRecord, DocKind, DocPage } from '../../core/types.js';
import {
  assertLive,
  budgetOf,
  tolerate,
  indexRequest,
  oneLine,
  probeSource,
  readHtmlPage,
  symbolRecord,
  renderMeta,
  renderOptionsOf,
  siteIndexEnabled,
  symbolTarget,
  unusableIndex,
  isIndexCanary,
} from '../kit/index.js';

/** Package sites read by one enumeration, one request each. */
const MAX_PACKAGES = 12;
/** Section headings kept per article, as search vocabulary. */
const MAX_HEADINGS = 12;

/** One row of `search.json`: a section (`what`) of the page at `path`. */
interface SearchRow {
  path?: unknown;
  title?: unknown;
  what?: unknown;
  dir?: unknown;
}

/** Pages every pkgdown site generates that document nothing. */
const BOILERPLATE = /^(?:LICENSE|LICENCE|authors|404)[^/]*\.html$/i;
/** `Query a feature service — arc_select`: the reference title ends with the topic name. */
const TOPIC_SEPARATOR = ' — ';

/**
 * The path of a page inside its package site. `search.json` writes absolute URLs from the
 * site's configured address, which need not be where the site is served (the R packages
 * are configured for another host), so only the part pkgdown itself lays out is kept: the
 * section directory and what follows, or the file name of a top-level page.
 */
function sitePath(path: string): string {
  const bare = path.replace(/[?#].*$/, '');
  const section = /(?:^|\/)((?:reference|articles|news)\/.*)$/.exec(bare)?.[1];
  const relative = section ?? bare.slice(bare.lastIndexOf('/') + 1);
  return relative.replace(/(?:^|(?<=\/))index\.html$/, '');
}

function kindOf(relative: string): DocKind {
  if (relative.startsWith('reference/')) return 'api';
  return relative.startsWith('news/') ? 'release-notes' : 'guide';
}

/**
 * Catalogue records of one package site: one per page, whatever number of sections the
 * index lists for it. A reference page is a symbol named `package::topic`; other pages keep
 * their section headings. Body text in the index is not used.
 */
export function pkgdownRecords(
  src: BoundSource,
  pkg: string,
  rows: readonly unknown[],
): CatalogRecord[] {
  const root = `${src.url()}${pkg}/`;
  const pages = new Map<
    string,
    { title: string; relative: string; dir: string; headings: string[] }
  >();
  for (const row of rows as ReadonlyArray<SearchRow | null>) {
    const { path, title, what, dir } = row ?? {};
    if (typeof path !== 'string' || typeof title !== 'string' || title.trim() === '') continue;
    const relative = sitePath(path);
    if (BOILERPLATE.test(relative)) continue;
    const page = pages.get(relative) ?? {
      title: title.trim(),
      relative,
      dir: typeof dir === 'string' ? dir : '',
      headings: [],
    };
    pages.set(relative, page);
    const heading = oneLine(what, 120);
    if (heading !== undefined && heading !== page.title && !page.headings.includes(heading)) {
      page.headings.push(heading);
    }
  }
  return [...pages.values()].map((page) => {
    const ref = new URL(page.relative, root).href;
    const kind = kindOf(page.relative);
    const breadcrumb = [pkg, page.dir];
    if (kind !== 'api') {
      const headings = page.headings.slice(0, MAX_HEADINGS);
      return symbolRecord(src, ref, page.title, {
        kind,
        breadcrumb,
        ...(headings.length === 0 ? {} : { headings }),
      });
    }
    const cut = page.title.lastIndexOf(TOPIC_SEPARATOR);
    const file = page.relative.replace(/^.*\//, '').replace(/\.html$/, '');
    const topic = cut < 0 ? file : page.title.slice(cut + TOPIC_SEPARATOR.length).trim();
    // The reference index has no topic of its own.
    if (topic === '') return symbolRecord(src, ref, page.title, { breadcrumb });
    return symbolRecord(src, ref, topic, {
      symbol: topic,
      qualified: `${pkg}::${topic}`,
      symbolKind: 'function',
      breadcrumb,
      description: oneLine(cut < 0 ? page.title : page.title.slice(0, cut)),
    });
  });
}

/**
 * Whether a package site publishes Markdown twins of its pages. pkgdown writes them together
 * with `llms.txt`, so that one small file answers for the whole site; the answer is kept for
 * the life of the process.
 */
async function hasMarkdown(ctx: Ctx, src: BoundSource, pkg: string): Promise<boolean> {
  const url = `${src.url()}${pkg}/llms.txt`;
  try {
    return await ctx.cache.memo(`pkgdown:markdown:${url}`, async () => {
      try {
        await ctx.http.get({ url, expect: 'text', ttl: 'index', ...budgetOf(src) });
        return { value: true, bytes: 8 };
      } catch (error) {
        if (toMcpDocError(error).code !== 'DOC_NOT_FOUND') throw error;
        return { value: false, bytes: 8 };
      }
    });
  } catch (error) {
    // Not knowing is not a reason to fail a read: the HTML page is always there.
    if (toMcpDocError(error).code === 'INTERNAL') throw error;
    return false;
  }
}

async function read(ctx: Ctx, src: BoundSource, target: ReadTarget): Promise<DocPage> {
  assertLive(src, target.url.href);
  const root = src.url();
  const bare = target.url.href.replace(/[?#].*$/, '');
  const [pkg = '', ...rest] = bare.startsWith(root) ? bare.slice(root.length).split('/') : [];
  const relative = rest.join('/');
  const kind = kindOf(relative);
  if (relative.endsWith('.html') && (await hasMarkdown(ctx, src, pkg))) {
    try {
      const res = await ctx.http.get({
        url: bare.replace(/\.html$/, '.md'),
        expect: 'text',
        ttl: 'page',
        ...budgetOf(src),
      });
      return ctx.render.render(
        'markdown',
        { markdown: res.text },
        renderMeta(src, target, `${bare}${target.url.hash}`, res, kind),
        renderOptionsOf(target),
      );
    } catch (error) {
      // A page without a twin (an article built from a vignette) is read as HTML.
      if (toMcpDocError(error).code !== 'DOC_NOT_FOUND') throw error;
    }
  }
  return readHtmlPage(ctx, src, target, { kind });
}

/**
 * `pkgdown`: one request per package for `search.json`. Reads prefer the Markdown twin of a
 * page; the first read of a package spends one extra request to learn whether it has them.
 */
export const pkgdownAdapter: SourceAdapter<'pkgdown'> = {
  type: 'pkgdown',
  maxEnumerateRequests: MAX_PACKAGES,

  async enumerate(ctx, src) {
    assertLive(src, src.url());
    if (!siteIndexEnabled(ctx, src)) return [];
    const records = new Map<string, CatalogRecord>();
    let firstFailure: McpDocError | undefined;
    for (const pkg of src.source.config.packages.slice(0, MAX_PACKAGES)) {
      const url = `${src.url()}${pkg}/search.json`;
      try {
        const { data } = await ctx.http.getJson(indexRequest(src, url, 'json'));
        if (!Array.isArray(data)) throw unusableIndex(url, 'The index is not a list of sections');
        const found = pkgdownRecords(src, pkg, data);
        if (found.length === 0) throw unusableIndex(url, 'No row has a path and a title');
        for (const record of found) records.set(record.ref, record);
      } catch (error) {
        firstFailure ??= toMcpDocError(error);
        tolerate(ctx, src, error, `The package site ${pkg}`);
      }
    }
    if (records.size > 0) return [...records.values()];
    throw firstFailure ?? unusableIndex(src.url(), 'No package is configured for this source');
  },

  read,
  symbol: (ctx, src, record, detail) => read(ctx, src, symbolTarget(record, detail)),
  probe: (ctx, src) => probeSource(ctx, src, { siteIndex: isIndexCanary(src) }),
};
