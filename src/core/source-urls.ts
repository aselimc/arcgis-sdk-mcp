/**
 * The URLs of a source: where it lives for one version line and which URL prefixes it owns.
 * The registry (ownership), the adapters (`BoundSource.url`) and the test fakes all derive
 * them from the functions below, so "the base URL of a source" has one definition.
 */
import { BRIEF_PREFIX, DEVELOPERS_ORIGIN } from './names.js';
import type { AnySourceDef, SourceDef, VersionLine } from './types.js';

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
 * `pkgdown` return one prefix per sitemap directory, entry, spec or package; `brief` and
 * `npm-dts` own no URLs. Filters (`include` / `exclude`) and documentation-URL templates are
 * applied by `ownedPrefix` (`adapter-helpers.ts`), which is what ownership lookups call.
 *
 * `npm-dts` owns nothing because its `docUrl` is the HTML reference its records point to:
 * that page is read through the site source, and the typings are
 * reached by record (a lookup with a version) or as a declared fallback.
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
    case 'npm-dts':
      return [];
    default:
      return root === '' ? [] : [root];
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * For a source addressed through a documentation-URL template (`npm-cem`, and `npm-json`
 * with a `docUrl`): the pattern a URL must match to be one of its pages, where each
 * `{placeholder}` stands for exactly one path segment. `undefined` for every other source.
 *
 * The template `/javascript/latest/references/{pkg}/components/{tag}/` therefore claims
 * component pages and nothing else under `references/`, which its bare prefix would.
 */
export function docUrlPattern(source: SourceDef, line: VersionLine): RegExp | undefined {
  const def = source as AnySourceDef;
  const template =
    def.adapter === 'npm-cem' || def.adapter === 'npm-json' ? def.config.docUrl : undefined;
  if (template === undefined) return undefined;
  const literals = absolute(expandTemplate(template, line))
    .split(/\{[A-Za-z][A-Za-z0-9]*\}/)
    .map((literal) => literal.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&'));
  return new RegExp(`^${literals.join('[^/]+')}`);
}
