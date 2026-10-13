/**
 * Gatsby static queries. Sites migrated from the old help system keep their navigation tree
 * and search pointers out of page-data, in the result of a static query at
 * `<prefix>page-data/sq/d/<hash>.json`; the glossary lives in another one. A page lists the
 * hashes it uses in `staticQueryHashes` without saying which is which, so the files are
 * read until what is wanted has been found.
 *
 * A hash is derived from the text of the query, so one hash returns the same kind of data
 * on every site and in every build. What each hash turned out to hold is therefore
 * remembered (hash -> roles, in the derived cache): the next site skips the glossary and
 * top-navigation files and goes straight to the one it needs. No hash is ever hard-coded.
 */
import { mergePointers, noPointers, pointersOf, type IndexPointers } from './page-data.js';
import type { GatsbySession, SessionRequest } from './session.js';
import { isObject } from './shape.js';
import { staticQueryUrl } from './site.js';

/** A kind of data a static query can hold. */
export type StaticQueryRole = 'nav' | 'search' | 'glossary';

/** Derived-cache key of the learned `hash -> roles` table. */
const ROLES_KEY = 'gatsby-static-query-roles';

type RoleTable = Record<string, StaticQueryRole[]>;

/** The roles a set of pointers fulfils. */
export function rolesOf(pointers: IndexPointers): StaticQueryRole[] {
  const roles: StaticQueryRole[] = [];
  if (pointers.navTrees.length > 0) roles.push('nav');
  if (pointers.storeUrl !== undefined || pointers.inlineStore !== undefined) roles.push('search');
  if (pointers.glossaryTerms.length > 0) roles.push('glossary');
  return roles;
}

async function loadRoles(session: GatsbySession): Promise<RoleTable> {
  const stored = await session.ctx.cache.getDerived<unknown>('misc', ROLES_KEY);
  const table: RoleTable = {};
  if (!isObject(stored)) return table;
  for (const [hash, roles] of Object.entries(stored)) {
    if (Array.isArray(roles)) {
      table[hash] = roles.filter(
        (role): role is StaticQueryRole =>
          role === 'nav' || role === 'search' || role === 'glossary',
      );
    }
  }
  return table;
}

/**
 * Reads static query results until every wanted role has been found or the hashes run out.
 *
 * Hashes known to hold a wanted role are read first, unknown ones next, and hashes known to
 * hold nothing wanted are not requested at all. A file that is missing or malformed is
 * skipped. The result holds whatever was found, which may be nothing.
 */
export async function loadStaticQueries(
  session: GatsbySession,
  prefix: string,
  hashes: readonly string[],
  wanted: readonly StaticQueryRole[],
  options: SessionRequest = {},
): Promise<IndexPointers> {
  const found = noPointers();
  if (wanted.length === 0 || hashes.length === 0) return found;
  const table = await loadRoles(session);
  const missing = (): StaticQueryRole[] => {
    const have = rolesOf(found);
    return wanted.filter((role) => !have.includes(role));
  };
  const promising = hashes.filter((hash) => table[hash]?.some((role) => wanted.includes(role)));
  const unknown = hashes.filter((hash) => table[hash] === undefined);

  let learned = false;
  for (const hash of [...promising, ...unknown]) {
    if (missing().length === 0 || session.remaining() === 0) break;
    const url = staticQueryUrl(prefix, hash);
    const fetched = await session.optional(`Static query ${url}`, () => session.json(url, options));
    if (fetched === undefined) continue;
    const body = fetched.data;
    const pointers = isObject(body) && isObject(body.data) ? pointersOf(body.data) : noPointers();
    const roles = rolesOf(pointers);
    // A file that once held something is never written off for one empty answer.
    const known = table[hash];
    if (known === undefined || (roles.length > 0 && known.join() !== roles.join())) {
      table[hash] = roles;
      learned = true;
    }
    mergePointers(found, pointers);
  }
  if (learned) await session.ctx.cache.putDerived('misc', ROLES_KEY, table);
  return found;
}
