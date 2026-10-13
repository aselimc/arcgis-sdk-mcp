/**
 * The `Source:` line that closes every result built from retrieved content (design section
 * 3.1). The wording per licence tier is fixed here so that no presenter can vary or omit it.
 */
import type { CacheState, LicenseTier } from './types.js';

/** Esri's legal overview page, cited on website content. */
export const ESRI_TERMS_URL = 'https://www.esri.com/en-us/legal/overview';

/** Facts about the content being attributed. */
export interface AttributionInput {
  /** Canonical URL of the content (the github.com URL for repository files). */
  url: string;
  /** ISO timestamp or date of retrieval. */
  retrievedAt: string;
  cache: CacheState;
  /** Tier `esri-ma`: the npm package the content was read from. */
  packageName?: string;
  /** Tier `esri-ma`: the exact package version. */
  version?: string;
  /** Tier `cc-by-nd`: the name of the specification. */
  specName?: string;
}

function retrieval(input: AttributionInput): string {
  const date = input.retrievedAt.slice(0, 10);
  // Anything not fetched for this call is "cached"; a copy past its freshness is also "stale".
  const cached = input.cache === 'miss' ? '' : ', cached';
  const stale = input.cache === 'stale' ? ', stale' : '';
  return `(retrieved ${date}${cached}${stale})`;
}

/**
 * Builds the attribution line for a licence tier.
 *
 * Only the website tier states the retrieval date and cache state, as in the design; for
 * the other tiers `retrievedAt` and `cache` are accepted and unused, so callers can pass the
 * same input for every tier.
 *
 * @returns one line without a trailing newline, or an empty string for tier `project`
 *   (catalog data and curated briefs, which are this project's own work).
 */
export function attribution(tier: LicenseTier, input: AttributionInput): string {
  switch (tier) {
    case 'esri-website-terms':
      return `Source: Esri, ${input.url} ${retrieval(input)}. Copyright (c) Esri. Use subject to Esri's terms: ${ESRI_TERMS_URL}`;
    case 'apache-2.0':
      return `Copyright Esri. Licensed under the Apache License, Version 2.0. Source: ${input.url}`;
    case 'esri-ma': {
      // Without a package name (a repository file under the same licence) the URL identifies it.
      const origin =
        input.packageName === undefined
          ? input.url
          : [input.packageName, input.version].filter((part) => part !== undefined).join(' ');
      return `From ${origin}. Copyright Esri. Licensed under the Esri Master License Agreement.`;
    }
    case 'cc-by-nd':
      return `${input.specName ?? 'Esri specification'}, Copyright Esri, CC BY-ND, ${input.url}`;
    case 'unlicensed':
      return `Source: ${input.url}. Copyright Esri / respective authors.`;
    case 'project':
      return '';
  }
}
