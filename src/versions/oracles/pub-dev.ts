/**
 * Oracle `pub-dev`: the pub.dev package API. `latest` is the newest stable version; its
 * `+build` suffix is not part of the release number and is removed.
 *
 * Options: `package` (default: the product's primary pub package).
 */
import { normalizeVersion, parseDate } from '../version-text.js';
import { asRecord, asText, defineOracle, packageOption, requestOptions } from './kit.js';

/** Reads `https://pub.dev/api/packages/<pkg>`. */
export const pubDevOracle = defineOracle(
  'pub-dev',
  'registries',
  async (ctx, product, spec, run) => {
    const name = packageOption(product, spec, 'pub');
    if (name === undefined) return [];
    const url = `https://pub.dev/api/packages/${name}`;
    const { data } = await ctx.http.getJson({ url, ttl: 'volatile', ...requestOptions(run) });
    const latest = asRecord(asRecord(data)?.latest);
    const raw = asText(latest?.version);
    if (raw === undefined) return [];
    const date = parseDate(asText(latest?.published));
    return [
      {
        role: 'installable',
        value: normalizeVersion(raw),
        ...(date === undefined ? {} : { date }),
        registry: 'pub',
        package: name,
        oracle: 'pub-dev',
        url,
      },
    ];
  },
);
