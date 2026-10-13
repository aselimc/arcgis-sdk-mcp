/**
 * Reads the document behind a route. This is where the content ladder of design section 6.6
 * ends: an adapter that cannot reach its upstream is followed by the source's declared
 * fallbacks, and when nothing can be fetched the result is a link-only page, not an error.
 * Errors the agent can act on (not found, disabled, offline, GitHub quota) stay errors.
 */
import { bindSource, humanizeSlug } from '../../core/adapter-helpers.js';
import { isMcpDocError, McpDocError, toMcpDocError } from '../../core/errors.js';
import type {
  AdapterRegistry,
  CallOptions,
  Ctx,
  ReadTarget,
  RenderMeta,
  RenderOptions,
  SectionSelector,
} from '../../core/ports.js';
import type { DocPage, LicenseTier, SourceDef } from '../../core/types.js';
import type { IndexInternals } from '../index/types.js';
import { linkOnlyPage } from './display.js';
import { searchFromUrl, type OwnedRoute, type Route } from './router.js';

/** What a read may narrow or adjust. */
export interface ReadOptions {
  select?: SectionSelector;
  focusedCode?: boolean;
}

/** Reads routed documents. */
export interface PageReader {
  /**
   * @throws McpDocError `DOC_NOT_FOUND`, `SOURCE_DISABLED`, `OFFLINE_MISS`,
   *   `RATE_LIMITED_GITHUB`, `LINK_ONLY`, `HOST_NOT_ALLOWED` or `INTERNAL`. An unreachable or
   *   refusing upstream gives a link-only page instead.
   */
  read(route: Route, call: CallOptions, options?: ReadOptions): Promise<DocPage>;
}

/** Upstream conditions that a lower rung can answer for. */
function isUpstreamFailure(error: unknown): error is McpDocError {
  return (
    isMcpDocError(error) &&
    (error.code === 'UPSTREAM_UNAVAILABLE' || error.code === 'UPSTREAM_BLOCKED')
  );
}

function reasonOf(error: McpDocError): string {
  const why = error.details?.why === undefined ? '' : ` (${error.details.why})`;
  return `${error.message}${why}`;
}

function renderOptions(options: ReadOptions): RenderOptions | undefined {
  return options.select === undefined ? undefined : { select: options.select };
}

/** Creates the reader. */
export function createPageReader(
  ctx: Ctx,
  adapters: AdapterRegistry,
  index: IndexInternals,
): PageReader {
  const titleOf = (url: string): string => index.record(url)?.title ?? (humanizeSlug(url) || url);

  /** Runs a fetch-and-render step for an unregistered page with the shared failure handling. */
  const guarded = async (
    meta: RenderMeta,
    product: string | undefined,
    step: () => Promise<DocPage>,
  ): Promise<DocPage> => {
    try {
      return await step();
    } catch (error) {
      if (isUpstreamFailure(error)) {
        const placeholder = { ...meta, retrievedAt: ctx.clock.iso() };
        return linkOnlyPage(placeholder, titleOf(meta.url), reasonOf(error));
      }
      if (
        isMcpDocError(error) &&
        error.code === 'DOC_NOT_FOUND' &&
        error.details?.next === undefined
      ) {
        throw new McpDocError(error.code, error.message, {
          ...error.details,
          next: searchFromUrl(meta.url, product),
        });
      }
      if (isMcpDocError(error)) throw error;
      ctx.logger.error('document read failed unexpectedly', { url: meta.url, error });
      throw toMcpDocError(error);
    }
  };

  const readOwned = async (
    route: OwnedRoute,
    call: CallOptions,
    options: ReadOptions,
  ): Promise<DocPage> => {
    const { product, line, url } = route;
    const record = index.record(url.href);
    const target: ReadTarget = {
      url,
      ...(options.select === undefined ? {} : { select: options.select }),
      ...(options.focusedCode === true ? { focusedCode: true } : {}),
      ...(record === undefined ? {} : { record }),
    };
    const meta = (source: SourceDef): RenderMeta => ({
      url: url.href,
      product: product.id,
      source: source.id,
      line: line.id,
      kind: record?.kind ?? source.kinds[0] ?? 'guide',
      license: source.license ?? product.licenseTier,
      retrievedAt: ctx.clock.iso(),
    });
    const enabled = (source: SourceDef): boolean =>
      source.capability === undefined || ctx.policy.enabled(source.capability);

    const fallbacks = (route.source.fallbacks ?? [])
      .map((id) => product.sources.find((candidate) => candidate.id === id))
      .filter(
        (candidate): candidate is (typeof product.sources)[number] => candidate !== undefined,
      );
    const primaryUsable = route.hostDisabled === undefined && enabled(route.source);
    const chain: SourceDef[] = [
      ...(primaryUsable ? [route.source] : []),
      ...fallbacks.filter(enabled),
    ];

    let upstream: McpDocError | undefined;
    for (const source of chain) {
      const primary = source === route.source;
      try {
        const adapter = adapters.get(source.adapter);
        const page = await adapter.read(
          ctx,
          bindSource(product, source, line, undefined, call.budget),
          target,
        );
        const filled: DocPage = {
          ...page,
          // The route knows which source answered; a page built by a shared renderer may not.
          product: product.id,
          source: source.id,
          line: page.line ?? line.id,
        };
        if (primary) return filled;
        const because =
          upstream === undefined ? `${route.source.title} is switched off` : reasonOf(upstream);
        return {
          ...filled,
          notices: [
            ...filled.notices,
            `Read from ${source.title} instead of ${route.source.title}: ${because}.`,
          ],
        };
      } catch (error) {
        if (isUpstreamFailure(error)) {
          upstream ??= error;
          continue;
        }
        // A fallback that cannot answer is skipped; only the primary's verdict is the agent's.
        if (!primary) continue;
        if (
          isMcpDocError(error) &&
          error.code === 'DOC_NOT_FOUND' &&
          error.details?.next === undefined
        ) {
          throw new McpDocError(error.code, error.message, {
            ...error.details,
            next: searchFromUrl(url.href, product.id),
          });
        }
        if (isMcpDocError(error)) throw error;
        ctx.logger.error('adapter read failed unexpectedly', {
          url: url.href,
          source: source.id,
          error,
        });
        throw toMcpDocError(error);
      }
    }

    if (upstream !== undefined)
      return linkOnlyPage(meta(route.source), titleOf(url.href), reasonOf(upstream));
    const capability = route.source.capability;
    throw (
      route.hostDisabled ??
      new McpDocError('SOURCE_DISABLED', `${product.name}: ${route.source.title} is switched off`, {
        why: `It needs capability "${capability ?? 'website'}"`,
        next: `Set ARCGIS_DOCS_SOURCES=+${capability ?? 'website'}`,
        url: url.href,
        host: url.host,
        ...(capability === undefined ? {} : { capability }),
      })
    );
  };

  const readGithub = (
    route: Extract<Route, { kind: 'github' }>,
    call: CallOptions,
    options: ReadOptions,
  ): Promise<DocPage> => {
    const { location, url } = route;
    const base = {
      url: url.href,
      kind: 'guide',
      license: 'unlicensed',
    } as const satisfies RenderMeta;
    return guarded(base, undefined, async () => {
      const github = {
        budget: call.budget,
        ...(call.signal === undefined ? {} : { signal: call.signal }),
      };
      if (location.wikiPage !== undefined) {
        const res = await ctx.github.wikiRaw(location.repo, location.wikiPage, github);
        return ctx.render.render(
          'markdown',
          { markdown: res.text },
          { ...base, res },
          renderOptions(options),
        );
      }
      if (location.ref === undefined || location.path === undefined) {
        throw new McpDocError(
          'DOC_NOT_FOUND',
          `${url.href} is a repository or directory, not a file`,
          {
            why: 'Only files and wiki pages can be read',
            url: url.href,
          },
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
        return ctx.render.render('markdown', { markdown: res.text }, meta, renderOptions(options));
      }
      if (/\.ipynb$/i.test(name)) {
        try {
          return ctx.render.render(
            'notebook',
            { ipynb: JSON.parse(res.text) as unknown },
            meta,
            renderOptions(options),
          );
        } catch {
          // Not valid notebook JSON: show it as the source file it is.
        }
      }
      const files = [{ name, text: res.text, ref: url.href }];
      return ctx.render.render(
        'source',
        { files },
        { ...meta, kind: 'sample' },
        renderOptions(options),
      );
    });
  };

  return {
    async read(route, call, options = {}) {
      switch (route.kind) {
        case 'brief': {
          const meta: RenderMeta = {
            url: route.ref,
            kind: 'brief',
            license: 'project',
            retrievedAt: ctx.clock.iso(),
            ...(route.product === undefined ? {} : { product: route.product.id }),
            ...(route.source === undefined ? {} : { source: route.source.id }),
          };
          const page = ctx.render.render(
            'markdown',
            { markdown: route.brief.markdown },
            meta,
            renderOptions(options),
          );
          return page.title === '' ? { ...page, title: route.brief.title } : page;
        }
        case 'owned':
          return readOwned(route, call, options);
        case 'github':
          return readGithub(route, call, options);
        case 'generic': {
          const meta = {
            url: route.url.href,
            kind: 'guide',
            license: 'esri-website-terms',
          } as const satisfies RenderMeta;
          return guarded(meta, undefined, async () => {
            const res = await ctx.http.get({
              url: route.url.href.replace(/#.*$/, ''),
              expect: 'html',
              budget: call.budget,
              ...(call.signal === undefined ? {} : { signal: call.signal }),
            });
            return ctx.render.render(
              'html',
              { html: res.text },
              { ...meta, res },
              renderOptions(options),
            );
          });
        }
      }
    },
  };
}
