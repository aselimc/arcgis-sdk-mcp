/**
 * The glob dialect of the registry: brief slugs (`ai/*`), repository paths
 * (`templates/**`, `**\/*.proto`) and workspace manifests (`**\/*.csproj`). Registry data is
 * written by one package and read by others, so the meaning of a pattern is fixed here.
 */

const compiled = new Map<string, RegExp>();

/**
 * Compiles a glob to an anchored, case-sensitive regular expression over `/`-separated paths
 * without a leading slash.
 *
 * | Pattern | Matches |
 * |---|---|
 * | `*` | any run of characters inside one path segment |
 * | `?` | one character inside a segment |
 * | `**\/` | zero or more whole directories (`**\/*.md` matches `README.md` and `a/b/c.md`) |
 * | `**` elsewhere | anything, across segments (`docs/**`, `_docs/**.md`) |
 *
 * Every other character is literal; there are no braces, character classes or negation.
 */
export function globToRegExp(glob: string): RegExp {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob.charAt(i);
    if (char === '?') {
      source += '[^/]';
    } else if (char !== '*') {
      source += char.replace(/[\\^$+.()|[\]{}]/g, '\\$&');
    } else if (glob.charAt(i + 1) !== '*') {
      source += '[^/]*';
    } else if (glob.charAt(i + 2) === '/') {
      source += '(?:.*/)?';
      i += 2;
    } else {
      source += '.*';
      i += 1;
    }
  }
  return new RegExp(`^${source}$`);
}

/**
 * True when `path` matches at least one of `globs` (see {@link globToRegExp}). An empty list
 * matches nothing. Compiled patterns are kept for the process lifetime: the registry holds a
 * small fixed set, and repository trees are filtered path by path.
 */
export function matchesAnyGlob(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => {
    let regex = compiled.get(glob);
    if (regex === undefined) {
      regex = globToRegExp(glob);
      compiled.set(glob, regex);
    }
    return regex.test(path);
  });
}
