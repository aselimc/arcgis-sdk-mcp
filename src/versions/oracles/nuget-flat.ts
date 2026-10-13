/**
 * Oracle `nuget-flat`: the flat-container version list of a NuGet package. The list has no
 * "latest" marker, so the general-availability signal is "highest version that is not a
 * pre-release"; it has no dates either.
 *
 * Options: `id` (default: the product's primary NuGet package).
 */
import { isPrerelease, maxVersion } from '../../core/version-key.js';
import type { VersionFact } from '../../core/types.js';
import { belongsToLine } from '../version-text.js';
import { asRecord, asText, defineOracle, packageOption, requestOptions } from './kit.js';

/** Reads `https://api.nuget.org/v3-flatcontainer/<id>/index.json`. */
export const nugetFlatOracle = defineOracle(
  'nuget-flat',
  'registries',
  async (ctx, product, spec, run) => {
    const name = packageOption(product, spec, 'nuget', 'id');
    if (name === undefined) return [];
    // The flat container addresses packages by their lower-cased id.
    const url = `https://api.nuget.org/v3-flatcontainer/${name.toLowerCase()}/index.json`;
    const { data } = await ctx.http.getJson({ url, ttl: 'volatile', ...requestOptions(run) });
    const listed = asRecord(data)?.versions;
    if (!Array.isArray(listed)) return [];
    const stable = listed
      .map((entry) => asText(entry))
      .filter((entry): entry is string => entry !== undefined && !isPrerelease(entry));

    const fact = (value: string): VersionFact => ({
      role: 'installable',
      value,
      registry: 'nuget',
      package: name,
      oracle: 'nuget-flat',
      url,
    });
    const newest = maxVersion(stable);
    if (newest === undefined) return [];
    const facts = [fact(newest)];
    // One package serves every supported line (300.x and 200.x LTS): report each line's newest.
    for (const line of product.lines) {
      const inLine = maxVersion(stable.filter((entry) => belongsToLine(entry, line)));
      if (inLine !== undefined && !facts.some((known) => known.value === inLine)) {
        facts.push(fact(inLine));
      }
    }
    return facts;
  },
);
