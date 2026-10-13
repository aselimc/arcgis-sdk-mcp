/**
 * The `github-repo` adapter: documentation, samples, snippets, notebooks and wikis kept in
 * GitHub repositories, read through the injected `GithubClient` (file listings and metadata
 * from the API, content from the raw host).
 *
 * The public ref of everything it returns is a github.com URL:
 * `https://github.com/<owner>/<repo>/blob/<ref>/<path>` for a file,
 * `.../tree/<ref>/<dir>` for a directory and `.../wiki/<Page>` for a wiki page. What a
 * repository's catalogue contains is decided by the source's preset (`presets.ts`), and the
 * ref it is read at by `pin.ts`.
 */
import { matchesAnyGlob } from '../../../core/glob.js';
import { toMcpDocError } from '../../../core/errors.js';
import type { Ctx, ProbeResult, ReadTarget, SourceAdapter } from '../../../core/ports.js';
import type { CatalogRecord, DocPage } from '../../../core/types.js';
import { parseGithubUrl } from '../../../core/url.js';
import { MAX_HEADING_FILES, documentRecords, readDirectory, readFile } from './files.js';
import { atRef, openRepo, openScope, openScopeAt } from './pin.js';
import { isMarkdown, readsSamples } from './presets.js';
import { readSample, sampleOfFile, sampleOfRecord, sampleRecords } from './samples-metadata.js';
import { MAX_SCANNED_FILES, snippetRecords } from './snippets-region.js';
import { callOptions, notFound, type GithubSource } from './shared.js';
import { readWiki, wikiRecords } from './wiki.js';

/** Repository metadata, the latest release, and the tree at the tag and then at the branch. */
const LISTING_REQUESTS = 4;

/** What a URL of the repository points at. */
type Location =
  | { type: 'wiki'; page: string }
  | { type: 'directory'; ref?: string; path: string }
  | { type: 'file'; ref: string; path: string };

/**
 * Interprets a URL as a location in the source's repository; `undefined` when it is not
 * one. On github.com a path is a directory unless it is addressed as `blob` or `raw`; on
 * the raw host it is always a file.
 */
function locate(url: URL, src: GithubSource): Location | undefined {
  const bare = url.href.replace(/#.*$/, '');
  const parsed = parseGithubUrl(bare);
  if (parsed?.repo.toLowerCase() !== src.source.config.repo.toLowerCase()) return undefined;
  if (parsed.wikiPage !== undefined) return { type: 'wiki', page: parsed.wikiPage };
  if (parsed.ref === undefined) return { type: 'directory', path: '' };
  const listed = url.hostname === 'github.com' && url.pathname.split('/')[3] === 'tree';
  if (listed || parsed.path === undefined) {
    return { type: 'directory', ref: parsed.ref, path: (parsed.path ?? '').replace(/\/+$/, '') };
  }
  return { type: 'file', ref: parsed.ref, path: parsed.path };
}

async function enumerate(ctx: Ctx, src: GithubSource): Promise<CatalogRecord[]> {
  const preset = src.source.config.preset;
  if (preset === 'wiki') return wikiRecords(ctx, src, await openRepo(ctx, src));

  const scope = await openScope(ctx, src);
  // One API call lists every file; a tag that does not exist falls back to the branch here,
  // so the records carry the ref they can actually be read at.
  const tree = await atRef(ctx, src, scope, (ref) =>
    ctx.github.tree(scope.repo, ref, callOptions(src)),
  );
  switch (preset) {
    case 'samples-metadata':
    case 'samples-readme':
      return sampleRecords(src, scope, tree);
    case 'snippets-region':
      return snippetRecords(ctx, src, scope, tree);
    case 'markdown-docs':
    case 'notebooks':
      return documentRecords(ctx, src, scope, tree);
  }
}

async function read(ctx: Ctx, src: GithubSource, target: ReadTarget): Promise<DocPage> {
  const location = locate(target.url, src);
  if (location === undefined) {
    throw notFound(
      target.url.href,
      `${target.url.href} is not a document of ${src.source.config.repo}`,
      'This source reads files, directories and wiki pages of that repository only',
    );
  }
  if (location.type === 'wiki') {
    return readWiki(ctx, src, await openRepo(ctx, src), location.page, target);
  }
  const scope =
    location.ref === undefined
      ? await openScope(ctx, src)
      : await openScopeAt(ctx, src, location.ref);
  if (location.type === 'directory') return readDirectory(ctx, src, scope, location.path, target);

  if (readsSamples(src.source.config, src.source.kinds)) {
    // The README or metadata file of a sample stands for the whole sample. The record that
    // led here knows the exact file names; a bare URL has to assume the sibling's name.
    const known = sampleOfRecord(target.record);
    const fromRecord = known?.readme === location.path || known?.metadata === location.path;
    const sample = fromRecord ? known : sampleOfFile(location.path, src.source.config);
    // The repository's own README describes the repository, not a sample.
    if (sample !== undefined && sample.dir !== '') {
      return readSample(ctx, src, scope, sample, target);
    }
  }
  return readFile(ctx, src, scope, location.path, target);
}

/** The section a record's ref points at, as a selector for its page. */
function sectionOf(record: CatalogRecord): Pick<ReadTarget, 'select'> {
  let fragment = new URL(record.ref).hash.slice(1);
  try {
    fragment = decodeURIComponent(fragment);
  } catch {
    // A malformed escape is used as written; an unknown section returns the whole page.
  }
  return fragment === '' ? {} : { select: { section: fragment } };
}

/** Runs an adapter operation so that only `McpDocError` leaves it. */
async function typed<V>(operation: () => Promise<V>): Promise<V> {
  try {
    return await operation();
  } catch (error) {
    throw toMcpDocError(error);
  }
}

/**
 * The adapter of `github-repo` sources.
 *
 * - `enumerate`: the repository tree (one API call) turned into records by the preset; the
 *   wiki preset reads the sidebar instead. `snippets-region` and `symbolsFromHeadings`
 *   also fetch file bodies, bounded by `maxEnumerateRequests` and the source's budget.
 * - `read`: any file, directory or wiki URL of the repository. Reads of a file need the raw
 *   host only, so they keep working when the API quota is spent; listings then fail with
 *   `RATE_LIMITED_GITHUB`.
 * - `owns`: every URL of the repository except excluded paths and, for a wiki source, files
 *   that are not Markdown, so that a second source on the same repository can claim them.
 * - `symbol` and `sample`: the record's page, sliced to the section its ref names.
 * - `probe`: the repository metadata; for a wiki also its home page.
 */
export const githubRepoAdapter: SourceAdapter<'github-repo'> = {
  type: 'github-repo',
  maxEnumerateRequests: LISTING_REQUESTS + Math.max(MAX_SCANNED_FILES, MAX_HEADING_FILES),

  enumerate: (ctx, src) =>
    typed(async () => {
      const unique = new Map<string, CatalogRecord>();
      for (const record of await enumerate(ctx, src)) {
        if (!unique.has(record.ref)) unique.set(record.ref, record);
      }
      return [...unique.values()];
    }),

  owns(url, src) {
    const location = locate(url, src);
    if (location === undefined) return false;
    if (location.type !== 'file') return true;
    const config = src.source.config;
    if (matchesAnyGlob(location.path, config.exclude ?? [])) return false;
    return config.preset !== 'wiki' || isMarkdown(location.path);
  },

  read: (ctx, src, target) => typed(() => read(ctx, src, target)),

  symbol: (ctx, src, record, detail) =>
    typed(() => read(ctx, src, { url: new URL(record.ref), record, detail, ...sectionOf(record) })),

  sample: (ctx, src, record) =>
    typed(() => read(ctx, src, { url: new URL(record.ref), record, ...sectionOf(record) })),

  async probe(ctx, src): Promise<ProbeResult> {
    const started = ctx.clock.now();
    const finish = (result: Omit<ProbeResult, 'ms'>): ProbeResult => ({
      ...result,
      ms: ctx.clock.now() - started,
    });
    const { repo, preset } = src.source.config;
    try {
      await ctx.github.repoMeta(repo, callOptions(src));
      if (preset !== 'wiki') return finish({ ok: true });
      const home = await ctx.github.wikiRaw(repo, 'Home', callOptions(src));
      const chars = home.text.length;
      const minChars = src.source.probe.minChars ?? 1;
      return chars >= minChars
        ? finish({ ok: true, chars })
        : finish({
            ok: false,
            chars,
            error: `Expected at least ${minChars} characters, found ${chars}`,
          });
    } catch (thrown) {
      const error = toMcpDocError(thrown);
      const why = error.details?.why;
      return finish({
        ok: false,
        error: `${error.code}: ${error.message}${why === undefined ? '' : ` (${why})`}`,
      });
    }
  },
};
