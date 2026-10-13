import type { AnySourceDef, Product } from '../../../src/core/types.js';
import { helpProducts } from '../../../src/registry/data/help.generated.js';

/** The generated help product with this id; throws when the import no longer produces it. */
export function helpProduct(id: string): Product {
  const product = helpProducts.find((candidate) => candidate.id === id);
  if (product === undefined) throw new Error(`no help product ${id}`);
  return product;
}

/** The source of a product with this id. */
export function sourceOf(product: Product, id: string): AnySourceDef {
  const source = product.sources.find((candidate) => candidate.id === id);
  if (source === undefined) throw new Error(`no source ${product.id}/${id}`);
  return source;
}

/** The ids of a list of products, in order. */
export const idsOf = (products: readonly Product[]): string[] =>
  products.map((product) => product.id);
