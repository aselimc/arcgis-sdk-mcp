/**
 * What an adapter needs to know about the source it is bound to before it sends a request:
 * its absolute URLs, its licence tier, its request budget, and whether its version line and
 * the capabilities in force allow the request at all.
 */
import { McpDocError } from '../../core/errors.js';
import { DEVELOPERS_ORIGIN } from '../../core/names.js';
import type { BoundSource, Ctx, HttpRequest } from '../../core/ports.js';
import { expandTemplate } from '../../core/source-urls.js';
import type { LicenseTier } from '../../core/types.js';

/**
 * Makes a registry URL absolute for a bound source: line variables are substituted, a full
 * URL is kept, a path starting with `/` belongs to developers.arcgis.com, and anything else
 * is relative to the source root.
 */
export function absoluteUrl(value: string, src: BoundSource): string {
  const expanded = expandTemplate(value, src.line);
  if (/^https?:\/\//i.test(expanded)) return expanded;
  return expanded.startsWith('/') ? `${DEVELOPERS_ORIGIN}${expanded}` : src.url(expanded);
}

/** The licence tier of a source's content: its own, else the product default. */
export function licenseOf(src: BoundSource): LicenseTier {
  return src.source.license ?? src.product.licenseTier;
}

/** The `budget` property of a request, present only when the source is bound to one. */
export function budgetOf(src: BoundSource): Pick<HttpRequest, 'budget'> {
  return src.budget === undefined ? {} : { budget: src.budget };
}

/**
 * Refuses to fetch for a `link-only` version line: its pages live on a host that is never
 * requested, so the answer is the link itself.
 *
 * @throws McpDocError `LINK_ONLY` with the URL in `details.url`.
 */
export function assertLive(src: BoundSource, url: string): void {
  if (src.line.access !== 'link-only') return;
  throw new McpDocError('LINK_ONLY', `${src.product.name} ${src.line.label} is not fetched`, {
    why: `Documentation of version line "${src.line.id}" is available as a link only`,
    url,
    host: new URL(url).host,
  });
}

/** The request for one site-published index file of a source. */
export function indexRequest(
  src: BoundSource,
  url: string,
  expect: HttpRequest['expect'],
): HttpRequest {
  return { url, expect, ttl: 'index', ...budgetOf(src) };
}

/**
 * Whether site-published index files may be requested. An adapter with no rung below its
 * index file enumerates nothing while `site-index` is off, which is logged here.
 */
export function siteIndexEnabled(ctx: Ctx, src: BoundSource): boolean {
  if (ctx.policy.enabled('site-index')) return true;
  ctx.logger.info('Capability "site-index" is off; the source is not enumerated', {
    product: src.product.id,
    source: src.source.id,
  });
  return false;
}
