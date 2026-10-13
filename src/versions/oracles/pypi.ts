/**
 * Oracle `pypi`: the JSON API of the Python Package Index. `info.version` is PyPI's own
 * "latest stable" and therefore a general-availability signal.
 *
 * Options: `package` (default: the product's primary PyPI package).
 */
import { parseDate } from '../version-text.js';
import { asRecord, asText, defineOracle, packageOption, requestOptions } from './kit.js';

/** Upload time of the first file of a release, from `releases[version]` or the top-level `urls`. */
function uploadDate(body: Record<string, unknown>, version: string): string | undefined {
  const files = asRecord(body.releases)?.[version] ?? body.urls;
  if (!Array.isArray(files)) return undefined;
  const first = asRecord(files[0]);
  return parseDate(asText(first?.upload_time_iso_8601) ?? asText(first?.upload_time));
}

/** Reads `https://pypi.org/pypi/<pkg>/json`. */
export const pypiOracle = defineOracle('pypi', 'registries', async (ctx, product, spec, run) => {
  const name = packageOption(product, spec, 'pypi');
  if (name === undefined) return [];
  const url = `https://pypi.org/pypi/${name}/json`;
  const { data } = await ctx.http.getJson({ url, ttl: 'volatile', ...requestOptions(run) });
  const body = asRecord(data);
  const value = asText(asRecord(body?.info)?.version);
  if (body === undefined || value === undefined) return [];
  const date = uploadDate(body, value);
  return [
    {
      role: 'installable',
      value,
      ...(date === undefined ? {} : { date }),
      registry: 'pypi',
      package: name,
      oracle: 'pypi',
      url,
    },
  ];
});
