/**
 * Oracle `static`: values written in the registry, for products that no longer change
 * (a deprecated SDK's final release, a retired product). It issues no request. The report
 * labels the version "as of" the product's `verifiedOn` date, which is rung three of the
 * version ladder.
 *
 * Options:
 * - `version`: default the first version number in the product's
 *   `statusNote` ("Final release 200.6").
 * - `ga`, `mature`, `retirement`: ISO dates of the life-cycle phases, when the registry
 *   author verified them on Esri's life-cycle page.
 * - `url`: where the values were verified; default the product's home page.
 */
import type { VersionFact } from '../../core/types.js';
import { parseDate } from '../version-text.js';
import { defineOracle, option, resolveUrl } from './kit.js';

/** Reports the registry values: the documented version and any life-cycle dates. */
export const staticOracle = defineOracle('static', undefined, (_ctx, product, spec, run) => {
  const url = resolveUrl(option(spec, 'url') ?? product.homepage, run.line);
  const facts: VersionFact[] = [];
  const value = option(spec, 'version') ?? /\d+(?:\.\d+)+/.exec(product.statusNote ?? '')?.[0];
  if (value !== undefined) facts.push({ role: 'documented', value, oracle: 'static', url });
  for (const tag of ['ga', 'mature', 'retirement'] as const) {
    const date = parseDate(option(spec, tag));
    if (date !== undefined) {
      facts.push({ role: 'lifecycle', value: date, date, tag, oracle: 'static', url });
    }
  }
  return Promise.resolve(facts);
});
