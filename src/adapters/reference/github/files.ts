/**
 * Plain repository content: the catalogue of the `markdown-docs` and `notebooks` presets
 * (one record per document file) and the reading of a single file or directory, which every
 * preset falls back to for a URL that is not one of its own documents.
 */
import { McpDocError } from '../../../core/errors.js';
import { BREADCRUMB_SEPARATOR } from '../../../core/names.js';
import type { Ctx, ReadTarget } from '../../../core/ports.js';
import { sectionsFromMarkdown } from '../../../core/sections.js';
import type { CatalogRecord, DocKind, DocPage } from '../../../core/types.js';
import { atRef } from './pin.js';
import {
  filesInScope,
  isBinary,
  isCode,
  isMarkdown,
  isNotebook,
  isReadme,
  kindOfFile,
  presetKind,
  readsSamples,
  type TreeFile,
} from './presets.js';
import { readSample, sampleOfDir } from './samples-metadata.js';
import { renderSnippets } from './snippets-region.js';
import {
  baseOf,
  blobUrl,
  breadcrumbOf,
  callOptions,
  dirOf,
  extensionOf,
  mapPool,
  metaOf,
  notFound,
  repoRecord,
  repoRenderOptions,
  requestsLeft,
  titleFromName,
  treeUrl,
  withNotices,
  type GithubSource,
  type RepoScope,
} from './shared.js';
import { skipOptional } from '../../kit/index.js';

/** Markdown files fetched by one enumeration to index their headings (`symbolsFromHeadings`). */
export const MAX_HEADING_FILES = 60;
const PARALLEL_FETCHES = 4;
/** A heading that names a type or member rather than a chapter. */
const IDENTIFIER = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;

/** True for the files the document presets list: Markdown, notebooks and `.proto` schemas. */
function isDocument(path: string): boolean {
  return isMarkdown(path) || isNotebook(path) || extensionOf(path) === 'proto';
}

/** Title and breadcrumb of a document file. A README stands for its directory. */
function describe(scope: RepoScope, path: string): { title: string; trail: string[] } {
  const dir = dirOf(path);
  const ancestors = dir === '' ? [] : dir.split('/');
  if (isReadme(path)) {
    const name = ancestors.at(-1) ?? baseOf(scope.repo);
    return { title: titleFromName(name), trail: ancestors.slice(0, -1) };
  }
  // A schema is known by its file name, extension included.
  const title = extensionOf(path) === 'proto' ? baseOf(path) : titleFromName(baseOf(path));
  return { title, trail: ancestors };
}

function documentRecord(src: GithubSource, scope: RepoScope, path: string): CatalogRecord {
  const fallback = presetKind(src.source.config.preset, src.source.kinds);
  const kind = isMarkdown(path) ? kindOfFile(path, fallback) : fallback;
  const { title, trail } = describe(scope, path);
  const breadcrumb = breadcrumbOf(trail);
  return {
    ...repoRecord(src, scope, blobUrl(scope.repo, scope.ref, path), kind, title),
    ...(breadcrumb === undefined ? {} : { breadcrumb }),
    locator: { path },
  };
}

/** One symbol record per heading of the given level whose text is an identifier. */
function headingRecords(
  src: GithubSource,
  scope: RepoScope,
  path: string,
  markdown: string,
  level: number,
): CatalogRecord[] {
  const file = documentRecord(src, scope, path);
  const kind: DocKind = src.source.kinds.includes('api') ? 'api' : file.kind;
  return sectionsFromMarkdown(markdown)
    .filter((section) => section.level === level && IDENTIFIER.test(section.title))
    .map((section) => ({
      ...repoRecord(src, scope, `${file.ref}#${section.id}`, kind, section.title),
      symbol: section.title.split('.').at(-1) ?? section.title,
      qualified: section.title,
      symbolKind: 'type',
      breadcrumb: [file.breadcrumb, file.title]
        .filter((part) => part !== undefined)
        .join(BREADCRUMB_SEPARATOR),
      locator: { path, section: section.id },
    }));
}

/**
 * The catalogue of the `markdown-docs` and `notebooks` presets: one record per document
 * file in scope, titled from its name. With `symbolsFromHeadings: n`, the Markdown files
 * are fetched (at most {@link MAX_HEADING_FILES}, within the request budget) and every
 * level-`n` heading that is an identifier becomes a symbol record pointing at its section.
 */
export async function documentRecords(
  ctx: Ctx,
  src: GithubSource,
  scope: RepoScope,
  tree: readonly TreeFile[],
): Promise<CatalogRecord[]> {
  const config = src.source.config;
  const files = filesInScope(tree, config).filter((file) =>
    config.preset === 'notebooks' ? isNotebook(file.path) : isDocument(file.path),
  );
  const records = files.map((file) => documentRecord(src, scope, file.path));

  const level = config.symbolsFromHeadings;
  if (level === undefined) return records;
  const scanned = files
    .filter((file) => isMarkdown(file.path))
    .slice(0, Math.min(MAX_HEADING_FILES, requestsLeft(src)));
  let spent = false;
  const symbols = await mapPool(scanned, PARALLEL_FETCHES, async (file) => {
    if (spent) return [];
    try {
      const res = await ctx.github.raw(scope.repo, scope.ref, file.path, callOptions(src, scope));
      return headingRecords(src, scope, file.path, res.text, level);
    } catch (error) {
      spent = skipOptional(ctx, src, error, file.path) || spent;
      return [];
    }
  });
  return [...records, ...symbols.flat()];
}

/**
 * Reads one file of the repository at the scope's ref and renders it by type: Markdown and
 * notebooks through their renderers, a source file of a `snippets-region` source as its
 * regions, any other text file as source code.
 *
 * @throws McpDocError `DOC_NOT_FOUND` for a binary file or an unknown path;
 *   `UPSTREAM_UNAVAILABLE` for a notebook that is not valid JSON.
 */
export async function readFile(
  ctx: Ctx,
  src: GithubSource,
  scope: RepoScope,
  path: string,
  target: ReadTarget,
): Promise<DocPage> {
  if (isBinary(path)) {
    throw notFound(
      blobUrl(scope.repo, scope.ref, path),
      `${baseOf(path)} is not a text document`,
      'Images, archives and other binary files are not returned',
    );
  }
  const res = await atRef(ctx, src, scope, (ref, opts) =>
    ctx.github.raw(scope.repo, ref, path, opts),
  );
  const publicUrl = blobUrl(scope.repo, scope.ref, path);
  const fallback = presetKind(src.source.config.preset, src.source.kinds);
  const kind = target.record?.kind ?? (isMarkdown(path) ? kindOfFile(path, fallback) : fallback);
  const meta = metaOf(src, scope, `${publicUrl}${target.url.hash}`, kind, res);
  const opts = repoRenderOptions(target, scope);

  if (isMarkdown(path)) {
    return withNotices(ctx.render.render('markdown', { markdown: res.text }, meta, opts), scope);
  }
  if (isNotebook(path)) {
    let ipynb: unknown;
    try {
      ipynb = JSON.parse(res.text);
    } catch {
      throw new McpDocError('UPSTREAM_UNAVAILABLE', `${baseOf(path)} is not a valid notebook`, {
        why: 'The file is not valid JSON',
        url: publicUrl,
        host: new URL(publicUrl).host,
        retryable: false,
      });
    }
    return withNotices(ctx.render.render('notebook', { ipynb }, meta, opts), scope);
  }
  if (src.source.config.preset === 'snippets-region' && isCode(path)) {
    const snippets = renderSnippets(ctx, src, scope, path, res, target);
    if (snippets !== undefined) return snippets;
  }
  const page = ctx.render.render(
    'source',
    { files: [{ name: baseOf(path), text: res.text, ref: publicUrl }] },
    meta,
    opts,
  );
  return withNotices(page, scope);
}

/** Entries of a directory listing; a larger directory says how many more there are. */
const MAX_LISTED_ENTRIES = 200;

/**
 * A directory as a page: its files and subdirectories, each with the URL that reads it. This
 * is what a directory without a README has to show, and it is written by this server (the
 * names are the repository's, the page is not a document of it).
 */
function directoryListing(
  ctx: Ctx,
  src: GithubSource,
  scope: RepoScope,
  dir: string,
  tree: readonly TreeFile[],
  target: ReadTarget,
): DocPage {
  const prefix = dir === '' ? '' : `${dir}/`;
  const directories = new Map<string, number>();
  const files: string[] = [];
  for (const file of tree) {
    if (!file.path.startsWith(prefix)) continue;
    const rest = file.path.slice(prefix.length);
    const cut = rest.indexOf('/');
    if (cut === -1) files.push(rest);
    else directories.set(rest.slice(0, cut), (directories.get(rest.slice(0, cut)) ?? 0) + 1);
  }
  const entries = [
    ...[...directories].map(
      ([name, count]) =>
        `- [${name}/](${treeUrl(scope.repo, scope.ref, `${prefix}${name}`)}) (${count} file${count === 1 ? '' : 's'})`,
    ),
    ...files.map((name) => `- [${name}](${blobUrl(scope.repo, scope.ref, `${prefix}${name}`)})`),
  ];
  const more = entries.length - MAX_LISTED_ENTRIES;
  const url = treeUrl(scope.repo, scope.ref, dir);
  const markdown = [
    `# ${dir === '' ? scope.repo : dir}`,
    `Directory of ${scope.repo} at ${scope.ref}. It has no README; read an entry by its URL.`,
    entries.slice(0, MAX_LISTED_ENTRIES).join('\n'),
    ...(more > 0 ? [`${more} more entries are not listed.`] : []),
  ].join('\n\n');
  const kind = presetKind(src.source.config.preset, src.source.kinds);
  const page = ctx.render.render(
    'markdown',
    { markdown },
    {
      url: `${url}${target.url.hash}`,
      product: src.product.id,
      source: src.source.id,
      line: src.line.id,
      kind,
      // A listing is this server's own text about the repository, not content of it.
      license: 'project',
      retrievedAt: ctx.clock.iso(),
    },
    repoRenderOptions(target, scope),
  );
  return withNotices(page, scope);
}

/**
 * Reads a directory of the repository (or its root): the sample it holds for a source of
 * samples, otherwise its README, and a listing of its entries when it has none.
 *
 * The file listing needs the GitHub API. When that is unavailable (a spent quota, an
 * outage) the conventional `README.md` is tried on the raw host, and the listing's error is
 * reported only if that is missing too.
 *
 * @throws McpDocError `DOC_NOT_FOUND` when the directory does not exist.
 */
export async function readDirectory(
  ctx: Ctx,
  src: GithubSource,
  scope: RepoScope,
  dir: string,
  target: ReadTarget,
): Promise<DocPage> {
  const prefix = dir === '' ? '' : `${dir}/`;
  let tree: TreeFile[];
  try {
    tree = await atRef(ctx, src, scope, (ref) =>
      ctx.github.tree(scope.repo, ref, callOptions(src)),
    );
  } catch (listingError) {
    try {
      return await readFile(ctx, src, scope, `${prefix}README.md`, target);
    } catch {
      throw listingError;
    }
  }

  const sample = sampleOfDir(tree, dir);
  // The repository's own README describes the repository, not a sample.
  if (sample !== undefined && dir !== '' && readsSamples(src.source.config, src.source.kinds)) {
    return readSample(ctx, src, scope, sample, target);
  }
  if (sample?.readme !== undefined) return readFile(ctx, src, scope, sample.readme, target);
  if (tree.some((file) => file.path.startsWith(prefix))) {
    return directoryListing(ctx, src, scope, dir, tree, target);
  }
  const url = treeUrl(scope.repo, scope.ref, dir);
  throw notFound(
    url,
    `${scope.repo} has no directory "${dir}"`,
    `It does not exist at ${scope.ref}`,
  );
}
