import { ownedPrefix } from '../../src/core/adapter-helpers.js';
import { McpDocError } from '../../src/core/errors.js';
import type { ProductResolution, Registry } from '../../src/core/ports.js';
import { nearest } from '../../src/core/text-distance.js';
import { tokenize } from '../../src/core/tokenize.js';
import type { AnySourceDef, HostPolicy, Product, VersionLine } from '../../src/core/types.js';
import { makeProduct } from './builders.js';

/** A curated brief as `Registry.briefs()` returns it. */
export type Brief = ReturnType<Registry['briefs']>[number];

/** Options of {@link fakeRegistry}. */
export interface FakeRegistryOptions {
  /** Default: one product from `makeProduct()`. */
  products?: Product[];
  hosts?: HostPolicy[];
  briefs?: Brief[];
}

/**
 * A {@link Registry} over a handful of test products. It implements the contract plainly:
 *
 * - `resolve`: exact id, alias or name (case-insensitive), then `product/source`; no fuzzy
 *   matching, so a typo is `UNKNOWN_PRODUCT` with the nearest ids;
 * - `route`: products ranked by the share of query terms found in their id, name, aliases
 *   and keywords (tiers `developer` and `help` only);
 * - `ownerOf`: the longest `ownedPrefix` over every source and line (base URLs narrowed by
 *   the source's filter; repository URLs for `github-repo` and `xmldoc`), first source and
 *   current line winning ties, as the contract states;
 * - `line`: the current line, or the line whose id or label equals the version.
 *
 * The real resolution, routing and ownership rules are WP2's and have their own tests.
 */
export function fakeRegistry(options: FakeRegistryOptions = {}): Registry {
  const products = options.products ?? [makeProduct()];
  const byId = new Map(products.map((product) => [product.id, product]));

  const lookup = (name: string): Product | undefined => {
    const wanted = name.trim().toLowerCase();
    return (
      byId.get(wanted) ??
      products.find(
        (product) =>
          product.name.toLowerCase() === wanted ||
          product.aliases.some((alias) => alias.toLowerCase() === wanted),
      )
    );
  };

  const currentLine = (product: Product): VersionLine => {
    const line = product.lines.find((candidate) => candidate.current) ?? product.lines[0];
    if (line === undefined) throw new Error(`test product ${product.id} has no version line`);
    return line;
  };

  return {
    all: () => products,
    get: (id) => byId.get(id),

    resolve(input): ProductResolution {
      const direct = lookup(input);
      if (direct !== undefined) {
        const how = byId.get(input.trim().toLowerCase()) === direct ? 'id' : 'alias';
        return { product: direct, resolvedFrom: input, how };
      }
      const slash = input.lastIndexOf('/');
      if (slash > 0) {
        const product = lookup(input.slice(0, slash));
        const sourceId = input
          .slice(slash + 1)
          .trim()
          .toLowerCase();
        const source = product?.sources.find((candidate) => candidate.id === sourceId);
        if (product !== undefined && source !== undefined) {
          return { product, source, resolvedFrom: input, how: 'scope' };
        }
      }
      const candidates = nearest(input, [...byId.keys()], 5);
      throw new McpDocError('UNKNOWN_PRODUCT', `No product matches "${input}"`, {
        why: 'The name is not a product id, alias or product/section scope',
        candidates,
      });
    },

    route(query, n = 3) {
      const terms = new Set(tokenize(query));
      if (terms.size === 0) return [];
      return products
        .filter((product) => product.tier !== 'link')
        .map((product) => {
          const vocabulary = new Set(
            tokenize([product.id, product.name, ...product.aliases, ...product.keywords].join(' ')),
          );
          const shared = [...terms].filter((term) => vocabulary.has(term)).length;
          return { product: product.id, confidence: shared / terms.size };
        })
        .filter((entry) => entry.confidence > 0)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, n);
    },

    ownerOf(url) {
      let best:
        { product: Product; source: AnySourceDef; line: VersionLine; length: number } | undefined;
      for (const product of products) {
        // The current line goes first, so that it wins when two lines share a prefix.
        const ordered = [...product.lines].sort((a, b) => Number(b.current) - Number(a.current));
        for (const source of product.sources) {
          for (const line of ordered) {
            if (source.lines !== undefined && !source.lines.includes(line.id)) continue;
            const length = ownedPrefix(source, line, url)?.length;
            // Equal prefixes keep the first source.
            if (length !== undefined && (best === undefined || length > best.length)) {
              best = { product, source, line, length };
            }
          }
        }
      }
      return best === undefined
        ? undefined
        : { product: best.product, source: best.source, line: best.line };
    },

    hosts: () => options.hosts ?? [],

    line(product, version) {
      if (version === undefined) return currentLine(product);
      const wanted = version.trim().toLowerCase();
      const line = product.lines.find(
        (candidate) =>
          candidate.id.toLowerCase() === wanted || candidate.label.toLowerCase() === wanted,
      );
      if (line === undefined) {
        throw new McpDocError(
          'VERSION_UNAVAILABLE',
          `${product.name} has no documentation line "${version}"`,
          {
            why: 'Only the listed version lines have a documentation source',
            candidates: product.lines.map((candidate) => candidate.id),
          },
        );
      }
      return line;
    },

    briefs: () => options.briefs ?? [],
  };
}
