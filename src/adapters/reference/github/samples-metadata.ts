/**
 * The two sample presets. `samples-metadata` is the layout of the ArcGIS Maps SDK sample
 * repositories (Swift, Kotlin, .NET, Qt, Flutter, Java, Unity, Unreal Engine): one directory
 * per sample holding a README, a `README.metadata.json` (title, category, keywords,
 * `relevant_apis`, and `snippets` naming the main source files) and the code.
 * `samples-readme` is the layout of repositories without metadata files, such as the ArcGIS
 * Pro SDK community samples: one directory per sample with a README next to the project.
 *
 * Enumeration reads the repository tree only. A sample's README, metadata and source files
 * are fetched when that sample is read.
 */
import { isMcpDocError } from '../../../core/errors.js';
import type { Ctx, HttpResponse, ReadTarget } from '../../../core/ports.js';
import type { CatalogRecord, DocPage } from '../../../core/types.js';
import { atRef } from './pin.js';
import {
  filesInScope,
  isCode,
  isReadme,
  isSampleMetadata,
  platformOf,
  type GithubConfig,
  type TreeFile,
} from './presets.js';
import {
  baseOf,
  blobUrl,
  breadcrumbOf,
  callOptions,
  dirOf,
  mapPool,
  metaOf,
  recordOf,
  renderOptionsOf,
  requestsLeft,
  titleFromName,
  tolerate,
  treeUrl,
  withNotices,
  type GithubSource,
  type RepoScope,
} from './shared.js';

/** Source files fetched for one sample; the rest is linked. A read stays within one call's budget. */
const MAX_SAMPLE_FILES = 6;
/** Larger files are data or generated code, not what a sample demonstrates. */
const MAX_FILE_BYTES = 150_000;
const PARALLEL_FETCHES = 3;
/** Generated and boilerplate files of a project that say nothing about the sample. */
const BOILERPLATE = /(?:\.g\.cs|\.designer\.cs|assemblyinfo\.cs|\.g\.dart|\.freezed\.dart)$/i;

/** One sample of a repository: its directory and the files that describe it. */
export interface SampleDir {
  /** Directory of the sample, without a trailing slash. */
  dir: string;
  /** Path of its README, in the letter case the repository uses. */
  readme?: string;
  /** Path of its `README.metadata.json`. */
  metadata?: string;
}

/**
 * The sample directories of a tree.
 *
 * - `samples-metadata`: every directory with a metadata file, plus README-only directories
 *   next to one (the game-engine repositories give only a few samples a metadata file).
 * - `samples-readme`: every innermost directory below the root that has a README and code.
 */
export function sampleDirs(tree: readonly TreeFile[], config: GithubConfig): SampleDir[] {
  const readmes = new Map<string, string>();
  const metadata = new Map<string, string>();
  for (const file of filesInScope(tree, config)) {
    if (isReadme(file.path)) readmes.set(dirOf(file.path), file.path);
    else if (isSampleMetadata(file.path)) metadata.set(dirOf(file.path), file.path);
  }

  const chosen = new Set<string>();
  if (config.preset === 'samples-metadata') {
    for (const dir of metadata.keys()) chosen.add(dir);
    const parents = new Set([...metadata.keys()].map(dirOf));
    for (const dir of leaves(readmes)) {
      if (dir !== '' && parents.has(dirOf(dir))) chosen.add(dir);
    }
  } else {
    const withCode = new Set<string>();
    for (const file of tree) {
      if (!isCode(file.path)) continue;
      for (let dir = dirOf(file.path); dir !== ''; dir = dirOf(dir)) withCode.add(dir);
    }
    for (const dir of leaves(readmes)) {
      if (dir !== '' && withCode.has(dir)) chosen.add(dir);
    }
  }

  return [...chosen].sort().map((dir) => {
    const readme = readmes.get(dir);
    const meta = metadata.get(dir);
    return {
      dir,
      ...(readme === undefined ? {} : { readme }),
      ...(meta === undefined ? {} : { metadata: meta }),
    };
  });
}

/** The directories of a map that have no other directory of the map beneath them. */
function leaves(byDir: ReadonlyMap<string, string>): string[] {
  const inner = new Set<string>();
  for (const dir of byDir.keys()) {
    for (let parent = dirOf(dir); parent !== ''; parent = dirOf(parent)) inner.add(parent);
    if (dir !== '') inner.add('');
  }
  return [...byDir.keys()].filter((dir) => !inner.has(dir));
}

/**
 * The category directories of a sample: what lies between the samples root and the sample
 * (`CppSamples/Analysis/X` gives `Analysis`, `Shared/Samples/X` gives nothing). The samples
 * root is the last directory whose name ends in `samples`; a repository without one
 * (`<category>/<sample>/`) contributes every ancestor.
 */
function categoryTrail(dir: string): string[] {
  const ancestors = dir.split('/').slice(0, -1);
  const root = ancestors.findLastIndex((segment) => /samples$/i.test(segment));
  return ancestors.slice(root + 1);
}

/** The catalogue records of the samples in a tree. */
export function sampleRecords(
  src: GithubSource,
  scope: RepoScope,
  tree: readonly TreeFile[],
): CatalogRecord[] {
  const language = src.product.languages[0];
  return sampleDirs(tree, src.source.config).map((sample) => {
    const name = baseOf(sample.dir);
    const title = titleFromName(name);
    const breadcrumb = breadcrumbOf(categoryTrail(sample.dir));
    const platform = platformOf(sample.dir);
    return {
      ...recordOf(
        src,
        scope,
        blobUrl(scope.repo, scope.ref, sample.readme ?? sample.metadata ?? sample.dir),
        'sample',
        title,
      ),
      ...(breadcrumb === undefined ? {} : { breadcrumb }),
      // The directory name is how the sample is referred to in code and in the viewer apps.
      ...(name === title ? {} : { keywords: [name] }),
      ...(platform === undefined ? {} : { platform }),
      ...(language === undefined ? {} : { language }),
      locator: {
        path: sample.dir,
        ...(sample.readme === undefined ? {} : { readme: sample.readme }),
        ...(sample.metadata === undefined ? {} : { metadata: sample.metadata }),
      },
    };
  });
}

/**
 * The sample a file URL stands for: the README or metadata file of a sample directory.
 * The sibling file is assumed to follow the letter case of the given one (`readme.md` with
 * `readme.metadata.json`); when it does not exist the sample is read without it.
 */
export function sampleOfFile(path: string, config: GithubConfig): SampleDir | undefined {
  const dir = dirOf(path);
  const prefix = dir === '' ? '' : `${dir}/`;
  const lower = baseOf(path) === baseOf(path).toLowerCase();
  if (isReadme(path)) {
    if (config.preset !== 'samples-metadata') return { dir, readme: path };
    return {
      dir,
      readme: path,
      metadata: `${prefix}${lower ? 'readme' : 'README'}.metadata.json`,
    };
  }
  if (!isSampleMetadata(path)) return undefined;
  return { dir, metadata: path, readme: `${prefix}${lower ? 'readme' : 'README'}.md` };
}

/** The sample a catalogue record stands for, from its locator. */
export function sampleOfRecord(record: CatalogRecord | undefined): SampleDir | undefined {
  const locator = record?.locator;
  if (locator?.path === undefined) return undefined;
  if (locator.readme === undefined && locator.metadata === undefined) return undefined;
  return {
    dir: locator.path,
    ...(locator.readme === undefined ? {} : { readme: locator.readme }),
    ...(locator.metadata === undefined ? {} : { metadata: locator.metadata }),
  };
}

/** The sample in a directory of a tree; `undefined` when it holds neither README nor metadata. */
export function sampleOfDir(tree: readonly TreeFile[], dir: string): SampleDir | undefined {
  const inside = tree.filter((file) => dirOf(file.path) === dir);
  const readme = inside.find((file) => isReadme(file.path))?.path;
  const metadata = inside.find((file) => isSampleMetadata(file.path))?.path;
  if (readme === undefined && metadata === undefined) return undefined;
  return {
    dir,
    ...(readme === undefined ? {} : { readme }),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

/** Parses a metadata file; anything but a JSON object is treated as absent. */
function parseMetadata(text: string): Record<string, unknown> | undefined {
  try {
    const data: unknown = JSON.parse(text);
    return typeof data === 'object' && data !== null && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** The file names a metadata file lists as the sample's main sources. */
function snippetNames(metadata: Record<string, unknown> | undefined): string[] {
  const snippets = metadata?.snippets;
  if (!Array.isArray(snippets)) return [];
  return snippets.filter((name): name is string => typeof name === 'string' && name !== '');
}

/**
 * The main source files of a sample directory when no metadata names them: code files of a
 * sensible size, nearest to the sample root first, files named after the sample before
 * the others.
 */
export function mainFiles(tree: readonly TreeFile[], dir: string): string[] {
  const prefix = dir === '' ? '' : `${dir}/`;
  const key = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, '');
  const name = key(baseOf(dir));
  const depth = (path: string): number => path.split('/').length;
  const named = (path: string): number =>
    name !== '' && key(baseOf(path).replace(/\.[^.]+$/, '')).includes(name) ? 0 : 1;
  return tree
    .filter(
      (file) =>
        file.path.startsWith(prefix) &&
        isCode(file.path) &&
        !BOILERPLATE.test(file.path) &&
        !/(?:^|\/)(?:bin|obj|build|Properties|node_modules)\//.test(file.path.slice(prefix.length)) &&
        (file.size ?? 0) <= MAX_FILE_BYTES,
    )
    .map((file) => file.path)
    .sort(
      (a, b) => depth(a) - depth(b) || named(a) - named(b) || (a < b ? -1 : a > b ? 1 : 0),
    );
}

/**
 * Reads one sample: README, metadata and source files, rendered as a `source` page (the
 * README is the description; the code goes to `DocPage.files`).
 *
 * Only the first file decides whether the sample exists and at which ref it is read (a
 * missing release tag falls back to the branch there). Metadata, the file listing and the
 * individual source files are optional: without them the page is the README alone with a
 * notice, never a failure.
 *
 * @throws McpDocError `DOC_NOT_FOUND` when the sample has neither README nor metadata at
 *   the ref; whatever the GitHub client reports for the first file otherwise.
 */
export async function readSample(
  ctx: Ctx,
  src: GithubSource,
  scope: RepoScope,
  sample: SampleDir,
  target: ReadTarget,
): Promise<DocPage> {
  const { repo } = scope;
  const optional = async (path: string | undefined): Promise<HttpResponse | undefined> => {
    if (path === undefined) return undefined;
    try {
      return await ctx.github.raw(repo, scope.ref, path, callOptions(src, scope));
    } catch (error) {
      tolerate(ctx, src, error, path);
      return undefined;
    }
  };

  let primaryPath = sample.readme ?? sample.metadata ?? '';
  let primary: HttpResponse;
  try {
    primary = await atRef(ctx, src, scope, (ref, opts) =>
      ctx.github.raw(repo, ref, primaryPath, opts),
    );
  } catch (error) {
    // A sample without a README is still a sample when its metadata file exists.
    const other = primaryPath === sample.readme ? sample.metadata : undefined;
    if (other === undefined || !isMcpDocError(error) || error.code !== 'DOC_NOT_FOUND') throw error;
    primaryPath = other;
    primary = await atRef(ctx, src, scope, (ref, opts) => ctx.github.raw(repo, ref, other, opts));
  }
  const readme = primaryPath === sample.readme ? primary : undefined;
  const metadataRes =
    primaryPath === sample.metadata ? primary : await optional(sample.metadata);
  const metadata = metadataRes === undefined ? undefined : parseMetadata(metadataRes.text);

  const notices: string[] = [];
  const prefix = sample.dir === '' ? '' : `${sample.dir}/`;
  let paths = snippetNames(metadata).map((name) => `${prefix}${name}`);
  if (paths.length === 0 && requestsLeft(src) > 1) {
    try {
      const tree = await ctx.github.tree(repo, scope.ref, callOptions(src));
      paths = mainFiles(tree, sample.dir);
    } catch (error) {
      tolerate(ctx, src, error, `the file list of ${repo}`);
      notices.push(
        `The source files could not be listed; browse them at ${treeUrl(repo, scope.ref, sample.dir)}.`,
      );
    }
  }
  const wanted = paths.slice(0, Math.min(MAX_SAMPLE_FILES, requestsLeft(src)));
  const fetched = await mapPool(wanted, PARALLEL_FETCHES, optional);
  const files = wanted.flatMap((path, index) => {
    const res = fetched[index];
    return res === undefined
      ? []
      : [{ name: path.slice(prefix.length), text: res.text, ref: blobUrl(repo, scope.ref, path) }];
  });
  if (files.length < paths.length) {
    notices.push(
      `${paths.length - files.length} more source file(s) are at ${treeUrl(repo, scope.ref, sample.dir)}.`,
    );
  }

  const page = ctx.render.render(
    'source',
    {
      files,
      ...(readme === undefined ? {} : { readme: readme.text }),
      ...(metadata === undefined ? {} : { metadata }),
    },
    metaOf(
      src,
      scope,
      `${blobUrl(repo, scope.ref, primaryPath)}${target.url.hash}`,
      'sample',
      primary,
    ),
    renderOptionsOf(target, scope),
  );
  return withNotices(page, scope, notices);
}
