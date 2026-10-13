/**
 * URL arithmetic of a Gatsby sub-site. Every sub-site is built with its own `pathPrefix`
 * (`/rest/geocode/`, `/python/latest/`), and everything it publishes hangs off that prefix:
 * `sitemap-0.xml`, `page-data/<page>/page-data.json`, `page-data/sq/d/<hash>.json` and the
 * hashed files under `static/`. A source's `base` is usually the prefix, but may be a
 * directory inside it (the Python API reference), so the two are kept apart.
 */
import { matchUrlFilter } from '../../../core/adapter-helpers.js';
import { DEVELOPERS_ORIGIN } from '../../../core/names.js';
import type { UrlFilter } from '../../../core/types.js';

/** Where a source lives: its own base URL and the `pathPrefix` of the site that serves it. */
export interface GatsbySite {
  /** The source's base URL, ending in `/`. Pages of the source lie under it. */
  base: string;
  /** The Gatsby `pathPrefix` as an absolute URL ending in `/`; `base` starts with it. */
  prefix: string;
}

/** How many directories above `base` are tried when looking for the site prefix. */
const MAX_PREFIX_LEVELS_UP = 2;

/** File extensions that mark the last path segment as a file, which takes no trailing slash. */
const FILE_EXTENSION = /\.(?:html?|json|xml|md|txt|pdf|ipynb)$/i;

/** Marks nav entries that are placeholders, not pages (dividers carry `/__undefined/`). */
const PLACEHOLDER = '__undefined';

/** Esri's marker for "the developers site root" in cross-site links. */
const DEVSITE = /^\/?DEVSITE(?:\/|$)/;

/**
 * Candidate site prefixes for a base URL, most specific first: the base itself, then up to
 * two parent directories. The host root is a candidate only when the base is the root,
 * because the root of a documentation host is a different site with its own sitemap.
 */
export function prefixCandidates(base: string): string[] {
  const url = new URL(base);
  const segments = url.pathname.split('/').filter((segment) => segment.length > 0);
  const candidates: string[] = [];
  for (let up = 0; up <= MAX_PREFIX_LEVELS_UP && up <= segments.length; up += 1) {
    const kept = segments.slice(0, segments.length - up);
    if (kept.length === 0 && segments.length > 0) break;
    candidates.push(`${url.origin}/${kept.map((segment) => `${segment}/`).join('')}`);
  }
  return candidates;
}

/**
 * The identity of a page: its https URL without query or fragment, with a trailing slash
 * unless the last segment is a file (`arcgis.gis.toc.html`). Sitemaps, nav trees, stores and
 * TypeDoc manifests spell the same page with and without the slash; this makes them agree.
 */
export function pageKey(url: string): string {
  const parsed = new URL(url);
  parsed.protocol = 'https:';
  parsed.hash = '';
  parsed.search = '';
  if (!parsed.pathname.endsWith('/') && !FILE_EXTENSION.test(parsed.pathname)) {
    parsed.pathname = `${parsed.pathname}/`;
  }
  return parsed.href;
}

/** The path of `url` below `root` without a leading slash, or `undefined` when it is not below it. */
export function relativeTo(root: string, url: string): string | undefined {
  const target = url.replace(/[?#].*$/, '');
  return target.startsWith(root) ? target.slice(root.length) : undefined;
}

/** True when `url` is a page of the source: under its base and accepted by its URL filter. */
export function ownsPage(site: GatsbySite, filter: UrlFilter, url: string): boolean {
  const rel = relativeTo(site.base, url);
  return rel !== undefined && matchUrlFilter(rel, filter);
}

/**
 * The `page-data.json` URL of a page: `<prefix>page-data/<path below the prefix>/page-data.json`,
 * with `index` standing for the site's root page. `undefined` when the page is not on the site.
 */
export function pageDataUrl(prefix: string, pageUrl: string): string | undefined {
  const rel = relativeTo(prefix, pageUrl);
  if (rel === undefined) return undefined;
  const path = rel.replace(/^\/+|\/+$/g, '');
  return `${prefix}page-data/${path === '' ? 'index' : path}/page-data.json`;
}

/** The URL of one static query result of a site. */
export function staticQueryUrl(prefix: string, hash: string): string {
  return `${prefix}page-data/sq/d/${encodeURIComponent(hash)}.json`;
}

/** The path a renderer prepends to site-relative links: `/rest` for the prefix `…/rest/`. */
export function sitePrefixPath(prefix: string): string {
  return new URL(prefix).pathname.replace(/\/+$/, '');
}

/**
 * Makes a URL from a nav tree, store, pagination file or manifest absolute. Those files mix
 * four spellings: a full URL, a path that already includes the site prefix
 * (`/python/latest/api-reference/x.html#y`), a path relative to the prefix (`/maps/camera/`,
 * `objects/sceneLayer/`), and a cross-site link through the `DEVSITE` placeholder.
 *
 * The page part is normalised with {@link pageKey}; a fragment is kept. Returns `undefined`
 * for empty values, placeholders and anything that does not parse.
 */
export function resolveSiteUrl(site: GatsbySite, raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const text = raw.trim();
  if (text === '' || text.includes(PLACEHOLDER)) return undefined;
  const prefix = new URL(site.prefix);
  let absolute: string;
  if (/^https?:\/\//i.test(text)) absolute = text;
  else if (DEVSITE.test(text)) absolute = `${DEVELOPERS_ORIGIN}/${text.replace(DEVSITE, '')}`;
  else {
    const path = text.startsWith('/') ? text : `/${text}`;
    const prefixed = prefix.pathname !== '/' && path.startsWith(prefix.pathname);
    absolute = prefixed ? `${prefix.origin}${path}` : `${site.prefix}${path.slice(1)}`;
  }
  try {
    const hash = new URL(absolute).hash;
    return `${pageKey(absolute)}${hash}`;
  } catch {
    return undefined;
  }
}
