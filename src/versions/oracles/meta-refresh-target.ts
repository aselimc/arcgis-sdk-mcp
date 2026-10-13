/**
 * Oracle `meta-refresh-target`: `/<sdk>/release-notes/` is a 100-byte stub that answers 200
 * and points, through `<meta http-equiv="refresh">`, at the release notes of the current
 * version. The target URL names that version.
 *
 * Options: `url` (default the product's `releaseNotes.current`, else `release-notes/` under
 * its home page); `slug`: `compact` for run-together digits.
 */
import { defineOracle, homeUrl, lineUrl, requestOptions, urlOption } from './kit.js';
import { slugStyle } from './sitemap-slug.js';
import { dateOfVersion, versionFromUrl } from '../version-text.js';

/** Follows the stub and reads the version from where it leads. */
export const metaRefreshTargetOracle = defineOracle(
  'meta-refresh-target',
  'website',
  async (ctx, product, spec, run) => {
    const configured = product.releaseNotes?.current;
    const url =
      urlOption(spec, product, run.line) ??
      (configured === undefined
        ? new URL('release-notes/', homeUrl(product, run.line)).href
        : lineUrl(configured, product, run.line));
    const res = await ctx.http.get({
      url,
      expect: 'html',
      ttl: 'volatile',
      ...requestOptions(run),
    });
    // The gateway follows the hop and reports it in `finalUrl`; a client that did not is
    // handled by reading the stub here.
    const target =
      res.finalUrl !== res.url
        ? res.finalUrl
        : (ctx.render.detectMetaRefresh(res.text, res.finalUrl) ?? res.finalUrl);
    const value = versionFromUrl(target, slugStyle(spec));
    // The stub's own URL carries no version: without a hop there is nothing to report.
    if (value === undefined || target === url) return [];
    const date = dateOfVersion(value);
    return [
      {
        role: 'documented',
        value,
        ...(date === undefined ? {} : { date }),
        oracle: 'meta-refresh-target',
        url: target,
      },
    ];
  },
);
