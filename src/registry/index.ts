/**
 * The product registry (design section 4): typed data assembled into the `Registry` port.
 * Pure and synchronous: no I/O, no clock, no configuration. Policy decides what may be
 * fetched; the registry only says what exists and where.
 */
import type { CreateRegistry } from '../core/factories.js';
import type { Product } from '../core/types.js';
import { aiProducts } from './data/ai.js';
import { BRIEFS } from './data/briefs.generated.js';
import { desktopEnterpriseProducts } from './data/desktop-enterprise.js';
import { devopsOssProducts } from './data/devops-oss.js';
import { helpProducts } from './data/help.generated.js';
import { legacyProducts } from './data/legacy.js';
import { nativeProducts } from './data/native.js';
import { pythonProducts } from './data/python.js';
import { restServicesProducts } from './data/rest-services.js';
import { specsProducts } from './data/specs.js';
import { supportProducts } from './data/support.js';
import { webProducts } from './data/web.js';
import { HOSTS } from './hosts.js';
import { createOwnership } from './ownership.js';
import { createResolver, lineOf } from './resolve.js';
import { createRouter } from './router.js';

/**
 * Every product, in listing order: developer products by category, then tombstones, then
 * product help. The order matters twice: ownership ties go to the earlier product, and a
 * derived name (package, repository) shared by two products is left to explicit aliases.
 */
const PRODUCTS: readonly Product[] = [
  ...webProducts,
  ...nativeProducts,
  ...pythonProducts,
  ...desktopEnterpriseProducts,
  ...restServicesProducts,
  ...aiProducts,
  ...supportProducts,
  ...specsProducts,
  ...devopsOssProducts,
  ...legacyProducts,
  ...helpProducts,
];

/**
 * Creates the registry. Lookup tables are built on each call, so the composition root
 * calls it once.
 */
export const createRegistry: CreateRegistry = () => {
  const byId = new Map(PRODUCTS.map((product) => [product.id, product]));
  const route = createRouter(PRODUCTS);
  // Suggestions for a product name that resolved to nothing come from the words of that
  // name alone: the router's default set would "suggest" the same three products for any typo.
  const suggest = createRouter(PRODUCTS, { fallback: false });
  const resolver = createResolver(PRODUCTS, (text, n) =>
    suggest(text, n).map((entry) => entry.product),
  );
  const ownerOf = createOwnership(PRODUCTS);

  return {
    all: () => PRODUCTS,
    get: (id) => byId.get(id),
    resolve: (input) => resolver.resolve(input),
    route,
    ownerOf,
    hosts: () => HOSTS,
    line: lineOf,
    // A fresh array of fresh objects: callers may sort or annotate what they get.
    briefs: () => BRIEFS.map((brief) => ({ ...brief, sources: [...brief.sources] })),
  };
};
