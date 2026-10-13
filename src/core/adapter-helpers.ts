/**
 * Helpers shared by every adapter and by the registry: binding a source to a version line,
 * the base-URL rules that decide which source owns a URL, URL filters, and slug titles.
 */
import { BRIEF_PREFIX, DEVELOPERS_ORIGIN } from './names.js';
import type { BoundSource, RequestBudget, SourceAdapter } from './ports.js';
import type {
  AdapterType,
  AnySourceDef,
  DocKind,
  Product,
  SourceDef,
  UrlFilter,
  VersionLine,
} from './types.js';

/**
 * Substitutes `{name}` placeholders from a version line: its `vars`, plus `{line}` for the
 * line id when `vars` does not define it. Unknown placeholders are left in place (adapter
 * placeholders such as `{pkg}`, `{tag}` and `{path}` are filled later).
 */
export function expandTemplate(template: string, line: VersionLine): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (whole, name: string) => {
    const value = line.vars[name] ?? (name === 'line' ? line.id : undefined);
    return value ?? whole;
  });
}

/** Makes a registry URL absolute: paths belong to developers.arcgis.com. */
function absolute(urlOrPath: string): string {
  if (/^https?:\/\//i.test(urlOrPath)) return urlOrPath;
  return `${DEVELOPERS_ORIGIN}/${urlOrPath.replace(/^\/+/, '')}`;
}

function withSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

/** The directory part of a file URL: `https://h/a/sitemap.xml` gives `https://h/a/`. */
function directoryOf(url: string): string {
  return url.replace(/[^/]*$/, '');
}

/** The part of a doc-URL template before its first adapter placeholder. */
function templatePrefix(template: string): string {
  return directoryOf(template.split('{')[0] ?? template);
}

/**
 * The root URL of a source for one version line: what `BoundSource.url()` joins paths onto.
 *
 * | Adapter | Root |
 * |---|---|
 * | `astro`, `gatsby`, `docc`, `dokka`, `dartdoc`, `docfx-net`, `javadoc`, `sphinx` | `config.base` |
 * | `docfx-esri` | `https://doc.esri.com/en/<slug>/latest/` (`toc` and `scope` are relative to it) |
 * | `legacy-help` | `https://<host><base>` |
 * | `sitemap` | directory of the first sitemap URL |
 * | `static`, `openapi` | the first entry or spec URL |
 * | `npm-dts`, `npm-cem`, `npm-json` | `docUrl` up to its first placeholder; without `docUrl` the package page on jsDelivr |
 * | `github-repo`, `xmldoc` | `https://github.com/<repo>/` |
 * | `pkgdown` | `https://<host>/` |
 * | `brief` | `brief:` |
 *
 * Line variables are substituted (`{prefix}`, `{base}`, `{line}`); relative values are on
 * developers.arcgis.com. A source with nothing to derive a root from gets `fallback`.
 */
export function sourceRootUrl(source: SourceDef, line: VersionLine, fallback = ''): string {
  const def = source as AnySourceDef;
  const expand = (value: string): string => absolute(expandTemplate(value, line));
  switch (def.adapter) {
    case 'astro':
    case 'gatsby':
    case 'docc':
    case 'dokka':
    case 'dartdoc':
    case 'docfx-net':
    case 'javadoc':
    case 'sphinx':
      return withSlash(expand(def.config.base));
    case 'docfx-esri':
      return `https://doc.esri.com/en/${def.config.slug}/latest/`;
    case 'legacy-help':
      return withSlash(
        `https://${def.config.host}/${expandTemplate(def.config.base, line).replace(/^\/+/, '')}`,
      );
    case 'sitemap': {
      const first = def.config.url ?? def.config.urls?.[0];
      return first === undefined ? fallback : directoryOf(expand(first));
    }
    case 'static': {
      const first = def.config.entries[0]?.url;
      return first === undefined ? fallback : expand(first);
    }
    case 'openapi': {
      const first = def.config.specs[0];
      if (first === undefined) return fallback;
      return expand(typeof first === 'string' ? first : first.url);
    }
    case 'npm-dts':
    case 'npm-cem':
      return templatePrefix(expand(def.config.docUrl));
    case 'npm-json':
      return def.config.docUrl === undefined
        ? `https://cdn.jsdelivr.net/npm/${def.config.package}/`
        : templatePrefix(expand(def.config.docUrl));
    case 'github-repo':
    case 'xmldoc':
      return `https://github.com/${def.config.repo}/`;
    case 'pkgdown':
      return `https://${def.config.host}/`;
    case 'brief':
      return BRIEF_PREFIX;
  }
}

/**
 * The URL prefixes a source owns for one version line, most specific available. The
 * registry's `ownerOf` picks the source with the longest matching prefix, so this function
 * is the single definition of "which source does this URL belong to".
 *
 * Differences from {@link sourceRootUrl}: `docfx-esri` narrows to `scope` or to each of
 * `sections`; `legacy-help` narrows to each book; `sitemap`, `static`, `openapi` and
 * `pkgdown` return one prefix per sitemap directory, entry, spec or package; `brief` owns
 * no URLs. Filters (`include` / `exclude`) are not applied here.
 */
export function sourceBaseUrls(source: SourceDef, line: VersionLine): string[] {
  const def = source as AnySourceDef;
  const root = sourceRootUrl(def, line);
  const expand = (value: string): string => absolute(expandTemplate(value, line));
  const under = (paths: readonly string[]): string[] =>
    paths.map((path) => withSlash(`${root}${path.replace(/^\/+/, '')}`));
  switch (def.adapter) {
    case 'docfx-esri':
      if (def.config.scope !== undefined) return under([def.config.scope]);
      return def.config.sections?.length ? under(def.config.sections) : [root];
    case 'legacy-help':
      return def.config.books.length > 0
        ? under(def.config.books.map((book) => book.path))
        : [root];
    case 'sitemap':
      return unique(
        [def.config.url, ...(def.config.urls ?? [])]
          .filter((url) => url !== undefined)
          .map((url) => directoryOf(expand(url))),
      );
    case 'static':
      return unique(def.config.entries.map((entry) => expand(entry.url)));
    case 'openapi':
      return unique(
        def.config.specs.map((spec) => expand(typeof spec === 'string' ? spec : spec.url)),
      );
    case 'pkgdown':
      return under(def.config.packages);
    case 'brief':
      return [];
    default:
      return root === '' ? [] : [root];
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
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
