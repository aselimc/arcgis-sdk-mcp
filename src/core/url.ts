/**
 * URL and ref handling. A ref is an https URL or `brief:<slug>` (design decision 2); every
 * place that compares, caches or de-duplicates URLs goes through {@link canonicalize}.
 */
import { formatCall } from './budget.js';
import { McpDocError } from './errors.js';
import { BRIEF_PREFIX, TOOLS } from './names.js';

/** Query parameters that never change what a page shows. */
const TRACKING_PARAM =
  /^(?:utm_[a-z0-9_]+|gclid|fbclid|msclkid|mc_cid|mc_eid|_ga|_gl|rmedium|rsource|highlight)$/i;

/** `/en/<site>/<numbered version>/` on doc.esri.com; every numbered version redirects to `latest`. */
const DOC_ESRI_VERSION = /^(\/[a-z]{2}(?:-[a-z]{2})?\/[^/]+\/)\d+(?:\.\d+)*(?=\/)/i;

const GITHUB_HOST = 'github.com';
const RAW_HOST = 'raw.githubusercontent.com';

/** Percent-decoding that returns the input unchanged when it holds a malformed escape. */
function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function notAUrl(input: string): McpDocError {
  const query = input.trim().slice(0, 120);
  return new McpDocError('DOC_NOT_FOUND', `"${query}" is not a documentation URL`, {
    why: 'A ref is an https URL on an Esri documentation host, or brief:<slug>',
    next: formatCall(TOOLS.search, { query }),
  });
}

/** `scheme://`, or one of the schemes that are written without slashes. */
const SCHEME = /^(?:([a-z][a-z0-9+.-]*):\/\/|(javascript|data|mailto|file|blob|about|vbscript):)/i;

/**
 * A URL written without its scheme. The host must be lower-case and end in a top-level
 * domain that documentation hosts use, so that qualified API names such as
 * `FeatureLayer.queryFeatures`, `arcpy.da.SearchCursor` or `System.IO` are not taken for hosts.
 */
const SCHEMELESS = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|io|net|dev)(?::\d+)?(?:[/?#]|$)/;

/** Parses an http(s) URL, accepting a missing scheme (`developers.arcgis.com/...`). */
function parseUrl(input: string): URL {
  const text = input.trim();
  const match = SCHEME.exec(text);
  const scheme = (match?.[1] ?? match?.[2])?.toLowerCase();
  if (scheme !== undefined && scheme !== 'http' && scheme !== 'https') {
    throw new McpDocError('HOST_NOT_ALLOWED', `Only https URLs can be read, not ${scheme}:`, {
      why: 'Documentation is fetched over https from Esri documentation hosts only',
      url: text,
    });
  }
  if (scheme === undefined && !SCHEMELESS.test(text)) throw notAUrl(input);
  try {
    return new URL(scheme === undefined ? `https://${text}` : text);
  } catch {
    throw notAUrl(input);
  }
}

/**
 * The canonical form of a documentation URL.
 *
 * Forces https, drops tracking parameters and `?highlight=`, a trailing `index.html`, the
 * `live/` suffix of JavaScript sample pages and duplicate slashes, and rewrites a numbered
 * doc.esri.com version to `latest`. The fragment and all other query parameters are kept.
 *
 * @throws McpDocError `DOC_NOT_FOUND` when `url` is not a URL, `HOST_NOT_ALLOWED` for a
 *   scheme other than http(s).
 */
export function canonicalize(url: string): string {
  const parsed = parseUrl(url);
  parsed.protocol = 'https:';
  parsed.port = '';
  parsed.username = '';
  parsed.password = '';

  for (const name of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAM.test(name)) parsed.searchParams.delete(name);
  }

  let path = parsed.pathname
    .replace(/\/{2,}/g, '/')
    .replace(/\/index\.html$/i, '/')
    .replace(/\/live\/$/, '/');
  if (parsed.hostname === 'doc.esri.com') path = path.replace(DOC_ESRI_VERSION, '$1latest');
  parsed.pathname = path;
  return parsed.href;
}

/** The pieces of a github.com or raw.githubusercontent.com URL. */
export interface GithubLocation {
  /** `owner/name`. */
  repo: string;
  /** Branch, tag or commit; absent for a repository root or a wiki page. */
  ref?: string;
  /** File or directory path inside the repository, without a leading slash. */
  path?: string;
  /** Wiki page name without `.md`; `Home` for the wiki root. */
  wikiPage?: string;
}

/**
 * Parses `https://github.com/<o>/<r>[/blob|raw|tree/<ref>/<path>]`, wiki URLs and their
 * `raw.githubusercontent.com` counterparts. Returns `undefined` for anything else,
 * including issues, pulls and other non-content pages.
 *
 * A ref is taken to be one path segment (`refs/heads/<name>` and `refs/tags/<name>` are
 * unwrapped), which is true for every branch and tag in the registry.
 */
export function parseGithubUrl(url: string): GithubLocation | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const segments = parsed.pathname
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(safeDecode);

  if (parsed.hostname === RAW_HOST) {
    if (segments[0] === 'wiki') {
      const [, owner, name, ...page] = segments;
      if (owner === undefined || name === undefined || page.length === 0) return undefined;
      return { repo: `${owner}/${name}`, wikiPage: page.join('/').replace(/\.md$/i, '') };
    }
    const [owner, name, ...rest] = segments;
    if (owner === undefined || name === undefined) return undefined;
    return withRefAndPath(`${owner}/${name}`, rest);
  }

  if (parsed.hostname !== GITHUB_HOST) return undefined;
  const [owner, name, verb, ...rest] = segments;
  if (owner === undefined || name === undefined) return undefined;
  const repo = `${owner}/${name.replace(/\.git$/, '')}`;
  if (verb === undefined) return { repo };
  if (verb === 'wiki') return { repo, wikiPage: rest.join('/') || 'Home' };
  if (verb === 'blob' || verb === 'raw' || verb === 'tree') return withRefAndPath(repo, rest);
  return undefined;
}

function withRefAndPath(repo: string, rest: string[]): GithubLocation | undefined {
  const qualified = rest[0] === 'refs' && (rest[1] === 'heads' || rest[1] === 'tags');
  const [ref, ...path] = qualified ? rest.slice(2) : rest;
  if (ref === undefined) return undefined;
  return path.length === 0 ? { repo, ref } : { repo, ref, path: path.join('/') };
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/**
 * Maps a GitHub page URL to the raw-content URL that is actually fetched:
 * `github.com/<o>/<r>/blob/<ref>/<path>` to `raw.githubusercontent.com/<o>/<r>/<ref>/<path>`,
 * and `github.com/<o>/<r>/wiki/<Page>` to `raw.githubusercontent.com/wiki/<o>/<r>/<Page>.md`.
 *
 * @returns `undefined` when the URL does not name a file or wiki page (repository roots and
 *   directories need the GitHub API instead).
 */
export function githubBlobToRaw(url: string): string | undefined {
  const location = parseGithubUrl(url);
  if (location === undefined) return undefined;
  if (location.wikiPage !== undefined) {
    return `https://${RAW_HOST}/wiki/${location.repo}/${encodePath(location.wikiPage)}.md`;
  }
  if (location.ref === undefined || location.path === undefined) return undefined;
  return `https://${RAW_HOST}/${location.repo}/${encodeURIComponent(location.ref)}/${encodePath(location.path)}`;
}

/**
 * The inverse of {@link githubBlobToRaw}: the github.com URL to show an agent for a raw
 * file or raw wiki page. Returns `undefined` for anything else.
 */
export function rawToGithubBlob(url: string): string | undefined {
  const location = parseGithubUrl(url);
  if (location === undefined) return undefined;
  if (location.wikiPage !== undefined) {
    return `https://${GITHUB_HOST}/${location.repo}/wiki/${encodePath(location.wikiPage)}`;
  }
  if (location.ref === undefined || location.path === undefined) return undefined;
  return `https://${GITHUB_HOST}/${location.repo}/blob/${encodeURIComponent(location.ref)}/${encodePath(location.path)}`;
}

/**
 * Heading text to anchor id, GitHub style: lower-case, punctuation removed, whitespace to
 * hyphens. Unlike GitHub, runs of hyphens collapse and edge hyphens are trimmed, so the id
 * is stable against cosmetic edits. Returns `section` for a heading with no letters or digits.
 */
export function slugify(heading: string): string {
  const slug = heading
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'section' : slug;
}

function decodeFragment(hash: string): string | undefined {
  const raw = hash.replace(/^#/, '');
  return raw === '' ? undefined : safeDecode(raw);
}

/**
 * Splits a ref into what to fetch and which part of it to show.
 *
 * - `brief:<slug>[#fragment]` gives `{ brief, fragment? }`.
 * - A URL gives `{ url, fragment? }` where `url` is canonical and **still carries** the
 *   fragment (member anchors are part of a symbol's identity); `fragment` is its decoded text.
 *
 * @throws McpDocError `DOC_NOT_FOUND` (with a search to try) when `ref` is neither,
 *   `HOST_NOT_ALLOWED` for a scheme other than http(s). Whether the host is allowed is the
 *   policy's decision, not this function's.
 */
export function splitRef(ref: string): { url?: URL; fragment?: string; brief?: string } {
  const text = ref.trim();
  if (text.toLowerCase().startsWith(BRIEF_PREFIX)) {
    const [slug = '', ...rest] = text.slice(BRIEF_PREFIX.length).split('#');
    const brief = slug
      .trim()
      .replace(/^\/+|\/+$/g, '')
      .toLowerCase();
    if (!/^[a-z0-9][a-z0-9/_-]*$/.test(brief)) throw notAUrl(ref);
    const fragment = decodeFragment(rest.join('#'));
    return fragment === undefined ? { brief } : { brief, fragment };
  }
  const url = new URL(canonicalize(text));
  const fragment = decodeFragment(url.hash);
  return fragment === undefined ? { url } : { url, fragment };
}

/**
 * A ref reduced to its page, in the one spelling that Markdown links and catalogue records
 * share: no query, no fragment and no trailing slash (DocC pages link each other without the
 * slash that their catalogue refs end in). Two members with the same page key are
 * documented on one page. A comparison key, not a URL to fetch.
 */
export function pageKey(ref: string): string {
  return ref.replace(/[?#].*$/, '').replace(/\/+$/, '');
}
