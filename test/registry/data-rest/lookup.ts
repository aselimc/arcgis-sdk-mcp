import { ownedPrefix } from '../../../src/core/adapter-helpers.js';
import type { AnySourceDef, Product } from '../../../src/core/types.js';
import { aiProducts } from '../../../src/registry/data/ai.js';
import { devopsOssProducts } from '../../../src/registry/data/devops-oss.js';
import { legacyProducts } from '../../../src/registry/data/legacy.js';
import { restServicesProducts } from '../../../src/registry/data/rest-services.js';
import { specsProducts } from '../../../src/registry/data/specs.js';
import { supportProducts } from '../../../src/registry/data/support.js';

/** The developer-tier products of design section 4.5, in the order of the design. */
export const ALL: readonly Product[] = [
  ...restServicesProducts,
  ...aiProducts,
  ...supportProducts,
  ...specsProducts,
  ...devopsOssProducts,
  ...legacyProducts,
];

/** The product of section 4.5 with this id. */
export function byId(id: string): Product {
  const product = ALL.find((candidate) => candidate.id === id);
  if (product === undefined) throw new Error(`no product ${id}`);
  return product;
}

/** The source of a product with this id. */
export function sourceOf(product: Product, id: string): AnySourceDef {
  const source = product.sources.find((candidate) => candidate.id === id);
  if (source === undefined) throw new Error(`no source ${product.id}/${id}`);
  return source;
}

/** The source of `product` that owns `url` by the longest prefix, as the registry decides it. */
export function ownerOf(product: Product, url: string): string | undefined {
  const [line] = product.lines;
  let best: { id: string; length: number } | undefined;
  for (const source of product.sources) {
    const prefix = line === undefined ? undefined : ownedPrefix(source, line, url);
    if (prefix !== undefined && prefix.length > (best?.length ?? 0)) {
      best = { id: source.id, length: prefix.length };
    }
  }
  return best?.id;
}
