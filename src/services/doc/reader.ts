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
} from '../../core/ports.js';
import type { DocPage, SourceDef } from '../../core/types.js';
import { parseGithubUrl } from '../../core/url.js';
import type { IndexInternals } from '../index/types.js';
import { linkOnlyPage } from './display.js';
import { isCommitRef, verifyCommit } from './github-ref.js';
import { routeRef, type OwnedRoute, type Route } from './router.js';
import {
  createUnownedReader,
  isUpstreamFailure,
  reasonOf,
  renderOptions,
  withSearch,
  type ReadOptions,
} from './unowned.js';

/** Reads routed documents. */
export interface PageReader {
  /**
   * @throws McpDocError `DOC_NOT_FOUND`, `SOURCE_DISABLED`, `OFFLINE_MISS`,
   *   `RATE_LIMITED_GITHUB`, `LINK_ONLY`, `HOST_NOT_ALLOWED` or `INTERNAL`. An unreachable or
   *   refusing upstream gives a link-only page instead.
   */
  read(route: Route, call: CallOptions, options?: ReadOptions): Promise<DocPage>;
}

/** Creates the reader. */
export function createPageReader(
  ctx: Ctx,
  adapters: AdapterRegistry,
  index: IndexInternals,
): PageReader {
  const titleOf = (url: string): string => index.record(url)?.title ?? (humanizeSlug(url) || url);
  const unowned = createUnownedReader(ctx, titleOf);

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
    const enabled = (source: SourceDef): boolean =>
      source.capability === undefined || ctx.policy.enabled(source.capability);

    const fallbacks = (route.source.fallbacks ?? [])
      .map((id) => product.sources.find((candidate) => candidate.id === id))
      .filter((candidate) => candidate !== undefined);
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
        const bound = bindSource(product, source, line, undefined, call.budget);
        const page = await adapter.read(ctx, bound, target);
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
        const notice = `Read from ${source.title} instead of ${route.source.title}: ${because}.`;
        return { ...filled, notices: [...filled.notices, notice] };
      } catch (error) {
        if (isUpstreamFailure(error)) {
          upstream ??= error;
          continue;
        }
        // A fallback that cannot answer is skipped; only the primary's verdict is the agent's.
        if (!primary) continue;
        if (isMcpDocError(error)) throw withSearch(error, url.href, product.id);
        ctx.logger.error('adapter read failed unexpectedly', {
          url: url.href,
          source: source.id,
          error,
        });
        throw toMcpDocError(error);
      }
    }

    if (upstream !== undefined) {
      const meta: RenderMeta = {
        url: url.href,
        product: product.id,
        source: route.source.id,
        line: line.id,
        kind: record?.kind ?? route.source.kinds[0] ?? 'guide',
        license: route.source.license ?? product.licenseTier,
        retrievedAt: ctx.clock.iso(),
      };
      return linkOnlyPage(meta, titleOf(url.href), reasonOf(upstream));
    }
    const capability = route.source.capability ?? 'website';
    throw (
      route.hostDisabled ??
      new McpDocError('SOURCE_DISABLED', `${product.name}: ${route.source.title} is switched off`, {
        why: `It needs capability "${capability}"`,
        next: `Set ARCGIS_DOCS_SOURCES=+${capability}`,
        url: url.href,
        host: url.host,
        capability,
      })
    );
  };

  /**
   * Refuses a GitHub commit that is not known to be the repository owner's own. A ref this
   * server put into a catalogue record itself needs no check.
   */
  const vetCommit = async (url: URL, call: CallOptions): Promise<void> => {
    const location = parseGithubUrl(url.href);
    if (location === undefined || !isCommitRef(location)) return;
    if (index.record(url.href) !== undefined) return;
    await verifyCommit(ctx, url, location, call);
  };

  /** The page a redirect led to, read through the source that owns it; `undefined` when none does. */
  const reroute = async (
    url: string,
    call: CallOptions,
    options: ReadOptions,
  ): Promise<DocPage | undefined> => {
    let route: Route;
    try {
      route = routeRef(ctx, adapters, url, call.budget);
    } catch {
      // The target cannot be read as a page of its own; it is shown as what was fetched.
      return undefined;
    }
    return route.kind === 'owned' ? readOwned(route, call, options) : undefined;
  };

  return {
    async read(route, call, options = {}) {
      if (route.kind === 'owned' || route.kind === 'github') await vetCommit(route.url, call);
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
          const input = { markdown: route.brief.markdown };
          const page = ctx.render.render('markdown', input, meta, renderOptions(options));
          return page.title === '' ? { ...page, title: route.brief.title } : page;
        }
        case 'owned':
          return readOwned(route, call, options);
        case 'github':
          return unowned.github(route, call, options);
        case 'generic':
          return unowned.generic(route, call, options, (url) => reroute(url, call, options));
      }
    },
  };
}
