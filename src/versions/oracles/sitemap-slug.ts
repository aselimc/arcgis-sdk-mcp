/**
 * Oracle `sitemap-slug`: the highest version named by a release-notes URL in the product
 * sitemap (`release-notes-for-300-1`, `release-notes-2-4-0`, `release-notes-244`,
 * `2026-07-21`).
 *
 * Options:
 * - `sitemap` (also `url`): default `sitemap-0.xml` next to the product's home page.
 * - `filter`: URL regex; default the product's `releaseNotes.sitemapFilter`, else
 *   `release-notes|whats-new|what-s-new|changelogs`.
 * - `slug`: `compact` when the slug runs the digits together (`244` = 2.4.4).
 */
import type { OracleSpec, Product } from '../../core/types.js';
import {
  RELEASE_NOTES_FILTER,
  compilePattern,
  defaultSitemapUrl,
  readSitemapUrls,
  versionedPages,
} from '../sitemap-versions.js';
import { dateOfVersion, type SlugStyle } from '../version-text.js';
import { defineOracle, option, resolveUrl } from './kit.js';

/** The slug style a spec asks for. */
export function slugStyle(spec: OracleSpec): SlugStyle {
  return option(spec, 'slug', 'style') === 'compact' ? 'compact' : 'auto';
}

/** The URL filter of a spec, falling back to the product's release-notes filter and the general one. */
export function sitemapFilter(product: Product, spec?: OracleSpec): RegExp {
  const configured =
    (spec === undefined ? undefined : option(spec, 'filter')) ??
    product.releaseNotes?.sitemapFilter;
  return (
    (configured === undefined ? undefined : compilePattern(configured)) ??
    new RegExp(RELEASE_NOTES_FILTER, 'i')
  );
}

/** Reads the sitemap and reports the newest versioned release-notes page as the documented version. */
export const sitemapSlugOracle = defineOracle(
  'sitemap-slug',
  'website',
  async (ctx, product, spec, run) => {
    const configured = option(spec, 'sitemap', 'url');
    const sitemap =
      configured === undefined
        ? defaultSitemapUrl(product, run.line)
        : resolveUrl(configured, run.line);
    const urls = await readSitemapUrls(ctx, sitemap, run.call);
    const newest = versionedPages(urls, sitemapFilter(product, spec), slugStyle(spec))[0];
    if (newest === undefined) return [];
    const date = dateOfVersion(newest.version);
    return [
      {
        role: 'documented',
        value: newest.version,
        ...(date === undefined ? {} : { date }),
        oracle: 'sitemap-slug',
        url: newest.url,
      },
    ];
  },
);
