/**
 * Product scope of a tool call (design section 3.1): the `product` argument when given,
 * else the one SDK of the user's project, else a product the query itself names, else the
 * router's best guesses. Shared by search, symbol lookup and sample search.
 */
import type { Ctx, ProductResolution } from '../core/ports.js';
import { isSymbolShaped } from '../core/tokenize.js';
import type { Product, WorkspaceSdk } from '../core/types.js';

/** How the scope was chosen; reported to the agent so it can correct a wrong guess. */
export type ScopeOrigin = 'argument' | 'workspace' | 'query' | 'router' | 'none';

/** The products a call covers. */
export interface Scope {
  resolutions: ProductResolution[];
  origin: ScopeOrigin;
  /** SDKs detected in the project, for ranking and version hints. */
  workspace: WorkspaceSdk[];
}

/** A routed product counts as the clear answer when it is this many times as confident as the next. */
const CLEAR_MARGIN = 1.5;

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

/**
 * Resolves the scope of a call.
 *
 * @param input.product the caller's `product` argument, if any.
 * @param input.query the text the router reads when there is no argument.
 * @param input.max most products a routed scope may hold.
 * @throws McpDocError `UNKNOWN_PRODUCT` when `product` is given and names nothing.
 */
export async function resolveScope(
  ctx: Ctx,
  input: { product?: string | undefined; query: string; max: number },
): Promise<Scope> {
  const workspace = await workspaceSdks(ctx);
  if (input.product !== undefined && input.product.trim() !== '') {
    return { resolutions: [ctx.registry.resolve(input.product)], origin: 'argument', workspace };
  }

  const detected = [...new Set(workspace.map((sdk) => sdk.product))]
    .map((id) => ctx.registry.get(id))
    .filter((product) => product !== undefined);
  const [only] = detected;
  if (detected.length === 1 && only !== undefined) {
    return { resolutions: [resolutionOf(only, 'project')], origin: 'workspace', workspace };
  }

  const routed = ctx.registry
    .route(input.query, input.max)
    .map((entry) => ({ ...entry, product: ctx.registry.get(entry.product) }))
    .filter((entry): entry is { product: Product; confidence: number } => entry.product !== undefined);
  const [top, second] = routed;
  if (
    top !== undefined &&
    isSymbolShaped(input.query) &&
    (second === undefined || top.confidence >= second.confidence * CLEAR_MARGIN)
  ) {
    return { resolutions: [resolutionOf(top.product, input.query)], origin: 'query', workspace };
  }
  if (routed.length > 0) {
    // Project SDKs the router also picked go first: they are what the agent is working on.
    const inProject = new Set(detected.map((product) => product.id));
    const ordered = [...routed].sort(
      (a, b) => Number(inProject.has(b.product.id)) - Number(inProject.has(a.product.id)),
    );
    return {
      resolutions: ordered.slice(0, input.max).map((entry) => resolutionOf(entry.product, input.query)),
      origin: 'router',
      workspace,
    };
  }
  if (detected.length > 0) {
    return {
      resolutions: detected.slice(0, input.max).map((product) => resolutionOf(product, 'project')),
      origin: 'workspace',
      workspace,
    };
  }
  return { resolutions: [], origin: 'none', workspace };
}
