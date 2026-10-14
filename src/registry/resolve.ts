/**
 * Resolution of the free-form `product` argument and of a version to a
 * documentation line.
 *
 * Order: exact id; alias (names, abbreviations, package and repository names); the scope
 * form `product/source`; the same comparisons ignoring punctuation and spacing; then fuzzy
 * matching, which is accepted only when one product is clearly ahead of every other.
 */
import { formatCall } from '../core/budget.js';
import { McpDocError } from '../core/errors.js';
import { TOOLS } from '../core/names.js';
import type { ProductResolution } from '../core/ports.js';
import { levenshtein, nearest } from '../core/text-distance.js';
import type { AnySourceDef, Product, VersionLine } from '../core/types.js';

/** How many candidates an `UNKNOWN_PRODUCT` error carries. */
const MAX_CANDIDATES = 5;

/** Lower-case, trimmed, without surrounding quotes, inner whitespace collapsed. */
export function plainKey(text: string): string {
  return text
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Letters and digits only, so `JS Maps SDK`, `js_maps_sdk` and `js-maps-sdk` are one key. */
export function squashedKey(text: string): string {
  return plainKey(text).replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Words of a name: runs of letters and digits. */
function words(text: string): string[] {
  return plainKey(text).match(/[\p{L}\p{N}]+/gu) ?? [];
}

type Match = Pick<ProductResolution, 'product' | 'how'>;

/** Strength of a name: an id beats an alias, which beats a derived package or repository name. */
const RANK = { id: 0, alias: 1, derived: 2 } as const;

interface Named {
  /** `undefined` when two products claim the key at this rank: it then belongs to neither. */
  product: Product | undefined;
  rank: (typeof RANK)[keyof typeof RANK];
}

/**
 * A name table. A stronger claim replaces a weaker one; two products with equally strong
 * claims make the key ambiguous at that strength, which only a stronger claim resolves.
 */
class NameTable {
  private readonly entries = new Map<string, Named>();

  add(key: string, product: Product, rank: Named['rank']): void {
    if (key === '') return;
    const existing = this.entries.get(key);
    if (existing === undefined || rank < existing.rank) {
      this.entries.set(key, { product, rank });
    } else if (rank === existing.rank && existing.product !== product) {
      existing.product = undefined;
    }
  }

  get(key: string): Match | undefined {
    const entry = this.entries.get(key);
    if (entry?.product === undefined) return undefined;
    return { product: entry.product, how: entry.rank === RANK.id ? 'id' : 'alias' };
  }

  /** Every unambiguous key with its product. */
  *all(): Iterable<[string, Product]> {
    for (const [key, entry] of this.entries) {
      if (entry.product !== undefined) yield [key, entry.product];
    }
  }
}

/** Every name a product answers to, with its strength. */
function namesOf(product: Product): Array<[string, Named['rank']]> {
  return [
    [product.id, RANK.id],
    [product.name, RANK.alias],
    ...product.aliases.map((alias): [string, Named['rank']] => [alias, RANK.alias]),
    ...product.packages.map((pkg): [string, Named['rank']] => [pkg.name, RANK.derived]),
    ...product.repos.flatMap((repo): Array<[string, Named['rank']]> => [
      [repo.repo, RANK.derived],
      [repo.repo.split('/')[1] ?? '', RANK.derived],
    ]),
  ];
}

/** Edit distance allowed for an input of this length; short names must match exactly. */
function tolerance(length: number): number {
  if (length < 5) return 0;
  return length < 9 ? 1 : 2;
}

/** The resolver built by {@link createResolver}. */
export interface ProductResolver {
  /** @throws McpDocError `UNKNOWN_PRODUCT` with the nearest product ids as candidates. */
  resolve(input: string): ProductResolution;
  /** The product a name denotes exactly (id, alias, package or repository name), if any. */
  exact(name: string): Product | undefined;
}

/**
 * Builds the resolver over a product list.
 *
 * @param suggest ranked product ids for a text that resolved to nothing (the query router);
 *   they fill the candidate list after the names that are close in spelling.
 */
export function createResolver(
  products: readonly Product[],
  suggest: (text: string, n: number) => string[] = () => [],
): ProductResolver {
  const plain = new NameTable();
  const squashed = new NameTable();
  const vocabulary = new Map<Product, Set<string>>();
  for (const product of products) {
    const names = namesOf(product);
    for (const [name, rank] of names) {
      plain.add(plainKey(name), product, rank);
      squashed.add(squashedKey(name), product, rank);
    }
    // Fuzzy word matching looks at what a person would call the product, not at packages.
    vocabulary.set(
      product,
      new Set(names.filter(([, rank]) => rank !== RANK.derived).flatMap(([name]) => words(name))),
    );
  }
  const spellings = [...plain.all()];

  const direct = (text: string): Match | undefined =>
    plain.get(plainKey(text)) ?? squashed.get(squashedKey(text));

  /** `product/source`, split at the last slash because names such as `@arcgis/core` contain one. */
  function scoped(input: string): { product: Product; source?: AnySourceDef } | undefined {
    const slash = input.lastIndexOf('/');
    if (slash <= 0) return undefined;
    const product = direct(input.slice(0, slash))?.product;
    if (product === undefined) return undefined;
    const wanted = squashedKey(input.slice(slash + 1));
    const source = product.sources.find((candidate) => squashedKey(candidate.id) === wanted);
    return source === undefined ? { product } : { product, source };
  }

  /** The brand prefix is optional in speech: `enterprise`, `arcgis survey123`. */
  function withoutBrand(input: string): Product | undefined {
    const key = squashedKey(input);
    const stripped = key.replace(/^(?:arcgis|esri)(?=.{3})/, '');
    const variants = stripped === key ? [`arcgis${key}`] : [stripped];
    return variants.map((variant) => squashed.get(variant)?.product).find(Boolean);
  }

  /** The one product whose id, name and aliases contain every word of the input. */
  function byWords(input: string): Product | undefined {
    const wanted = words(input);
    if (wanted.length === 0) return undefined;
    const matches = products.filter((product) => {
      const known = vocabulary.get(product);
      return known !== undefined && wanted.every((word) => known.has(word));
    });
    return matches.length === 1 ? matches[0] : undefined;
  }

  /** The product with a name within the tolerance, when no other product comes close. */
  function bySpelling(input: string): Product | undefined {
    const key = plainKey(input);
    const allowed = tolerance(key.length);
    if (allowed === 0) return undefined;
    // Distances are measured two beyond the tolerance so that the margin can be judged.
    const horizon = allowed + 2;
    const best = new Map<Product, number>();
    for (const [name, product] of spellings) {
      const distance = levenshtein(key, name, horizon);
      if (distance < (best.get(product) ?? horizon + 1)) best.set(product, distance);
    }
    const ranked = [...best.entries()].sort((a, b) => a[1] - b[1]);
    const [winner, runnerUp] = ranked;
    if (winner === undefined || winner[1] > allowed) return undefined;
    return runnerUp === undefined || runnerUp[1] >= winner[1] + 2 ? winner[0] : undefined;
  }

  function candidates(input: string, scope?: Product): string[] {
    if (scope !== undefined) {
      const sourceIds = scope.sources.map((source) => source.id);
      const wanted = input.slice(input.lastIndexOf('/') + 1);
      const ordered = [...nearest(wanted, sourceIds, MAX_CANDIDATES), ...sourceIds];
      return [...new Set(ordered)].slice(0, MAX_CANDIDATES).map((id) => `${scope.id}/${id}`);
    }
    const names = spellings.map(([name]) => name);
    const byName = new Map(spellings);
    const close = nearest(plainKey(input), names, MAX_CANDIDATES * 3)
      .map((name) => byName.get(name)?.id)
      .filter((id) => id !== undefined);
    return [...new Set([...close, ...suggest(input, MAX_CANDIDATES)])].slice(0, MAX_CANDIDATES);
  }

  function unknown(input: string, scope?: Product): McpDocError {
    const shown = input.trim().slice(0, 80);
    const next = formatCall(
      TOOLS.listProducts,
      scope === undefined ? { query: shown } : { product: scope.id },
    );
    return scope === undefined
      ? new McpDocError('UNKNOWN_PRODUCT', `No product matches "${shown}"`, {
          why: 'The name is not a product id, alias, package name or product/section scope',
          next,
          candidates: candidates(input),
        })
      : new McpDocError('UNKNOWN_PRODUCT', `${scope.id} has no section "${shown}"`, {
          why: `The part after the slash must be a source id of ${scope.id}`,
          next,
          candidates: candidates(input, scope),
        });
  }

  return {
    exact: (name) => plain.get(plainKey(name))?.product,

    resolve(input): ProductResolution {
      if (plainKey(input) === '') throw unknown(input);
      const exact = plain.get(plainKey(input));
      if (exact !== undefined) return { ...exact, resolvedFrom: input };

      const scope = scoped(input);
      if (scope?.source !== undefined) {
        return { product: scope.product, source: scope.source, resolvedFrom: input, how: 'scope' };
      }
      if (scope !== undefined) throw unknown(input, scope.product);

      const loose = squashed.get(squashedKey(input));
      if (loose !== undefined) return { ...loose, resolvedFrom: input };

      const fuzzy = withoutBrand(input) ?? byWords(input) ?? bySpelling(input);
      if (fuzzy !== undefined) return { product: fuzzy, resolvedFrom: input, how: 'fuzzy' };
      throw unknown(input);
    },
  };
}

/** `300.x`, `Pro 3.6`, `v200` and `2.3` name the version prefixes `300`, `3.6`, `200` and `2.3`. */
function versionPrefixes(line: VersionLine): string[] {
  return [line.id, line.label].flatMap(
    (text) => /(?:^|[^\d.])(\d+(?:\.\d+)*)(?:\.x)?(?![\d.]*\d)/i.exec(text)?.slice(1, 2) ?? [],
  );
}

/** True when a version number belongs to a line that states which versions it documents. */
function documents(line: VersionLine, version: string): boolean | undefined {
  const declared = line.vars.versions;
  if (declared !== undefined) return new RegExp(declared).test(version);
  const prefixes = versionPrefixes(line);
  if (prefixes.length === 0) return undefined;
  return prefixes.some((prefix) => version === prefix || version.startsWith(`${prefix}.`));
}

/**
 * The documentation line of a product for a version (`Registry.line`).
 *
 * Without a version: the current line. Otherwise, in order: the line with that id or label
 * (`latest` and `current` always name the current line); the first line, current first, that
 * documents the version number. A line says which versions it documents through a `versions`
 * variable (a regular expression) or through the version in its id or label (`v200`,
 * `300.x`, `Pro 3.6`). A current line that states neither is unversioned documentation and
 * takes any version number, so that version-addressed sources (npm packages, release tags)
 * can still be asked for that version.
 *
 * @throws McpDocError `VERSION_UNAVAILABLE` with the line ids as candidates.
 */
export function lineOf(product: Product, version?: string): VersionLine {
  const current = product.lines.find((line) => line.current) ?? product.lines[0];
  if (current === undefined) {
    throw new McpDocError('INTERNAL', `Product ${product.id} has no version line`);
  }
  const wanted = plainKey(version ?? '');
  if (wanted === '') return current;

  const named = product.lines.find(
    (line) => line.id.toLowerCase() === wanted || line.label.toLowerCase() === wanted,
  );
  if (named !== undefined) return named;
  if (wanted === 'latest' || wanted === 'current') return current;

  const number = /^v?(\d+(?:\.\d+)*)/.exec(wanted)?.[1];
  if (number !== undefined) {
    const ordered = [current, ...product.lines.filter((line) => line !== current)];
    const match = ordered.find((line) => documents(line, number) === true);
    if (match !== undefined) return match;
    if (documents(current, number) === undefined) return current;
  }
  throw new McpDocError(
    'VERSION_UNAVAILABLE',
    `${product.name} has no documentation line for version "${(version ?? '').trim()}"`,
    {
      why: `Documented lines: ${product.lines.map((line) => `${line.id} (${line.label})`).join(', ')}`,
      next: formatCall(TOOLS.getVersions, { product: product.id }),
      candidates: product.lines.map((line) => line.id),
    },
  );
}
