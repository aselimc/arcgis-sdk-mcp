/**
 * Remembers the Gatsby `pathPrefix` found for a source base. A base is usually its own
 * prefix; where it is not (a directory inside a site) the prefix is found by walking up,
 * which costs a request per level. The answer is kept in the derived cache so that it is
 * paid for once, not on every read.
 */
import type { Ctx } from '../../../core/ports.js';

function keyOf(base: string): string {
  return `gatsby-prefix:${base}`;
}

/** The prefix remembered for a base, when it is still a parent of that base. */
export async function storedPrefix(ctx: Ctx, base: string): Promise<string | undefined> {
  const stored = await ctx.cache.getDerived<unknown>('misc', keyOf(base));
  return typeof stored === 'string' && stored.endsWith('/') && base.startsWith(stored)
    ? stored
    : undefined;
}

/** Records the prefix of a base, unless it is already the remembered one. */
export async function rememberPrefix(ctx: Ctx, base: string, prefix: string): Promise<void> {
  if ((await storedPrefix(ctx, base)) === prefix) return;
  await ctx.cache.putDerived('misc', keyOf(base), prefix);
}
