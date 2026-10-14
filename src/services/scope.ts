/**
 * Product scope of a tool call (design section 3.1): the `product` argument when given,
 * else a product the query spells out, else the SDKs of the user's project, else the
 * router's best guesses. Shared by search, symbol lookup and sample search.
 *
 * The project outranks the router. A router guess is made from single words (`expression`
 * for Arcade, `engine` for Unreal Engine), which is weak evidence next to a manifest that
 * lists the SDK the agent is writing code for. Only a query that names another product by
 * its shape (`arcpy.analysis.Buffer`, `calcite-button`) or by its name leaves the project.
 */
import type { Ctx, ProductResolution } from '../core/ports.js';
import { isSymbolShaped } from '../core/tokenize.js';
import type { Product, VersionLine, WorkspaceSdk } from '../core/types.js';

/** How the scope was chosen; reported to the agent so it can correct a wrong guess. */
export type ScopeOrigin = 'argument' | 'workspace' | 'query' | 'router' | 'none';

/** The products a call covers. */
export interface Scope {
  resolutions: ProductResolution[];
  origin: ScopeOrigin;
  /** SDKs detected in the project, for ranking and version hints. */
  workspace: WorkspaceSdk[];
  /**
   * Products worth asking when the scope has no answer: the router's guesses that were not
   * taken and the products related to those of the project. Empty when the caller named the
   * product. Asking them costs index builds, so a caller does it only after a miss.
   */
  fallbacks: ProductResolution[];
}

/** A routed product counts as the clear answer when it is this many times as confident as the next. */
const CLEAR_MARGIN = 1.5;

/**
 * Confidence from which the router is taken to have recognised the product itself: it
 * answers this high only for a namespace, package or element shape, or when every word of
 * the query is part of the product's own names.
 */
const NAMED_CONFIDENCE = 0.95;

/** Products the router is asked for; more than a scope holds, so that a filter has a choice. */
const ROUTE_CANDIDATES = 5;

/** Most products offered as {@link Scope.fallbacks}. */
const MAX_FALLBACKS = 3;

/** Esri SDKs detected in the project; `[]` when detection is off or fails. */
export async function workspaceSdks(ctx: Ctx): Promise<WorkspaceSdk[]> {
  try {
    return await ctx.workspace();
  } catch (error) {
    ctx.logger.warn('workspace detection failed', { error });
    return [];
  }
}

function resolutionOf(product: Product, from: string): ProductResolution {
  return { product, resolvedFrom: from, how: 'fuzzy' };
}

function words(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;
}

/**
 * Products whose name the query contains as a phrase of two or more words ("Field Maps",
 * "Experience Builder"), longest phrase first. The router weighs single words, so a product
 * whose name is made of common ones loses to products that merely list them as keywords.
 */
export function productsNamedIn(ctx: Ctx, query: string): Product[] {
  const text = words(query);
  const found: Array<{ product: Product; length: number }> = [];
  for (const product of ctx.registry.all()) {
    if (product.tier === 'link') continue;
    const phrases = [product.name, product.name.replace(/^ArcGIS\s+/i, ''), ...product.aliases]
      .map(words)
      .filter((phrase) => phrase.trim().includes(' '));
    const length = Math.max(0, ...phrases.filter((p) => text.includes(p)).map((p) => p.length));
    if (length > 0) found.push({ product, length });
  }
  return found.sort((a, b) => b.length - a.length).map((entry) => entry.product);
}

function unique(products: readonly Product[]): Product[] {
  const seen = new Set<string>();
  return products.filter((product) => {
    if (seen.has(product.id)) return false;
    seen.add(product.id);
    return true;
  });
}

/**
 * Resolves the scope of a call.
 *
 * @param input.product the caller's `product` argument, if any.
 * @param input.query the text the router reads when there is no argument.
 * @param input.max most products a scope may hold.
 * @param input.eligible narrows the products a scope may be made of (those with samples,
 *   say). It is dropped when no product passes, so that a call still says something about
 *   the product that was meant. A `product` argument is never filtered.
 * @throws McpDocError `UNKNOWN_PRODUCT` when `product` is given and names nothing.
 */
export async function resolveScope(
  ctx: Ctx,
  input: {
    product?: string | undefined;
    query: string;
    max: number;
    eligible?: (product: Product) => boolean;
  },
): Promise<Scope> {
  const workspace = await workspaceSdks(ctx);
  if (input.product !== undefined && input.product.trim() !== '') {
    return {
      resolutions: [ctx.registry.resolve(input.product)],
      origin: 'argument',
      workspace,
      fallbacks: [],
    };
  }

  const detected = unique(
    workspace
      .map((sdk) => ctx.registry.get(sdk.product))
      .filter((product) => product !== undefined),
  );
  const routed = ctx.registry
    .route(input.query, Math.max(input.max, ROUTE_CANDIDATES))
    .map((entry) => ({ ...entry, product: ctx.registry.get(entry.product) }))
    .filter(
      (entry): entry is { product: Product; confidence: number } => entry.product !== undefined,
    );
  const named = productsNamedIn(ctx, input.query);

  const build = (usable: (product: Product) => boolean): Scope | undefined => {
    const inProject = detected.filter(usable);
    const guesses = routed.filter((entry) => usable(entry.product));
    const phrased = named.filter(usable);
    const [top, second] = guesses;
    const from = (products: readonly Product[], origin: string): ProductResolution[] =>
      products.map((product) => resolutionOf(product, origin));
    const scope = (
      products: readonly Product[],
      origin: ScopeOrigin,
      label: string,
      others: readonly Product[],
    ): Scope => {
      const taken = unique(products).slice(0, input.max);
      const ids = new Set(taken.map((product) => product.id));
      return {
        resolutions: from(taken, label),
        origin,
        workspace,
        fallbacks: from(
          unique(others.filter((product) => !ids.has(product.id))).slice(0, MAX_FALLBACKS),
          input.query,
        ),
      };
    };
    const routedProducts = guesses.map((entry) => entry.product);
    /** The searchable products that `products` list as related, in their order. */
    const relatedTo = (products: readonly Product[]): Product[] =>
      products
        .flatMap((product) => product.related)
        .map((id) => ctx.registry.get(id))
        .filter((product) => product !== undefined)
        .filter((product) => product.tier !== 'link' && usable(product));

    // A symbol-shaped query that spells out a product (`arcpy.da.SearchCursor`) is about
    // that product whatever the project holds.
    const shaped =
      top !== undefined &&
      isSymbolShaped(input.query) &&
      (second === undefined || top.confidence >= second.confidence * CLEAR_MARGIN);
    if (shaped && (top.confidence >= NAMED_CONFIDENCE || inProject.length === 0)) {
      // A name the guessed product lacks is most often in a product it belongs with
      // (`LLMAgent`: routed to the AI product, documented in the JavaScript SDK).
      return scope([top.product], 'query', input.query, [
        ...inProject,
        ...routedProducts,
        ...relatedTo([top.product]),
      ]);
    }
    if (phrased.length > 0) {
      return scope([...phrased, ...inProject, ...routedProducts], 'query', input.query, []);
    }
    if (inProject.length > 0) {
      // Among the project's SDKs, those the router also picked go first: a lookup that takes
      // one product (samples) should take the one the query is about.
      const rank = new Map(routedProducts.map((product, position) => [product.id, position]));
      const ordered = [...inProject].sort(
        (a, b) => (rank.get(a.id) ?? rank.size) - (rank.get(b.id) ?? rank.size),
      );
      return scope(ordered, 'workspace', 'project', [...routedProducts, ...relatedTo(ordered)]);
    }
    if (guesses.length > 0) {
      // The guesses beyond `max`, then the products related to those taken: a router guess
      // made from no word it knows is the default list, and `Round` was then answered with
      // a fuzzy JavaScript name although Arcade, related to that SDK, has the function.
      const taken = routedProducts.slice(0, input.max);
      return scope(routedProducts, 'router', input.query, [
        ...routedProducts.slice(input.max),
        ...relatedTo(taken),
      ]);
    }
    return undefined;
  };

  const { eligible } = input;
  return (
    (eligible === undefined ? undefined : build(eligible)) ??
    build(() => true) ?? { resolutions: [], origin: 'none', workspace, fallbacks: [] }
  );
}

/** The version line a call reads for a product when the caller named no version. */
export interface ProjectLine {
  line: VersionLine;
  /** The version found in the project, when there is one. */
  version?: string;
  /** True when `line` is the project's line and not the current one. */
  pinned: boolean;
  /** True when the project's line exists but its pages are never fetched (link-only). */
  unreadable: boolean;
}

/**
 * The line to read for a product of the project. A project on 200.x is answered from the
 * 200.x documentation, as a symbol lookup always was: results of the current line describe
 * types that do not exist in the version the agent writes code for. A line whose pages are
 * not fetched (an older JavaScript release) cannot be searched; the current line answers
 * then, and the caller is told which version the results describe.
 */
export function projectLine(
  ctx: Ctx,
  product: Product,
  workspace: readonly WorkspaceSdk[],
): ProjectLine {
  const current = ctx.registry.line(product);
  const version = workspace.find((sdk) => sdk.product === product.id)?.version;
  if (version === undefined) return { line: current, pinned: false, unreadable: false };
  let own: VersionLine;
  try {
    own = ctx.registry.line(product, version);
  } catch {
    // A version that fits no line says nothing about which documentation to read.
    return { line: current, version, pinned: false, unreadable: false };
  }
  if (own.current) return { line: own, version, pinned: false, unreadable: false };
  if (own.access === 'link-only') return { line: current, version, pinned: false, unreadable: true };
  return { line: own, version, pinned: true, unreadable: false };
}
