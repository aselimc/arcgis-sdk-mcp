/**
 * The `wiki` preset: a repository's GitHub wiki, read as Markdown from
 * `raw.githubusercontent.com/wiki/<owner>/<repo>/<Page>.md`.
 *
 * GitHub publishes no listing of a wiki, so the catalogue is the link list of `_Sidebar.md`
 * (or of `Home.md` when the wiki has no sidebar). The raw host serves a page only at its
 * path inside the wiki's git repository, while wiki links name pages without a directory.
 * For a wiki that keeps its pages in directories, the registry lists those directories as
 * the source's `include` (`Features/Editing`, `Reference`): a page that is not found by
 * name is then looked for in the directories whose names best match the page and its
 * sidebar group, and the path that worked is remembered.
 */
import { isMcpDocError } from '../../../core/errors.js';
import { matchesAnyGlob } from '../../../core/glob.js';
import { BREADCRUMB_SEPARATOR } from '../../../core/names.js';
import type { Ctx, HttpResponse, ReadTarget } from '../../../core/ports.js';
import type { CatalogRecord, DocPage } from '../../../core/types.js';
import { parseGithubUrl } from '../../../core/url.js';
import { isBinary, presetKind } from './presets.js';
import {
  baseOf,
  callOptions,
  metaOf,
  notFound,
  recordOf,
  renderOptionsOf,
  titleFromName,
  wikiUrl,
  withNotices,
  type GithubSource,
  type RepoScope,
} from './shared.js';

const HOME = 'Home';
const SIDEBAR = '_Sidebar';
/** Directories tried for a page that is not found by name; each attempt is one request. */
const MAX_DIRECTORY_ATTEMPTS = 3;

/** One wiki page linked from a sidebar. */
export interface WikiLink {
  /** Page name as the wiki addresses it (`ProConcepts-Editing`), without `.md`. */
  page: string;
  title: string;
  /** Titles of the sidebar groups the link sits under, outermost first. */
  trail: string[];
}

const MARKDOWN_LINK = /\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const HTML_LINK = /<a\s[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
const WIKI_LINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const BOLD_LINE = /^(?:&nbsp;|\s)*(?:\*\*|__)(.+?)(?:\*\*|__)\s*:?\s*$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** Link text without emphasis, code ticks and tags. */
function plain(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/[*_`]+/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The wiki page a link target names, or `undefined` for a link that leaves the wiki.
 * Understands bare page names (`ProGuide-Custom-settings`), paths relative to a wiki page
 * (`../../arcgis-pro-sdk/wiki/FAQ`) and absolute wiki URLs of the same repository.
 */
function pageOf(target: string, repo: string): string | undefined {
  const name = repo.split('/')[1]?.toLowerCase() ?? '';
  if (SCHEME.test(target)) {
    const location = parseGithubUrl(target);
    return location?.repo.toLowerCase() === repo.toLowerCase() ? location.wikiPage : undefined;
  }
  const path = decode(target.replace(/[?#].*$/, '')).replace(/\.md$/i, '');
  if (path === '' || isBinary(path)) return undefined;
  const segments = path.split('/').filter((segment) => segment !== '' && segment !== '.');
  const wiki = segments.lastIndexOf('wiki');
  if (segments.includes('..') || path.startsWith('/')) {
    // A path that climbs out of the page is a wiki link only when it comes back to this wiki.
    if (wiki < 1 || segments[wiki - 1]?.toLowerCase() !== name) return undefined;
    return segments.slice(wiki + 1).join('/') || HOME;
  }
  return segments.join('/');
}

/**
 * The internal links of a wiki sidebar (or home page), in document order and without
 * duplicates. Headings and bold-only lines are taken as group titles; a horizontal rule
 * ends the current group. Links to anchors of a page, to other sites and to special pages
 * (`_Footer`) are skipped.
 */
export function parseSidebar(markdown: string, repo: string): WikiLink[] {
  const links = new Map<string, WikiLink>();
  let group: string | undefined;
  let subgroup: string | undefined;

  const add = (target: string, text: string): void => {
    const page = pageOf(target.trim(), repo);
    const title = plain(text);
    if (page === undefined || baseOf(page).startsWith('_') || title === '') return;
    const key = page.toLowerCase();
    if (links.has(key)) return;
    links.set(key, {
      page,
      title,
      trail: [group, subgroup].filter((part) => part !== undefined),
    });
  };

  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    if (RULE.test(line)) {
      group = undefined;
      subgroup = undefined;
      continue;
    }
    const heading = HEADING.exec(line)?.[1];
    const bold = BOLD_LINE.exec(line)?.[1];
    // A heading that is itself a link names a page, not a group of pages.
    if (heading !== undefined && !/^\[.*\]\(.*\)$/.test(heading)) {
      group = plain(heading);
      subgroup = undefined;
      continue;
    }
    if (heading !== undefined) {
      group = undefined;
      subgroup = undefined;
    } else if (bold !== undefined && !bold.includes('](')) {
      subgroup = plain(bold);
      continue;
    }
    for (const match of line.matchAll(MARKDOWN_LINK)) add(match[2] ?? '', match[1] ?? '');
    for (const match of line.matchAll(HTML_LINK)) add(match[1] ?? '', match[2] ?? '');
    for (const match of line.matchAll(WIKI_LINK)) {
      // `[[Page Name]]` or `[[Link text|Page Name]]`; page names use hyphens for spaces.
      const text = (match[1] ?? '').trim();
      add((match[2] ?? text).trim().replace(/\s+/g, '-'), text);
    }
  }
  return [...links.values()];
}

/**
 * The catalogue of a wiki: the home page and every page its sidebar links to. One request
 * when the wiki has a sidebar with links, two otherwise.
 *
 * @throws McpDocError `DOC_NOT_FOUND` when the repository has no wiki.
 */
export async function wikiRecords(
  ctx: Ctx,
  src: GithubSource,
  scope: RepoScope,
): Promise<CatalogRecord[]> {
  const opts = callOptions(src);
  let links: WikiLink[] = [];
  try {
    links = parseSidebar((await ctx.github.wikiRaw(scope.repo, SIDEBAR, opts)).text, scope.repo);
  } catch (error) {
    if (!isMcpDocError(error) || error.code !== 'DOC_NOT_FOUND') throw error;
  }
  if (links.every((link) => link.page === HOME)) {
    links = parseSidebar((await ctx.github.wikiRaw(scope.repo, HOME, opts)).text, scope.repo);
  }

  const kind = presetKind('wiki', src.source.kinds);
  const exclude = src.source.config.exclude ?? [];
  const pages: WikiLink[] = [
    { page: HOME, title: HOME, trail: [] },
    ...links.filter((link) => link.page !== HOME && !matchesAnyGlob(link.page, exclude)),
  ];
  return pages.map((link) => ({
    ...recordOf(src, scope, wikiUrl(scope.repo, link.page), kind, link.title),
    ...(link.trail.length === 0 ? {} : { breadcrumb: link.trail.join(BREADCRUMB_SEPARATOR) }),
    locator: { page: link.page },
  }));
}

/** Lower-case words of a name: `MapAuthoring`, `Map-Authoring` and `Map Authoring` agree. */
function words(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '');
}

/** Shortest word that may match another by being its beginning (`layout` in `layouts`). */
const MIN_STEM = 4;

/** True for the same word, or a singular and its plural (`network`, `networks`). */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= MIN_STEM && long.length - short.length <= 2 && long.startsWith(short);
}

/**
 * The wiki directories to try for a page, best match first: a directory scores one point
 * for each word of its name that also occurs in the page name or its sidebar groups.
 */
export function rankDirectories(
  directories: readonly string[],
  page: string,
  breadcrumb = '',
): string[] {
  const wanted = words(`${page} ${breadcrumb}`);
  const score = (directory: string): number =>
    words(directory).filter((word) => wanted.some((other) => sameWord(word, other))).length;
  return directories
    .map((directory) => directory.replace(/\/\**$/, '').replace(/^\/+/, ''))
    .filter((directory) => directory !== '')
    .map((directory, index) => ({ directory, index, score: score(directory) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.directory);
}

/**
 * The sidebar groups a page is linked under, or `undefined` when the sidebar does not link
 * it or cannot be read.
 */
async function sidebarTrail(
  ctx: Ctx,
  src: GithubSource,
  scope: RepoScope,
  page: string,
): Promise<string[] | undefined> {
  try {
    const sidebar = await ctx.github.wikiRaw(scope.repo, SIDEBAR, callOptions(src));
    const wanted = page.toLowerCase();
    return parseSidebar(sidebar.text, scope.repo).find((link) => link.page.toLowerCase() === wanted)
      ?.trail;
  } catch (error) {
    if (isMcpDocError(error) && error.code === 'DOC_NOT_FOUND') return undefined;
    throw error;
  }
}

/** Fetches a wiki page by name, then from the configured directories (see the file comment). */
async function fetchPage(
  ctx: Ctx,
  src: GithubSource,
  scope: RepoScope,
  page: string,
  target: ReadTarget,
): Promise<{ res: HttpResponse }> {
  const opts = callOptions(src);
  const cacheKey = `github-wiki-path:${scope.repo.toLowerCase()}:${page.toLowerCase()}`;
  const known = await ctx.cache.getDerived<{ path: string }>('misc', cacheKey);
  const attempt = async (path: string): Promise<HttpResponse | undefined> => {
    try {
      return await ctx.github.wikiRaw(scope.repo, path, opts);
    } catch (error) {
      if (isMcpDocError(error) && error.code === 'DOC_NOT_FOUND') return undefined;
      throw error;
    }
  };

  for (const path of new Set([...(known === undefined ? [] : [known.path]), page])) {
    const res = await attempt(path);
    if (res !== undefined) return { res };
  }

  const include = src.source.config.include ?? [];
  if (!page.includes('/') && include.length > 0) {
    // The sidebar group of the page says which directory is likely. A page read by its URL
    // comes without its catalogue record, so the sidebar is asked (one cached request).
    const groups =
      target.record?.breadcrumb ?? (await sidebarTrail(ctx, src, scope, page))?.join(' ');
    const directories = rankDirectories(include, page, groups).slice(0, MAX_DIRECTORY_ATTEMPTS);
    for (const directory of directories) {
      const path = `${directory}/${page}`;
      const res = await attempt(path);
      if (res === undefined) continue;
      await ctx.cache.putDerived('misc', cacheKey, { path });
      return { res };
    }
  }
  throw notFound(
    wikiUrl(scope.repo, page),
    `The wiki of ${scope.repo} has no page "${page}" at a known path`,
    'GitHub serves a wiki page only at its path in the wiki repository, and pages kept in a directory cannot be found by name alone',
  );
}

/**
 * Reads one wiki page as Markdown.
 *
 * @throws McpDocError `DOC_NOT_FOUND` when the page exists neither by name nor in one of
 *   the directories the registry lists.
 */
export async function readWiki(
  ctx: Ctx,
  src: GithubSource,
  scope: RepoScope,
  page: string,
  target: ReadTarget,
): Promise<DocPage> {
  const name = page.replace(/\.md$/i, '');
  const { res } = await fetchPage(ctx, src, scope, name, target);
  const kind = target.record?.kind ?? presetKind('wiki', src.source.kinds);
  // The public ref is the page's github.com address, whatever directory the file is kept in.
  const rendered = ctx.render.render(
    'markdown',
    { markdown: res.text },
    metaOf(src, scope, `${wikiUrl(scope.repo, name)}${target.url.hash}`, kind, res),
    renderOptionsOf(target, scope),
  );
  // Wiki pages usually start below the title GitHub shows, which is the page name: without
  // a level-1 heading of its own, a page is titled as the sidebar links it, not after
  // whatever sub-heading comes first ("In this topic").
  const ownTitle = rendered.sections.some((section) => section.level === 1);
  const titled =
    ownTitle && rendered.title !== ''
      ? rendered
      : { ...rendered, title: target.record?.title ?? titleFromName(name) };
  return withNotices(titled, scope);
}
