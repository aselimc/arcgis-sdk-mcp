/**
 * Decides how a ref is read: a curated brief, a page of a registered
 * source through its adapter, a GitHub file of an allowed owner, or any other page on an
 * allow-listed host through the generic HTML path. The policy is asked before anything else.
 */
import { bindSource, humanizeSlug } from '../../core/adapter-helpers.js';
import { formatCall } from '../../core/budget.js';
import { isMcpDocError, McpDocError } from '../../core/errors.js';
import { matchesAnyGlob } from '../../core/glob.js';
import { TOOLS } from '../../core/names.js';
import type { AdapterRegistry, Ctx, RequestBudget, SourceAdapter } from '../../core/ports.js';
import { nearest } from '../../core/text-distance.js';
import type { Product, SourceDef, VersionLine } from '../../core/types.js';
import { githubBlobToRaw, parseGithubUrl, splitRef, type GithubLocation } from '../../core/url.js';
import { refusedGithubRef } from './github-ref.js';

/** A curated brief as the registry holds it. */
export type Brief = ReturnType<Ctx['registry']['briefs']>[number];

/** A page of a registered source. */
export interface OwnedRoute {
  kind: 'owned';
  url: URL;
  fragment?: string;
  product: Product;
  source: SourceDef;
  line: VersionLine;
  /** Set when the host's own capability is off; the source may still be readable through another. */
  hostDisabled?: McpDocError;
}

/** How a ref will be read. */
export type Route =
  | {
      kind: 'brief';
      ref: string;
      fragment?: string;
      brief: Brief;
      product?: Product;
      source?: SourceDef;
    }
  | OwnedRoute
  | { kind: 'github'; url: URL; fragment?: string; location: GithubLocation }
  | { kind: 'generic'; url: URL; fragment?: string };

/** Capabilities that mean "fetched from the documentation website". */
const SITE_CAPABILITIES = new Set(['website', 'site-index']);

/** A search call built from the words of a URL, for "not found" recoveries. */
export function searchFromUrl(url: string, product?: string): string {
  return formatCall(TOOLS.search, { query: humanizeSlug(url) || url, product });
}

function adapterOf(adapters: AdapterRegistry, source: SourceDef): SourceAdapter | undefined {
  try {
    return adapters.get(source.adapter);
  } catch {
    return undefined;
  }
}

/** The URL whose host the policy must allow for a ref: GitHub pages are fetched from other hosts. */
function fetchedUrl(url: URL): URL {
  const location = parseGithubUrl(url.href);
  if (location === undefined) return url;
  return new URL(githubBlobToRaw(url.href) ?? `https://api.github.com/repos/${location.repo}`);
}

/** The MCP resource form of a brief, which hosts list next to the tools. */
const BRIEF_RESOURCE = /^arcgis-docs:\/\/brief\/(.+)$/i;
const PRODUCT_RESOURCE = /^arcgis-docs:\/\/product\/([^/#?]+)/i;

/**
 * A ref in the spelling the rest of the service reads. The URI under which this server
 * lists a brief as a resource (`arcgis-docs://brief/<slug>`) is the brief `brief:<slug>`:
 * an agent that copies it from the resource list means that document.
 */
export function normalizeRef(ref: string): string {
  const resource = BRIEF_RESOURCE.exec(ref.trim());
  if (resource !== null) return `brief:${resource[1] ?? ''}`;
  // A URL copied out of Markdown can keep its backslash escapes (`tojson\(\)`), and URL
  // parsing would turn each backslash into a slash.
  return /^\s*https?:\/\//i.test(ref) ? ref.replace(MARKDOWN_ESCAPE, '$1') : ref;
}

const MARKDOWN_ESCAPE = /\\([\\`*_{}()#+.!~<>|[\]-])/g;

/** An archived version of the JavaScript SDK reference: `/javascript/v4-34/...`. */
const JS_ARCHIVE = /^\/javascript\/v?(\d+)[-.](\d+)\/(.*)$/;

/**
 * The recovery for a page of the archived JavaScript SDK documentation, which is link-only:
 * the same symbol at that version through the typings, or the version's release facts.
 */
function archiveRecovery(url: URL): string | undefined {
  if (url.hostname !== 'archive.developers.arcgis.com') return undefined;
  const match = JS_ARCHIVE.exec(url.pathname);
  if (match === null) return undefined;
  const version = `${match[1] ?? ''}.${match[2] ?? ''}`;
  const symbol = /api-reference\/esri-(?:[\w-]+-)?(\w+)\.html$/.exec(match[3] ?? '')?.[1];
  const call =
    symbol === undefined
      ? formatCall(TOOLS.getVersions, { product: 'js-maps-sdk', version })
      : formatCall(TOOLS.lookupSymbol, { symbol, product: 'js-maps-sdk', version });
  return `Open ${url.href} in a browser, or ${symbol === undefined ? 'see what that version is with' : 'look the symbol up at that version with'} ${call}`;
}

/** A GitHub page that is not a file, wiki page or repository: an issue, a pull request, a commit. */
function unreadableGithubPage(ctx: Ctx, url: URL): McpDocError {
  const [owner = '', name = ''] = url.pathname.split('/').filter((segment) => segment !== '');
  // The owner is the policy's decision; its refusal names the owners that are read.
  if (owner !== '' && name !== '') {
    ctx.policy.check(new URL(`https://api.github.com/repos/${owner}/${name}`));
  }
  return new McpDocError('HOST_NOT_ALLOWED', `${url.href} is not a readable GitHub page`, {
    why: 'Of a repository, only files (github.com/<owner>/<repo>/blob/<branch or tag>/<path>), wiki pages (/wiki/<page>) and the repository root are read; issues, pull requests and commit pages are not',
    url: url.href,
    host: url.host,
    ...(owner === '' || name === ''
      ? {}
      : { next: formatCall(TOOLS.read, { ref: `https://github.com/${owner}/${name}` }) }),
  });
}

function briefRoute(ctx: Ctx, slug: string, fragment: string | undefined): Route {
  const briefs = ctx.registry.briefs();
  const brief = briefs.find((candidate) => candidate.slug.toLowerCase() === slug);
  if (brief === undefined) {
    // The set is small and fixed, so all of it is listed, most similar first: a guess such
    // as "brief:index" has no near neighbour, and then the list is the only way on.
    const slugs = briefs.map((candidate) => candidate.slug);
    const near = nearest(slug, slugs, slugs.length);
    const ordered = [...near, ...slugs.filter((candidate) => !near.includes(candidate))];
    const [first] = near;
    throw new McpDocError('DOC_NOT_FOUND', `There is no brief "${slug}"`, {
      why: `Briefs are a fixed set of curated notes shipped with this server: ${slugs.join(', ')}`,
      candidates: ordered.map((candidate) => `brief:${candidate}`),
      next:
        first === undefined
          ? formatCall(TOOLS.search, { query: humanizeSlug(slug) || slug })
          : formatCall(TOOLS.read, { ref: `brief:${first}` }),
    });
  }
  // A brief belongs to the product whose `brief` source lists it, when there is one.
  for (const product of ctx.registry.all()) {
    const source = product.sources.find(
      (candidate) => candidate.adapter === 'brief' && matchesAnyGlob(slug, candidate.config.slugs),
    );
    if (source !== undefined) {
      return {
        kind: 'brief',
        ref: `brief:${brief.slug}`,
        brief,
        product,
        source,
        ...(fragment === undefined ? {} : { fragment }),
      };
    }
  }
  return {
    kind: 'brief',
    ref: `brief:${brief.slug}`,
    brief,
    ...(fragment === undefined ? {} : { fragment }),
  };
}

/**
 * Routes a ref.
 *
 * @throws McpDocError `DOC_NOT_FOUND` (not a ref, unknown brief), `HOST_NOT_ALLOWED`,
 *   `LINK_ONLY` (a link-only host or version line) or `SOURCE_DISABLED`.
 */
export function routeRef(
  ctx: Ctx,
  adapters: AdapterRegistry,
  ref: string,
  budget?: RequestBudget,
): Route {
  const profile = PRODUCT_RESOURCE.exec(ref.trim())?.[1];
  if (profile !== undefined) {
    throw new McpDocError('DOC_NOT_FOUND', `"${ref}" is a resource, not a document`, {
      why: 'A product profile is read with arcgis_docs_list_products',
      next: formatCall(TOOLS.listProducts, { product: profile }),
    });
  }
  const { url, fragment, brief } = splitRef(normalizeRef(ref));
  if (brief !== undefined) return briefRoute(ctx, brief, fragment);
  if (url === undefined)
    throw new McpDocError('DOC_NOT_FOUND', `"${ref}" is not a documentation ref`);
  const part = fragment === undefined ? {} : { fragment };

  const refused = refusedGithubRef(url);
  if (refused !== undefined) throw refused;
  if (url.hostname === 'github.com' && parseGithubUrl(url.href) === undefined) {
    throw unreadableGithubPage(ctx, url);
  }

  let hostDisabled: McpDocError | undefined;
  try {
    ctx.policy.check(fetchedUrl(url));
  } catch (error) {
    if (!isMcpDocError(error)) throw error;
    // A page of a source may be readable through another capability (typings for a website
    // page), so a switched-off host is decided after the owner is known.
    if (error.code !== 'SOURCE_DISABLED') throw withRecovery(ctx, error, url);
    hostDisabled = error;
  }

  const owner = ctx.registry.ownerOf(url);
  if (owner === undefined) {
    if (hostDisabled !== undefined) throw hostDisabled;
    const location = parseGithubUrl(url.href);
    return location === undefined
      ? { kind: 'generic', url, ...part }
      : { kind: 'github', url, location, ...part };
  }

  // A finer claim inside the product wins: a structured twin, or one directory of a shared repo.
  const { product, line } = owner;
  const claimant = product.sources.find((candidate) => {
    if (candidate.lines !== undefined && !candidate.lines.includes(line.id)) return false;
    const adapter = adapterOf(adapters, candidate);
    return adapter?.owns?.(url, bindSource(product, candidate, line, undefined, budget)) === true;
  });
  const source: SourceDef = claimant ?? owner.source;

  if (
    line.access === 'link-only' &&
    source.capability !== undefined &&
    SITE_CAPABILITIES.has(source.capability)
  ) {
    const typings = product.sources.some((candidate) => candidate.adapter === 'npm-dts');
    throw new McpDocError('LINK_ONLY', `${product.name} ${line.label} pages are not fetched`, {
      why: typings
        ? `This version line is link-only: open the URL directly, or look a symbol up with arcgis_docs_lookup_symbol and "version"`
        : 'This version line is link-only: open the URL directly',
      url: url.href,
      host: url.host,
      next: formatCall(TOOLS.listProducts, { product: product.successor ?? product.id }),
    });
  }
  return {
    kind: 'owned',
    url,
    product,
    source,
    line,
    ...part,
    ...(hostDisabled === undefined ? {} : { hostDisabled }),
  };
}

/** Adds the recovery the catalogue promises when the policy's error carries none. */
function withRecovery(ctx: Ctx, error: McpDocError, url: URL): McpDocError {
  const archived = error.code === 'LINK_ONLY' ? archiveRecovery(url) : undefined;
  if (archived !== undefined) {
    return new McpDocError(error.code, error.message, { ...error.details, next: archived });
  }
  if (error.details?.next !== undefined) return error;
  if (error.code === 'HOST_NOT_ALLOWED') {
    const hosts = ctx.registry
      .hosts()
      .filter((host) => host.capability !== null)
      .map((host) => host.host);
    return new McpDocError(error.code, error.message, {
      ...error.details,
      ...(error.details?.candidates === undefined && hosts.length > 0
        ? { candidates: hosts.slice(0, 12) }
        : {}),
      next: searchFromUrl(url.href),
    });
  }
  if (error.code === 'LINK_ONLY') {
    return new McpDocError(error.code, error.message, {
      ...error.details,
      next: searchFromUrl(url.href),
    });
  }
  return error;
}
