/**
 * Oracle `docesri-sitemap`: `https://doc.esri.com/<slug>/sitemap.xml` is a 700-byte sitemap
 * index whose entries are `https://doc.esri.com/en/<slug>/<version>/sitemap.xml`. The
 * version is that path segment (ArcGIS Pro `3.7`, ArcGIS Enterprise `12.1`).
 *
 * Options: `slug` (default: the slug of the product's first `docfx-esri` source).
 */
import { parseSitemap } from '../../core/sitemap.js';
import type { Product } from '../../core/types.js';
import { maxVersion, parseVersion } from '../../core/version-key.js';
import { defineOracle, option, requestOptions } from './kit.js';

function sourceSlug(product: Product): string | undefined {
  for (const source of product.sources) {
    if (source.adapter === 'docfx-esri') return source.config.slug;
  }
  return undefined;
}

/** Reads the sitemap index of a doc.esri.com product and reports the highest version segment. */
export const docesriSitemapOracle = defineOracle(
  'docesri-sitemap',
  'website',
  async (ctx, product, spec, run) => {
    const slug = option(spec, 'slug', 'product') ?? sourceSlug(product);
    if (slug === undefined) return [];
    const url = `https://doc.esri.com/${slug}/sitemap.xml`;
    const res = await ctx.http.get({ url, expect: 'xml', ttl: 'volatile', ...requestOptions(run) });
    const versions: string[] = [];
    for (const entry of parseSitemap(res.text).entries) {
      const segments = new URL(entry.loc, url).pathname.split('/').filter((part) => part !== '');
      const version = segments[segments.indexOf(slug) + 1];
      // `latest` and locale segments are not versions.
      if (version !== undefined && segments.includes(slug) && parseVersion(version).length > 0) {
        versions.push(version);
      }
    }
    const value = maxVersion(versions);
    if (value === undefined) return [];
    return [{ role: 'documented', value, oracle: 'docesri-sitemap', url }];
  },
);
