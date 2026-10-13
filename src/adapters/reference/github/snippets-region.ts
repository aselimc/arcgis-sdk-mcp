/**
 * The `snippets-region` preset: source files whose snippets are delimited by region
 * directives, as in the ArcGIS Pro SDK snippets repository.
 *
 * ```csharp
 * // cref: ArcGIS.Desktop.Catalog.OpenItemDialog
 * #region Show the dialog
 * var dialog = new OpenItemDialog();
 * #endregion
 * ```
 *
 * Each region becomes a titled code block of a Markdown page, so that one snippet can be
 * read by its heading instead of a file of several thousand lines. `// cref:` comment lines
 * directly above a region name the API it demonstrates; a region titled
 * `ProSnippet Group: <name>` starts a group of regions, and a region whose title starts
 * with `ignore` holds set-up code that is not a snippet.
 */
import { BREADCRUMB_SEPARATOR } from '../../../core/names.js';
import type { Ctx, HttpResponse, ReadTarget } from '../../../core/ports.js';
import { sectionsFromMarkdown } from '../../../core/sections.js';
import type { CatalogRecord, DocPage } from '../../../core/types.js';
import { filesInScope, type TreeFile } from './presets.js';
import {
  baseOf,
  blobUrl,
  breadcrumbOf,
  callOptions,
  dirOf,
  extensionOf,
  mapPool,
  metaOf,
  recordOf,
  renderOptionsOf,
  requestsLeft,
  titleFromName,
  tolerate,
  withNotices,
  type GithubSource,
  type RepoScope,
} from './shared.js';

/** Files whose regions are indexed by one enumeration; the others are listed by file only. */
export const MAX_SCANNED_FILES = 60;
const PARALLEL_FETCHES = 4;
const MAX_KEYWORDS = 16;

const OPEN = /^\s*(?:#pragma\s+region|#\s*region|\/\/\s*#region|\/\/region)\b[ \t]*(.*?)\s*$/;
const CLOSE = /^\s*(?:#pragma\s+endregion|#\s*endregion|\/\/\s*#endregion|\/\/endregion)\b/;
const CREF = /^\s*\/\/+\s*cref:\s*(\S.*?)\s*$/i;
const GROUP = /^ProSnippet\s+Group\s*:\s*(.+)$/i;
const IGNORED = /^ignore\b/i;

const FENCE_LANGUAGES: Record<string, string> = {
  cs: 'csharp',
  kt: 'kotlin',
  py: 'python',
  js: 'javascript',
  ts: 'typescript',
  h: 'cpp',
  hpp: 'cpp',
};

/** One snippet of a source file. */
export interface Region {
  title: string;
  /** The group the region belongs to, when the file declares groups. */
  group?: string;
  /** API names from the `// cref:` lines above the region, as written. */
  apis: string[];
  /** The region's code without directive and `cref` lines, de-indented. */
  code: string;
  /** 1-based line of the opening directive. */
  line: number;
}

/** Removes the common indentation and the blank lines at both ends. */
function dedent(lines: readonly string[]): string {
  const indent = lines
    .filter((line) => line.trim() !== '')
    .reduce((min, line) => Math.min(min, /^[ \t]*/.exec(line)?.[0].length ?? 0), Infinity);
  return lines
    .map((line) => line.slice(Number.isFinite(indent) ? indent : 0).trimEnd())
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

/**
 * Extracts the regions of a source file, in file order. Nested regions are returned on
 * their own and as part of the region around them; a region left open ends with the file.
 * Regions without code, group markers and `ignore` regions are not snippets.
 */
export function extractRegions(source: string): Region[] {
  interface Frame {
    title: string;
    group?: string;
    apis: string[];
    lines: string[];
    line: number;
    order: number;
  }
  const done: Array<Region & { order: number }> = [];
  const open: Frame[] = [];
  let group: string | undefined;
  let pending: string[] = [];
  let order = 0;

  const close = (): void => {
    const frame = open.pop();
    if (frame === undefined || IGNORED.test(frame.title)) return;
    const code = dedent(frame.lines);
    if (code === '') return;
    done.push({
      title: frame.title === '' ? `Snippet at line ${frame.line}` : frame.title,
      ...(frame.group === undefined ? {} : { group: frame.group }),
      apis: frame.apis,
      code,
      line: frame.line,
      order: frame.order,
    });
  };

  source
    .replace(/^\uFEFF/, '')
    .split(/\r\n?|\n/)
    .forEach((line, index) => {
      const cref = CREF.exec(line)?.[1];
      if (cref !== undefined) {
        pending.push(cref);
        return;
      }
      const title = OPEN.exec(line)?.[1];
      if (title !== undefined) {
        const marker = GROUP.exec(title)?.[1];
        if (marker !== undefined) group = marker.trim();
        open.push({
          // A group marker is an empty region; should it hold code, that code is not a snippet.
          title: marker === undefined ? title : 'ignore',
          ...(group === undefined ? {} : { group }),
          apis: pending,
          lines: [],
          line: index + 1,
          order: order++,
        });
        pending = [];
        return;
      }
      if (CLOSE.test(line)) {
        close();
        return;
      }
      // `cref` lines belong to the region that follows them directly.
      if (line.trim() !== '') pending = [];
      for (const frame of open) frame.lines.push(line);
    });
  while (open.length > 0) close();

  return done.sort((a, b) => a.order - b.order).map(({ order: _order, ...region }) => region);
}

/** Heading text with Markdown's special characters escaped, so `List<T>` stays `List<T>`. */
function headingText(title: string): string {
  return title.replace(/([\\`*_{}[\]<>#])/g, '\\$1');
}

/** A fence longer than any run of backticks in the code. */
function fenced(code: string, language: string): string {
  const longest = (code.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${code}\n${fence}`;
}

/** An inline code span; generic names in doc-comment syntax (``Get``1``) contain backticks. */
function inlineCode(text: string): string {
  const longest = (text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const ticks = '`'.repeat(longest + 1);
  return longest === 0 ? `\`${text}\`` : `${ticks} ${text} ${ticks}`;
}

/** One heading of a snippets page and the region it introduces (none for a group). */
interface Heading {
  title: string;
  region?: Region;
}

/**
 * The Markdown page of a snippets file: the file title, then one heading per group and per
 * region. Returns the headings in document order as well, so that catalogue records can be
 * matched to the section ids the page gets.
 */
export function snippetsMarkdown(
  title: string,
  regions: readonly Region[],
  language: string,
): { markdown: string; headings: Heading[] } {
  const parts = [`# ${headingText(title)}`];
  const headings: Heading[] = [{ title }];
  let group: string | undefined;
  for (const region of regions) {
    if (region.group !== undefined && region.group !== group) {
      group = region.group;
      parts.push(`## ${headingText(group)}`);
      headings.push({ title: group });
    }
    // A region of a group sits one level below the group's heading.
    parts.push(`${region.group === undefined ? '##' : '###'} ${headingText(region.title)}`);
    headings.push({ title: region.title, region });
    if (region.apis.length > 0) {
      parts.push(`Relevant API: ${region.apis.map(inlineCode).join(', ')}`);
    }
    parts.push(fenced(region.code, language));
  }
  return { markdown: parts.join('\n\n'), headings };
}

/** The fence language of a source file. */
function languageOf(path: string): string {
  const extension = extensionOf(path);
  return FENCE_LANGUAGES[extension] ?? extension;
}

/**
 * Search terms for the API names of a region: each name without its parameter list, and its
 * last one and two segments (`MapFactory.CreateMapFromItem`, `CreateMapFromItem`).
 */
function apiKeywords(apis: readonly string[]): string[] {
  const terms = new Set<string>();
  for (const api of apis) {
    const name = api.replace(/\(.*$/, '').replace(/`+\d+/g, '');
    const segments = name.split('.');
    terms.add(segments.slice(-2).join('.'));
    terms.add(segments.at(-1) ?? name);
    terms.add(name);
  }
  terms.delete('');
  return [...terms].slice(0, MAX_KEYWORDS);
}

/** The title of a snippets file: its name without the extension, as words. */
function fileTitle(path: string): string {
  return titleFromName(baseOf(path).replace(/\.[^.]+$/, ''));
}

/**
 * Renders a fetched source file as its snippets page.
 *
 * @returns `undefined` when the file declares no regions, so the caller shows it as plain
 *   source instead.
 */
export function renderSnippets(
  ctx: Ctx,
  src: GithubSource,
  scope: RepoScope,
  path: string,
  res: HttpResponse,
  target: ReadTarget,
): DocPage | undefined {
  const regions = extractRegions(res.text);
  if (regions.length === 0) return undefined;
  const { markdown } = snippetsMarkdown(fileTitle(path), regions, languageOf(path));
  const page = ctx.render.render(
    'markdown',
    { markdown },
    metaOf(src, scope, `${blobUrl(scope.repo, scope.ref, path)}${target.url.hash}`, 'sample', res),
    renderOptionsOf(target, scope),
  );
  return withNotices(page, scope);
}

/** The records of one scanned file: the file itself and one per region. */
function regionRecords(
  src: GithubSource,
  scope: RepoScope,
  path: string,
  text: string,
): CatalogRecord[] {
  const regions = extractRegions(text);
  if (regions.length === 0) return [];
  const title = fileTitle(path);
  const language = languageOf(path);
  const url = blobUrl(scope.repo, scope.ref, path);
  const trail = breadcrumbOf(dirOf(path).split('/'));
  const { markdown, headings } = snippetsMarkdown(title, regions, language);
  const sections = sectionsFromMarkdown(markdown).filter((section) => section.level > 0);

  const records: CatalogRecord[] = [fileRecord(src, scope, path)];
  // The page is built here exactly as `renderSnippets` builds it, so the nth heading is the
  // nth section. Should a title ever defeat that, the file keeps its own record only.
  if (sections.length !== headings.length) return records;
  headings.forEach((heading, index) => {
    const section = sections[index];
    if (heading.region === undefined || section === undefined) return;
    const { region } = heading;
    const keywords = apiKeywords(region.apis);
    records.push({
      ...recordOf(src, scope, `${url}#${section.id}`, 'sample', region.title),
      breadcrumb: [trail, title, region.group]
        .filter((part) => part !== undefined)
        .join(BREADCRUMB_SEPARATOR),
      ...(keywords.length === 0 ? {} : { keywords }),
      language,
      locator: { path, section: section.id },
    });
  });
  return records;
}

function fileRecord(src: GithubSource, scope: RepoScope, path: string): CatalogRecord {
  const trail = breadcrumbOf(dirOf(path).split('/'));
  return {
    ...recordOf(src, scope, blobUrl(scope.repo, scope.ref, path), 'sample', fileTitle(path)),
    ...(trail === undefined ? {} : { breadcrumb: trail }),
    language: languageOf(path),
    locator: { path },
  };
}

/**
 * The catalogue of a snippets repository: for each source file one record, and one per
 * region of the files that could be fetched within the request budget (at most
 * {@link MAX_SCANNED_FILES}). A scanned file without regions is not a snippets file and is
 * left out; a file that was not scanned keeps its file record, so nothing becomes unreachable.
 */
export async function snippetRecords(
  ctx: Ctx,
  src: GithubSource,
  scope: RepoScope,
  tree: readonly TreeFile[],
): Promise<CatalogRecord[]> {
  const files = filesInScope(tree, src.source.config);
  const scanned = files.slice(0, Math.min(MAX_SCANNED_FILES, requestsLeft(src)));
  let spent = false;
  const perFile = await mapPool(scanned, PARALLEL_FETCHES, async (file) => {
    if (spent) return [fileRecord(src, scope, file.path)];
    try {
      const res = await ctx.github.raw(scope.repo, scope.ref, file.path, callOptions(src, scope));
      return regionRecords(src, scope, file.path, res.text);
    } catch (error) {
      spent = tolerate(ctx, src, error, file.path) || spent;
      return [fileRecord(src, scope, file.path)];
    }
  });
  const rest = files.slice(scanned.length).map((file) => fileRecord(src, scope, file.path));
  return [...perFile.flat(), ...rest];
}
