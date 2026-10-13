/**
 * Oracle `agol-rest-info`: the 27-byte root document of the ArcGIS Online sharing API, whose
 * `currentVersion` (`2026.2`) is the release ArcGIS Online is running.
 *
 * Options: `url` (default `https://www.arcgis.com/sharing/rest?f=json`).
 */
import { asRecord, asText, defineOracle, option, requestOptions } from './kit.js';

/** The public sharing API root of ArcGIS Online. */
export const AGOL_REST_INFO_URL = 'https://www.arcgis.com/sharing/rest?f=json';

/** Reads `currentVersion` from the sharing API root. */
export const agolRestInfoOracle = defineOracle(
  'agol-rest-info',
  'registries',
  async (ctx, _product, spec, run) => {
    const url = option(spec, 'url') ?? AGOL_REST_INFO_URL;
    const { data } = await ctx.http.getJson({ url, ttl: 'volatile', ...requestOptions(run) });
    const current = asRecord(data)?.currentVersion;
    // The service has answered with a number as well as a string over the years.
    const value = typeof current === 'number' ? String(current) : asText(current);
    if (value === undefined) return [];
    return [{ role: 'documented', value, oracle: 'agol-rest-info', url }];
  },
);
