/**
 * Helpers shared by every adapter and by the registry: binding a source to a version line,
 * deciding which source owns a URL, URL filters, and slug titles.
 */
import type { BoundSource, RequestBudget, SourceAdapter } from './ports.js';
import { docUrlPattern, sourceBaseUrls, sourceRootUrl } from './source-urls.js';
import type {
  AdapterType,
  AnySourceDef,
  DocKind,
  Product,
  SourceDef,
  UrlFilter,
  VersionLine,
} from './types.js';
import { parseGithubUrl } from './url.js';

/**
 * The prefix by which a source owns a URL on one version line, or `undefined` when it does
 * not own it. The registry's `ownerOf` picks the longest result over all sources and lines.
 *
 * - `github-repo` and `xmldoc`: any file, directory or wiki URL of the repository, on
 *   github.com or raw.githubusercontent.com (owner and name compared without case);
 * - every other adapter: the longest of {@link sourceBaseUrls} the URL starts with, provided
 *   the rest of the path passes the source's `include` / `exclude` filter (`astro`, `gatsby`
 *   and `sitemap` configs carry one) and, for a source addressed through a `docUrl` template
 *   (`npm-cem`, `npm-json`), the URL has the shape of that template ({@link docUrlPattern}).
 *
 * The fragment is ignored.
 */
export function ownedPrefix(
  source: SourceDef,
  line: VersionLine,
  url: URL | string,
): string | undefined {
  const def = source as AnySourceDef;
  const target = (typeof url === 'string' ? url : url.href).replace(/#.*$/, '');
  if (def.adapter === 'github-repo' || def.adapter === 'xmldoc') {
    const repo = parseGithubUrl(target)?.repo.toLowerCase();
    return repo === def.config.repo.toLowerCase() ? sourceRootUrl(def, line) : undefined;
  }
  const filter =
    def.adapter === 'astro' || def.adapter === 'gatsby' || def.adapter === 'sitemap'
      ? def.config
      : undefined;
  if (docUrlPattern(def, line)?.test(target) === false) return undefined;
  let best: string | undefined;
  for (const base of sourceBaseUrls(def, line)) {
    if (!target.startsWith(base) || base.length <= (best?.length ?? 0)) continue;
    if (filter !== undefined && !matchUrlFilter(target.slice(base.length), filter)) continue;
    best = base;
  }
  return best;
}

/**
 * Binds a source to a product and version line.
 *
 * `url()` returns {@link sourceRootUrl} (falling back to the product homepage); `url(path)`
 * appends `path` to it, ignoring leading slashes, and returns `path` unchanged when it is
 * already an absolute URL.
 */
export function bindSource<A extends AdapterType>(
  product: Product,
  source: SourceDef<A>,
  line: VersionLine,
  version?: string,
  budget?: RequestBudget,
): BoundSource<A> {
  const root = sourceRootUrl(source, line, product.homepage);
  return {
    product,
    source,
    line,
    ...(version === undefined ? {} : { version }),
    ...(budget === undefined ? {} : { budget }),
    url(path?: string): string {
      if (path === undefined || path === '') return root;
      if (/^https?:\/\//i.test(path)) return path;
      const relative = path.replace(/^\/+/, '');
      // `brief:` and file-like roots (a spec URL) take the path as written after them.
      return root.endsWith('/') || root.endsWith(':')
        ? `${root}${relative}`
        : `${root}/${relative}`;
    },
  };
}

const compiled = new Map<string, RegExp>();

/** Registry patterns are a small fixed set, so compiled expressions are kept for the process lifetime. */
function pattern(source: string): RegExp {
  let regex = compiled.get(source);
  if (regex === undefined) {
    regex = new RegExp(source);
    compiled.set(source, regex);
  }
  return regex;
}

/**
 * Applies the `include` / `exclude` rules of a {@link UrlFilter} to a path relative to the
 * source base (no leading slash). A path passes when it matches at least one `include`
 * pattern (or there are none) and no `exclude` pattern.
 */
export function matchUrlFilter(path: string, filter: UrlFilter): boolean {
  const included =
    filter.include === undefined ||
    filter.include.length === 0 ||
    filter.include.some((source) => pattern(source).test(path));
  return included && !(filter.exclude ?? []).some((source) => pattern(source).test(path));
}

/**
 * The document kind of a path: the kind of the first matching `classify` rule, else `fallback`.
 */
export function classifyUrl(path: string, filter: UrlFilter, fallback: DocKind = 'guide'): DocKind {
  for (const [source, kind] of filter.classify ?? []) {
    if (pattern(source).test(path)) return kind;
  }
  return fallback;
}

/**
 * The default `SourceAdapter.symbol` implementation: read the record's page and, when the
 * record is a member (it has a `parent`), select that member.
 */
export function defaultSymbolRead<A extends AdapterType>(
  adapter: Pick<SourceAdapter<A>, 'read'>,
): NonNullable<SourceAdapter<A>['symbol']> {
  return (ctx, src, record, detail) => {
    const member =
      record.parent === undefined
        ? undefined
        : (record.symbol ?? record.qualified?.split(/[.#]|::/).at(-1));
    return adapter.read(ctx, src, {
      url: new URL(record.ref),
      detail,
      record,
      ...(member === undefined ? {} : { select: { member } }),
    });
  };
}

/**
 * A readable title from a URL slug or file name, for sources that publish no titles:
 * `get-started-with-oauth` gives `Get started with oauth`, `ProConcepts-Editing.html`
 * gives `ProConcepts Editing`. Takes the last non-empty path segment, drops the extension
 * and any fragment or query, and capitalises the first letter only.
 */
export function humanizeSlug(slug: string): string {
  const segment =
    slug
      .replace(/[?#].*$/, '')
      .split('/')
      .filter((part) => part.length > 0)
      .at(-1) ?? '';
  let text = segment;
  try {
    text = decodeURIComponent(segment);
  } catch {
    // A malformed escape is shown as written rather than failing a whole enumeration.
  }
  const words = text
    .replace(/\.(?:html?|md|mdx|ipynb|json|ya?ml|xml|txt)$/i, '')
    .replace(/[-_+\s]+/g, ' ')
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
