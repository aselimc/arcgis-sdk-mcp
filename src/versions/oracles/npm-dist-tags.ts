/**
 * Oracle `npm-dist-tags`: the 60-byte dist-tags document of an npm package. The full
 * packument is megabytes and is never requested, so these facts carry no dates.
 *
 * Options:
 * - `package`: default the product's primary npm package.
 * - `tags`: comma-separated globs of the dist-tags that are a general-availability signal;
 *   default `latest,lts-*`. `latest` alone is not enough: a patch of a long-term support
 *   line can be newer than it (arcgis-rest-js).
 *
 * A tag in that list is reported as `installable`. A tag whose version or name marks a
 * build ahead of a release (`next`, `rc`, `5.2.0-next.145`) is reported as `prerelease`.
 * Any other tag is not a version statement about the product and is left out.
 */
import { matchesAnyGlob } from '../../core/glob.js';
import { isPrerelease } from '../../core/version-key.js';
import type { VersionFact } from '../../core/types.js';
import { asRecord, asText, defineOracle, option, packageOption, requestOptions } from './kit.js';

/** The dist-tags that count as generally available when a spec does not list its own. */
export const DEFAULT_GA_TAGS = 'latest,lts-*';

/** Tags that name builds ahead of a release even when the version string looks stable. */
const PRERELEASE_TAG = /^(?:next|rc|beta|alpha|canary|dev|preview|nightly|experimental)\b/i;

/** Reads `https://registry.npmjs.org/-/package/<pkg>/dist-tags`. */
export const npmDistTagsOracle = defineOracle(
  'npm-dist-tags',
  'registries',
  async (ctx, product, spec, run) => {
    const name = packageOption(product, spec, 'npm');
    if (name === undefined) return [];
    const gaTags = (option(spec, 'tags') ?? DEFAULT_GA_TAGS)
      .split(',')
      .map((glob) => glob.trim())
      .filter((glob) => glob !== '');
    const url = `https://registry.npmjs.org/-/package/${name}/dist-tags`;
    const { data } = await ctx.http.getJson({ url, ttl: 'volatile', ...requestOptions(run) });
    // A package that needs authentication answers with a JSON string, not an object.
    const tags = asRecord(data);
    if (tags === undefined) return [];

    const facts: VersionFact[] = [];
    for (const [tag, raw] of Object.entries(tags)) {
      const value = asText(raw);
      if (value === undefined) continue;
      const ahead = isPrerelease(value) || PRERELEASE_TAG.test(tag);
      if (!ahead && !matchesAnyGlob(tag, gaTags)) continue;
      facts.push({
        role: ahead ? 'prerelease' : 'installable',
        value,
        tag,
        registry: 'npm',
        package: name,
        oracle: 'npm-dist-tags',
        url,
      });
    }
    // `latest` leads so that it is the first evidence a reader sees.
    return facts.sort((a, b) => Number(b.tag === 'latest') - Number(a.tag === 'latest'));
  },
);
