import { checkRegistry } from '../../scripts/registry-check.js';
import type { Product } from '../../src/core/types.js';
import { createRegistry } from '../../src/registry/index.js';

/**
 * The registry as the server ships it, for the data-driven tests. It is imported statically:
 * a data file that is missing or fails to load fails every test that uses it, instead of
 * being counted as "not there yet".
 */
const registry = createRegistry();

/** Every product, in listing order. */
export const PRODUCTS: readonly Product[] = registry.all();

/** Every curated brief. */
export const BRIEFS = registry.briefs();

/** One day after the date the registry was last verified, so nothing is stale. */
export const TODAY = new Date('2026-10-14T00:00:00Z');

/** The product with this id; throws when the registry no longer has it. */
export function productById(id: string): Product {
  const product = registry.get(id);
  if (product === undefined) throw new Error(`the registry has no product ${id}`);
  return product;
}

/**
 * What the registry lint (`npm run registry:check`) says about some of the products, as
 * `RULE product: message` lines. The lint runs over the whole registry, so references to
 * products outside the subset resolve as they do in the server; only the findings about
 * `products` are returned.
 */
export function lintOf(products: readonly Product[]): string[] {
  const ids = new Set(products.map((product) => product.id));
  return checkRegistry({ products: PRODUCTS, hosts: registry.hosts(), briefs: BRIEFS }, TODAY)
    .filter((issue) => ids.has(issue.product))
    .map((issue) => `${issue.rule} ${issue.product}: ${issue.message}`);
}
