/**
 * The `docfx-esri` adapter: the product documentation on doc.esri.com (ArcGIS Pro with ArcPy
 * and the geoprocessing tool reference, Enterprise, Notebooks and some thirty other products).
 *
 * A source is listed from two places, merged by URL with the richer one first:
 *
 * 1. its `toc.json` files (titles, hierarchy and, for the Python references, symbols); these
 *    are site-published index files and are read only while `site-index` is enabled;
 * 2. the product sitemap (every page, titles from the slug), which also covers pages no table
 *    of contents links to and is the floor when the first rung is unavailable.
 *
 * The site documents the current release only, under `/latest/`; its sitemap spells the
 * release number instead, which is rewritten here.
 */
import { humanizeSlug } from '../../core/adapter-helpers.js';
import { McpDocError, toMcpDocError } from '../../core/errors.js';
import { BREADCRUMB_SEPARATOR } from '../../core/names.js';
import type { BoundSource, Ctx, ProbeResult, ReadTarget, SourceAdapter } from '../../core/ports.js';
import { sourceBaseUrls } from '../../core/source-urls.js';
import type { CatalogRecord, DocKind, DocPage } from '../../core/types.js';
import {
  arcpySymbol,
  gpToolSymbol,
  gpToolboxAlias,
  parseToc,
  pythonSignature,
  tocBooks,
  type TocEntry,
  type VerifiedNames,
} from './docfx-esri-toc.js';
import { selectPythonMember, withPythonMembers } from './python-members.js';
import { readSitemap, sitemapRecords } from './sitemap.js';
import {
  assertLive,
  budgetOf,
  probeSource,
  readHtmlPage,
  recordOf,
  tolerate,
} from '../kit/index.js';

type DocfxSource = BoundSource<'docfx-esri'>;

/** Nine table-of-contents requests (a root file and eight books) and two for the sitemap. */
const MAX_ENUMERATE_REQUESTS = 12;
const MAX_TOC_FILES = 8;
const SITEMAP_REQUESTS = 2;
/** The tool reference's table of contents is close to 3 MB; page-sized limits would cut it off. */
const TOC_MAX_BYTES = 32 * 1024 * 1024;

/** One table-of-contents file to read, with the breadcrumb levels above its entries. */
interface TocFile {
  url: string;
  lead: string[];
}

function unreadable(url: string, why: string): McpDocError {
  return new McpDocError('UPSTREAM_UNAVAILABLE', `${url} is not a readable table of contents`, {
    why,
    url,
    host: new URL(url).host,
    retryable: false,
  });
}

/** Kind of a page that is not a symbol: the source's first kind other than `api`. */
function pageKind(src: DocfxSource): DocKind {
  return src.source.kinds.find((kind) => kind !== 'api') ?? src.source.kinds[0] ?? 'help';
}

async function fetchToc(ctx: Ctx, src: DocfxSource, url: string): Promise<unknown> {
  const { data } = await ctx.http.getJson({
    url,
    ttl: 'index',
    maxBytes: TOC_MAX_BYTES,
    ...budgetOf(src),
  });
  return data;
}

/**
 * The table-of-contents files of a source: the configured one, else one per scope or
 * section, else the books the product's root file points to (one more request).
 */
async function tocFiles(ctx: Ctx, src: DocfxSource): Promise<TocFile[]> {
  const { toc, scope, sections = [] } = src.source.config;
  if (toc !== undefined) return [{ url: src.url(toc), lead: [] }];
  if (scope !== undefined) return [{ url: src.url(`${scope}toc.json`), lead: [] }];
  if (sections.length > 0) {
    return sections.map((section) => ({
      url: src.url(`${section.replace(/\/+$/, '')}/toc.json`),
      lead: [humanizeSlug(section)],
    }));
  }
  const rootUrl = src.url('toc.json');
  const books = tocBooks(await fetchToc(ctx, src, rootUrl));
  if (books.length === 0) throw unreadable(rootUrl, 'It names no book with a table of contents');
  return books.map((book) => ({ url: new URL(book.toc, rootUrl).href, lead: [book.title] }));
}

/**
 * Cache key of the names tool pages reported for themselves (namespace `symbols`). The
 * version is part of the key so that verdicts of an earlier reading rule are left behind:
 * `v2` no longer takes a page with an unqualified syntax line for a topic, which `v1`
 * stored as "no Python call" and thereby dropped the tool from the next catalogue.
 */
function verifiedKey(src: DocfxSource): string {
  const { slug, scope = '' } = src.source.config;
  return `docfx-esri/tool-names/v2/${slug}/${scope}${src.line.id}`;
}

async function loadVerified(ctx: Ctx, src: DocfxSource): Promise<VerifiedNames> {
  // Only tool pages state their own name; every other source has nothing stored.
  if (src.source.config.gpParameters !== true) return { aliases: {}, names: {} };
  const stored = await ctx.cache.getDerived<Partial<VerifiedNames>>('symbols', verifiedKey(src));
  return { aliases: { ...stored?.aliases }, names: { ...stored?.names } };
}

/** The symbol fields of one entry, when the source derives symbols from its table of contents. */
function symbolOf(src: DocfxSource, entry: TocEntry, path: string, verified: VerifiedNames) {
  if (src.source.config.symbols !== 'toc') return undefined;
  return src.source.config.gpParameters === true
    ? gpToolSymbol(entry, path, verified)
    : arcpySymbol(entry, path);
}

/** Catalogue records of one table of contents: every entry with a page under the source's bases. */
function tocRecords(
  src: DocfxSource,
  file: TocFile,
  entries: readonly TocEntry[],
  bases: readonly string[],
  verified: VerifiedNames,
): CatalogRecord[] {
  const records: CatalogRecord[] = [];
  for (const entry of entries) {
    if (entry.href === undefined || !URL.canParse(entry.href, file.url)) continue;
    const url = new URL(entry.href, file.url);
    url.hash = '';
    const ref = url.href;
    const base = bases.find((candidate) => ref.startsWith(candidate));
    if (base === undefined || ref === base) continue;

    const symbol = symbolOf(src, entry, ref.slice(base.length), verified);
    const trail = [...file.lead, ...entry.ancestors];
    records.push({
      ...recordOf(src, ref, symbol === undefined ? pageKind(src) : 'api', entry.title),
      ...(trail.length === 0 ? {} : { breadcrumb: trail.join(BREADCRUMB_SEPARATOR) }),
      ...(symbol === undefined ? {} : { ...symbol, language: 'python' }),
    });
  }
  return records;
}

async function readToc(
  ctx: Ctx,
  src: DocfxSource,
  file: TocFile,
  bases: readonly string[],
  verified: VerifiedNames,
): Promise<CatalogRecord[]> {
  const entries = parseToc(await fetchToc(ctx, src, file.url));
  if (entries === undefined) throw unreadable(file.url, 'It has no "items" list');
  const records = tocRecords(src, file, entries, bases, verified);
  if (records.length === 0) throw unreadable(file.url, 'It lists no page of this source');
  return records;
}

/** Sitemap entries carry the release number where every other URL of the site says `latest`. */
function toLatest(loc: string, src: DocfxSource): string {
  const numbered = new RegExp(`^https?://doc\\.esri\\.com/en/${src.source.config.slug}/[^/]+/`);
  return loc.replace(numbered, src.url());
}

/** True when a page has the parameter or syntax section every tool page has and no topic does. */
function documentsParameters(page: DocPage): boolean {
  return page.sections.some((section) => /^(?:parameters|syntax)(?:-\d+)?$/.test(section.id));
}

/**
 * Remembers what a tool page says its Python call is, so that the next enumeration lists the
 * tool under that name (design risk R5), and tells the reader when the catalogue had it wrong.
 */
async function verifyToolName(
  ctx: Ctx,
  src: DocfxSource,
  target: ReadTarget,
  page: DocPage,
): Promise<DocPage> {
  const base = sourceBaseUrls(src.source, src.line).find((candidate) =>
    page.url.startsWith(candidate),
  );
  const path = base === undefined ? '' : page.url.slice(base.length);
  const dir = /^([^/]+)\/[^/]+$/.exec(path)?.[1];
  if (dir === undefined) return page;

  const signature = pythonSignature(
    [page.header ?? '', ...page.sections.map((section) => section.markdown)].join('\n'),
  );
  const listed = target.record?.symbolKind === 'tool' ? target.record.qualified : undefined;
  // A sliced page may simply not include the syntax line, so only a whole page can say "no call".
  if (signature === undefined && (listed === undefined || target.select !== undefined)) return page;
  // "No call" is the verdict that takes a page out of the symbol index, so it needs more
  // than a syntax line this reader does not understand: a page with parameters is a tool.
  if (signature === undefined && documentsParameters(page)) return page;

  const verified = await loadVerified(ctx, src);
  const qualified =
    signature === undefined
      ? null
      : `arcpy.${signature.alias ?? gpToolboxAlias(dir, verified)}.${signature.name}`;
  const aliasChanged = signature?.alias !== undefined && verified.aliases[dir] !== signature.alias;
  if (verified.names[path] !== qualified || aliasChanged) {
    verified.names[path] = qualified;
    if (signature?.alias !== undefined) verified.aliases[dir] = signature.alias;
    await ctx.cache.putDerived('symbols', verifiedKey(src), verified);
  }
  if (listed === undefined || listed === qualified) return page;
  const notice =
    qualified === null
      ? `The catalogue listed this page as ${listed}, but it documents no Python call.`
      : `The catalogue listed this tool as ${listed}; the page documents ${qualified}.`;
  return { ...page, notices: [...page.notices, notice] };
}

/**
 * `docfx-esri`: one product, or one part of a product (`scope`, `sections`), on doc.esri.com.
 *
 * With `symbols: 'toc'` the table-of-contents entries of the Python references become symbol
 * records: geoprocessing tools when `gpParameters` is set, ArcPy classes and functions
 * otherwise. Symbols are pages of their own, never members, so they carry no `parent`; the
 * properties and methods of a class are found on its page when it is read
 * (`python-members.ts`).
 */
export const docfxEsriAdapter: SourceAdapter<'docfx-esri'> = {
  type: 'docfx-esri',
  maxEnumerateRequests: MAX_ENUMERATE_REQUESTS,

  async enumerate(ctx, src) {
    const root = src.url();
    assertLive(src, root);
    const bases = sourceBaseUrls(src.source, src.line);
    const records = new Map<string, CatalogRecord>();
    let firstFailure: McpDocError | undefined;
    const add = (found: readonly CatalogRecord[]): void => {
      for (const record of found) if (!records.has(record.ref)) records.set(record.ref, record);
    };
    const without = (error: unknown, what: string): void => {
      firstFailure ??= toMcpDocError(error);
      tolerate(ctx, src, error, what);
    };

    if (ctx.policy.enabled('site-index')) {
      const verified = await loadVerified(ctx, src);
      let files: TocFile[] = [];
      try {
        files = await tocFiles(ctx, src);
      } catch (error) {
        without(error, 'The root table of contents');
      }
      for (const file of files.slice(0, MAX_TOC_FILES)) {
        try {
          add(await readToc(ctx, src, file, bases, verified));
        } catch (error) {
          without(error, `Table of contents ${file.url}`);
        }
      }
    }

    try {
      const locs = await readSitemap(ctx, src, `${root}sitemap.xml`, SITEMAP_REQUESTS);
      add(
        sitemapRecords(
          src,
          locs.map((loc) => toLatest(loc, src)),
          bases,
          {},
          pageKind(src),
        ),
      );
    } catch (error) {
      without(error, `Sitemap ${root}sitemap.xml`);
    }

    if (records.size > 0) return [...records.values()];
    if (firstFailure !== undefined) throw firstFailure;
    throw new McpDocError(
      'UPSTREAM_UNAVAILABLE',
      `No page of ${src.source.title} could be listed`,
      {
        why: 'Neither a table of contents nor the sitemap lists a page under the source',
        url: root,
        host: new URL(root).host,
        retryable: false,
      },
    );
  },

  async read(ctx, src, target) {
    const kind = target.record?.kind ?? src.source.kinds[0] ?? 'help';
    const page = await readHtmlPage(ctx, src, target, { kind });
    const { symbols, gpParameters } = src.source.config;
    // A class of the Python reference: its properties and methods are its members.
    if (symbols === 'toc' && gpParameters !== true) {
      return selectPythonMember(withPythonMembers(page), target.select);
    }
    if (gpParameters !== true) return page;
    try {
      return await verifyToolName(ctx, src, target, page);
    } catch (error) {
      // The check is a by-product of reading; a cache that cannot be written must not lose the page.
      ctx.logger.warn('The Python name of a tool page could not be recorded', {
        url: page.url,
        error: toMcpDocError(error).details?.why,
      });
      return page;
    }
  },

  probe(ctx, src): Promise<ProbeResult> {
    const probe = src.source.probe;
    if (probe.expect !== 'json') return probeSource(ctx, src);
    if (!ctx.policy.enabled('site-index')) {
      // The canary is an index file that may not be requested; the sitemap is the rung below.
      const sitemap = { url: src.url('sitemap.xml'), expect: 'xml' as const, minRecords: 1 };
      return probeSource(ctx, { ...src, source: { ...src.source, probe: sitemap } });
    }
    return probeSource(ctx, src, {
      siteIndex: true,
      count: (body) => {
        try {
          // A document of another shape lists no page, whatever else it holds.
          const entries = parseToc(JSON.parse(body)) ?? [];
          return entries.filter((entry) => entry.href !== undefined).length;
        } catch {
          return undefined;
        }
      },
    });
  },
};
