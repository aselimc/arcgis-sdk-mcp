/**
 * Where a wiki page may be kept.
 *
 * GitHub addresses a wiki page by name alone and resolves the name without regard to case
 * or directory. The raw host does neither: it serves a file only at its exact path in the
 * wiki's git repository, and publishes no listing of that repository. A page that is not at
 * the root therefore has to be looked for, and this module says where, most likely first:
 *
 * 1. in the directories the registry lists (`include`), ranked by how well their names match
 *    the page name and the sidebar groups the page is linked under;
 * 2. one level below the best directory, in a directory named after the innermost sidebar
 *    group (`Features/Framework/Customization`) or after the kind of page the name starts
 *    with (`Features/Framework/ProSnippet` for `ProSnippets-Framework`);
 * 3. under the name as the sidebar spells it in its link text, when the link itself is
 *    written in another letter case (`proguide-style-guide` for `ProGuide-Style-Guide.md`).
 *
 * Everything here is pure; the reader in `wiki.ts` tries the candidates and remembers the
 * one that worked.
 */

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

/** Runs of up to three consecutive words written as one: `map`, `mapauthoring`, ... */
function compounds(parts: readonly string[]): string[] {
  const runs: string[] = [];
  for (const part of parts) {
    const list = words(part);
    for (let start = 0; start < list.length; start++) {
      for (let length = 1; length <= 3 && start + length <= list.length; length++) {
        runs.push(list.slice(start, start + length).join(''));
      }
    }
  }
  return runs;
}

/**
 * The directories of a wiki source as plain paths. An entry may hold `*` for one segment
 * (`Features`, `*`, `ProSnippet`): it stands for every name the other entries have at that
 * position, so one line of the registry covers a directory that every feature has.
 */
export function expandDirectories(include: readonly string[]): string[] {
  const plain = include
    .map((directory) => directory.replace(/\/\**$/, '').replace(/^\/+/, ''))
    .filter((directory) => directory !== '');
  const literal = plain.filter((directory) => !directory.includes('*'));
  const expanded = plain.flatMap((directory) => {
    const segments = directory.split('/');
    const at = segments.indexOf('*');
    if (at === -1) return [directory];
    const head = segments.slice(0, at).join('/');
    const names = new Set(
      literal
        .map((other) => other.split('/'))
        .filter((other) => other.length > at && other.slice(0, at).join('/') === head)
        .map((other) => other[at] ?? ''),
    );
    return [...names]
      .map((name) => [...segments.slice(0, at), name, ...segments.slice(at + 1)])
      .filter((path) => !path.includes('*'))
      .map((path) => path.join('/'));
  });
  return [...new Set(expanded)];
}

/**
 * The wiki directories to try for a page, best match first. A directory scores two points
 * for each of its path segments that names the page or one of its sidebar groups as a whole
 * (`MapAuthoring` for the group "Map Authoring", `ProSnippet` for `ProSnippets-...`), and one
 * for each longer word of its name that occurs among theirs (`Network` in `UtilityNetwork`
 * for the group "Networks"). Short words do not count on their own: the `Pro` of
 * `ProSnippet` would otherwise match every `ProGuide` page.
 *
 * @param breadcrumb the sidebar groups of the page, in any separator.
 */
export function rankDirectories(
  directories: readonly string[],
  page: string,
  breadcrumb = '',
): string[] {
  const groups = breadcrumb.split(/\s+>\s+/);
  const wanted = words(`${page} ${breadcrumb}`);
  const wantedCompounds = compounds([page, ...groups]);
  const score = (directory: string): number => {
    const whole = directory
      .split('/')
      .map((segment) => words(segment).join(''))
      .filter((segment) => wantedCompounds.some((other) => sameWord(segment, other))).length;
    const partial = words(directory).filter(
      (word) => word.length >= MIN_STEM && wanted.some((other) => sameWord(word, other)),
    ).length;
    return 2 * whole + partial;
  };
  return expandDirectories(directories)
    .map((directory, index) => ({ directory, index, score: score(directory) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.directory);
}

/**
 * A page name in the letter case of its sidebar link text: each word of the name that the
 * text spells differently takes the spelling of the text (`proguide-style-guide` linked as
 * "ProGuide: Style Guide" gives `ProGuide-Style-Guide`). Words the text does not have stay.
 */
export function respell(page: string, title: string): string {
  const spelled = new Map<string, string>();
  for (const word of title.split(/[^A-Za-z0-9.]+/)) {
    if (word !== '' && !spelled.has(word.toLowerCase())) spelled.set(word.toLowerCase(), word);
  }
  return page
    .split('-')
    .map((word) => spelled.get(word.toLowerCase()) ?? word)
    .join('-');
}

/** What is known about a page besides its name: how the sidebar links it. */
export interface PageHint {
  /** The sidebar groups the page is linked under, outermost first. */
  trail?: readonly string[];
  /** The link text. */
  title?: string;
}

/** Directories ranked below the best one that are still tried, by the page name only. */
const RUNNERS_UP = 2;

/** The directory a group or kind of page would be kept in: its name written as one word. */
function directoryName(text: string): string {
  return text.replace(/[^A-Za-z0-9]+/g, '');
}

/**
 * The paths to try for a page that is not at the root of the wiki, most likely first and
 * without duplicates (see the file comment). Each one costs a request, so the caller sets
 * how many it tries.
 */
export function pathCandidates(
  directories: readonly string[],
  page: string,
  hint: PageHint = {},
): string[] {
  const trail = (hint.trail ?? []).filter((group) => group !== '');
  const [best, ...others] = rankDirectories(directories, page, trail.join(' > '));
  if (best === undefined) return [];

  const respelled = hint.title === undefined ? page : respell(page, hint.title);
  const names = respelled === page ? [page] : [page, respelled];
  const below: string[] = [];
  const group = trail.length > 1 ? directoryName(trail.at(-1) ?? '') : '';
  if (group !== '') below.push(group);
  // `ProSnippets-Framework` is a page of kind `ProSnippets`; its directory may be singular.
  const kind = page.includes('-') ? directoryName(page.split('-')[0] ?? '') : '';
  if (kind !== '') below.push(...(kind.endsWith('s') ? [kind.slice(0, -1), kind] : [kind]));

  const last = words(best.split('/').at(-1) ?? '').join('');
  const nested = below
    // A directory the registry lists already ends in that name.
    .filter((name) => !sameWord(last, words(name).join('')))
    .map((name) => `${best}/${name}`);

  const candidates = [
    ...[best, ...nested].flatMap((directory) => names.map((name) => `${directory}/${name}`)),
    ...others.slice(0, RUNNERS_UP).map((directory) => `${directory}/${page}`),
  ];
  return [...new Set(candidates)];
}
