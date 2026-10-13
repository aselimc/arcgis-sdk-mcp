/**
 * Members a type inherits. A reference indexes a member once, under the type that declares
 * it, so `ArcGISMap.loadStatus` or `Map.LoadAsync` has no record of its own. The page of
 * the type says where such a member lives: Dokka lists it among the type's members with a
 * link to the declaring type, DocFX and Javadoc have an "inherited members" list of links.
 * A same-named member of another type that the type's page links to is therefore the
 * declaration that was asked for.
 */
import { joinSections } from '../../core/budget.js';
import type { CatalogRecord, DocPage } from '../../core/types.js';

/** Same-named members considered; a name on more types than this is not worth a page read. */
export const MAX_INHERITED_CANDIDATES = 200;

/** A ref as it appears as a Markdown link target. */
function linkTarget(ref: string): string {
  return `](${ref})`;
}

/**
 * The record among `candidates` (members with the wanted name, declared on other types)
 * that the page of the type links to. `undefined` when the page links to none of them, or
 * to several: two links mean the name is not one inherited declaration.
 */
export function declaredElsewhere(
  typePage: DocPage,
  candidates: readonly CatalogRecord[],
): CatalogRecord | undefined {
  if (candidates.length === 0 || typePage.degraded?.level === 'link-only') return undefined;
  const text = [typePage.header ?? '', joinSections(typePage.sections)].join('\n');
  const linked = candidates.filter((candidate) => text.includes(linkTarget(candidate.ref)));
  // The same declaration can be indexed by two sources of a product; one page is one answer.
  const refs = new Set(linked.map((candidate) => candidate.ref));
  return refs.size === 1 ? linked[0] : undefined;
}

/** The notice that tells the caller the answer documents the declaring type's member. */
export function inheritedNotice(type: string, member: string, owner: string): string {
  return `${type} inherits ${member} from ${owner}; this is the documentation of ${owner}.${member}.`;
}
