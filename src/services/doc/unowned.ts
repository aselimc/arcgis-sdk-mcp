/**
 * Reads documents that no registered source owns: any page on an allow-listed host through
 * the generic HTML path, and files or wiki pages of an allowed GitHub owner. Both end on the
 * same last rung as registered pages: a link-only page when the upstream cannot be reached.
 */
import { isMcpDocError, McpDocError, toMcpDocError } from '../../core/errors.js';
import type {
  CallOptions,
  Ctx,
  RenderMeta,
  RenderOptions,
  SectionSelector,
} from '../../core/ports.js';
import type { DocPage, LicenseTier } from '../../core/types.js';
import { linkOnlyPage } from './display.js';
import { searchFromUrl, type Route } from './router.js';

/** What a read may narrow or adjust. */
export interface ReadOptions {
  select?: SectionSelector;
  focusedCode?: boolean;
}

/** Upstream conditions that a lower rung can answer for. */
export function isUpstreamFailure(error: unknown): error is McpDocError {
  return (
    isMcpDocError(error) &&
    (error.code === 'UPSTREAM_UNAVAILABLE' || error.code === 'UPSTREAM_BLOCKED')
  );
}

/** The message of an error with its cause, for notices and link-only pages. */
export function reasonOf(error: McpDocError): string {
  const why = error.details?.why === undefined ? '' : ` (${error.details.why})`;
  return `${error.message}${why}`;
}

/** The renderer options that carry a read's selector. */
export function renderOptions(options: ReadOptions): RenderOptions | undefined {
  return options.select === undefined ? undefined : { select: options.select };
}

/** `DOC_NOT_FOUND` with a search built from the URL when the error names no recovery. */
export function withSearch(error: McpDocError, url: string, product?: string): McpDocError {
  if (error.code !== 'DOC_NOT_FOUND' || error.details?.next !== undefined) return error;
  return new McpDocError(error.code, error.message, {
    ...error.details,
    next: searchFromUrl(url, product),
  });
}

function segmentsOf(url: string): string[] {
  try {
    return new URL(url).pathname.split('/').filter((segment) => segment !== '');
  } catch {
    return [];
  }
}

/** True when two URLs are the same page but for a trailing slash or the case of the host. */
function samePage(a: string, b: string): boolean {
  const key = (url: string): string => url.replace(/\/+$/, '').toLowerCase();
  return a === b || key(a) === key(b);
}

/**
 * True when a redirect led from a page to a page higher up that does not carry its name:
 * `/javascript/3/jsapi/featurelayer-amd.html` to `/javascript/latest/`. Sites retire pages
 * this way instead of answering 404, and the entry page is not the document asked for. A
 * move (`/old-name/` to `/new-name/`, or to a deeper path) keeps or adds depth.
 */
export function leftForEntryPage(requested: string, landed: string): boolean {
  const from = segmentsOf(requested);
  const to = segmentsOf(landed);
  if (to.length >= from.length) return false;
  const slug = (from.at(-1) ?? '').replace(/\.[a-z0-9]+$/i, '').toLowerCase();
  return slug === '' || !to.some((segment) => segment.toLowerCase().includes(slug));
}

/** `DOC_NOT_FOUND` for a page that only redirects to an entry page. */
function movedAway(ctx: Ctx, requested: string, landed: string): McpDocError {
  let product: string | undefined;
  try {
    product = ctx.registry.ownerOf(new URL(landed))?.product.id;
  } catch {
    product = undefined;
  }
  return new McpDocError('DOC_NOT_FOUND', `${requested} no longer exists`, {
    why: `It redirects to ${landed}, an entry page that is not this document`,
    url: requested,
    next: searchFromUrl(requested, product),
  });
}

/** Reads pages outside the registry. */
export interface UnownedReader {
  /**
   * @param reroute reads the page a redirect led to through the source that owns it;
   *   `undefined` when no source does.
   */
  generic(
    route: Extract<Route, { kind: 'generic' }>,
    call: CallOptions,
    options: ReadOptions,
    reroute?: (url: string) => Promise<DocPage | undefined>,
  ): Promise<DocPage>;
  github(
    route: Extract<Route, { kind: 'github' }>,
    call: CallOptions,
    options: ReadOptions,
  ): Promise<DocPage>;
}

/**
 * Creates the reader.
 *
 * @param titleOf the best known title of a URL, for link-only pages.
 */
export function createUnownedReader(ctx: Ctx, titleOf: (url: string) => string): UnownedReader {
  /** Runs a fetch-and-render step with the failure handling both paths share. */
  const guarded = async (meta: RenderMeta, step: () => Promise<DocPage>): Promise<DocPage> => {
    try {
      return await step();
    } catch (error) {
      if (isUpstreamFailure(error)) {
        const placeholder = { ...meta, retrievedAt: ctx.clock.iso() };
        return linkOnlyPage(placeholder, titleOf(meta.url), reasonOf(error));
      }
      if (isMcpDocError(error)) throw withSearch(error, meta.url);
      ctx.logger.error('document read failed unexpectedly', { url: meta.url, error });
      throw toMcpDocError(error);
    }
  };

  return {
    generic(route, call, options, reroute) {
      // A file on a package CDN is under its package's licence (calcite and Esri Leaflet are
      // Apache-2.0), not Esri's website terms; it is cited neutrally.
      const cdn = ctx.registry
        .hosts()
        .some((host) => host.host === route.url.host && host.capability === 'package-cdn');
      const meta = {
        url: route.url.href,
        kind: 'guide',
        license: cdn ? 'unlicensed' : 'esri-website-terms',
      } as const satisfies RenderMeta;
      return guarded(meta, async () => {
        const requested = route.url.href.replace(/#.*$/, '');
        const res = await ctx.http.get({
          url: requested,
          expect: 'html',
          budget: call.budget,
          ...(call.signal === undefined ? {} : { signal: call.signal }),
        });
        const landed = res.finalUrl.replace(/#.*$/, '');
        if (samePage(requested, landed)) {
          return ctx.render.render(
            'html',
            { html: res.text },
            { ...meta, res },
            renderOptions(options),
          );
        }
        // The page that answered is another one. What is returned must be cited as that
        // page, and a redirect to an entry page is the site's way of saying "gone".
        if (leftForEntryPage(requested, landed)) throw movedAway(ctx, requested, landed);
        const target = `${landed}${route.url.hash}`;
        const from = [...new Set([requested, ...res.aliasChain])].filter((hop) => hop !== landed);
        const owned = await reroute?.(target);
        if (owned !== undefined) {
          return { ...owned, redirectedFrom: [...from, ...owned.redirectedFrom] };
        }
        const page = ctx.render.render(
          'html',
          { html: res.text },
          { ...meta, url: target, res },
          renderOptions(options),
        );
        return { ...page, redirectedFrom: from };
      });
    },

    github(route, call, options) {
      const { location, url } = route;
      const base = {
        url: url.href,
        kind: 'guide',
        license: 'unlicensed',
      } as const satisfies RenderMeta;
      const select = renderOptions(options);
      return guarded(base, async () => {
        const github = {
          budget: call.budget,
          ...(call.signal === undefined ? {} : { signal: call.signal }),
        };
        if (location.wikiPage !== undefined) {
          const res = await ctx.github.wikiRaw(location.repo, location.wikiPage, github);
          return ctx.render.render('markdown', { markdown: res.text }, { ...base, res }, select);
        }
        if (location.ref === undefined || location.path === undefined) {
          throw new McpDocError(
            'DOC_NOT_FOUND',
            `${url.href} is a repository or directory, not a file`,
            { why: 'Only files and wiki pages can be read', url: url.href },
          );
        }
        const res = await ctx.github.raw(location.repo, location.ref, location.path, github);
        let license: LicenseTier = 'unlicensed';
        try {
          license = (await ctx.github.repoMeta(location.repo, github)).license;
        } catch (error) {
          // The file is readable without its licence; it is then attributed conservatively.
          ctx.logger.debug('repository licence unknown', { repo: location.repo, error });
        }
        const meta: RenderMeta = { ...base, license, res };
        const name = location.path.split('/').at(-1) ?? location.path;
        if (/\.(?:md|markdown|mdx)$/i.test(name)) {
          return ctx.render.render('markdown', { markdown: res.text }, meta, select);
        }
        if (/\.ipynb$/i.test(name)) {
          try {
            const ipynb = JSON.parse(res.text) as unknown;
            return ctx.render.render('notebook', { ipynb }, meta, select);
          } catch {
            // Not valid notebook JSON: show it as the source file it is.
          }
        }
        const files = [{ name, text: res.text, ref: url.href }];
        return ctx.render.render('source', { files }, { ...meta, kind: 'sample' }, select);
      });
    },
  };
}
