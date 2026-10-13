/**
 * Members a type inherits. A reference indexes a member once, under the type that declares
 * it, so `ArcGISMap.loadStatus` or `Map.LoadAsync` has no record of its own. The page of
 * the type says where such a member lives, in one of two ways:
 *
 * - a link to the declaration: Dokka and dartdoc list an inherited member among the type's
 *   members with a link to the declaring type, DocFX has an "Inherited members" list of links;
 * - a statement: javadoc writes "Methods inherited from class `<type>`" followed by the names.
 *
 * A same-named member of another type that the page points at in either way is the
 * declaration that was asked for.
 *
 * QDoc and DocC pages do neither; they only name the base types ({@link baseTypes}). The
 * symbol service then follows those up the hierarchy to the first type that declares a
 * member of the wanted name.
 */
import { joinSections } from '../../core/budget.js';
import type { CatalogRecord, DocPage } from '../../core/types.js';
import { pageKey } from '../../core/url.js';
import { simpleName } from '../index/symbol-map.js';

/** Same-named members considered; a name on more types than this is not worth a page read. */
export const MAX_INHERITED_CANDIDATES = 200;

/** A paragraph that lists what a type takes over from another. */
const INHERITED = /\binherited from\b/i;

/** A ref as it appears as a Markdown link target. */
function linkTarget(ref: string): string {
  return `](${ref})`;
}

/** True when `text` holds `name` as a whole identifier, not as part of a longer one. */
function names(text: string, name: string): boolean {
  if (name === '') return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w$.])${escaped}(?![\\w$])`).test(text);
}

/** The one declaration among `found`, or `undefined` when there is none or more than one. */
function only(found: readonly CatalogRecord[]): CatalogRecord | undefined {
  // The same declaration can be indexed by two sources of a product; one page is one answer.
  const refs = new Set(found.map((candidate) => candidate.ref));
  return refs.size === 1 ? found[0] : undefined;
}

/**
 * The record among `candidates` (members with the wanted name, declared on other types)
 * that the page of the type names as inherited. `undefined` when the page points at none of
 * them, or at several: two declarations mean the name is not one inherited member.
 */
export function declaredElsewhere(
  typePage: DocPage,
  candidates: readonly CatalogRecord[],
): CatalogRecord | undefined {
  if (candidates.length === 0 || typePage.degraded?.level === 'link-only') return undefined;
  const text = [typePage.header ?? '', joinSections(typePage.sections)].join('\n\n');
  const linked = candidates.filter((candidate) => text.includes(linkTarget(candidate.ref)));
  if (linked.length > 0) return only(linked);

  const statements = text.split(/\n{2,}/).filter((paragraph) => INHERITED.test(paragraph));
  const stated = candidates.filter((candidate) => {
    const owner = candidate.parent ?? '';
    // A page may write the declaring type in full or by its simple name.
    const short = owner.split(/::|[.#/]/).at(-1) ?? owner;
    return statements.some(
      (paragraph) =>
        (names(paragraph, owner) || names(paragraph, short)) &&
        names(paragraph, simpleName(candidate)),
    );
  });
  return only(stated);
}

/** A type that a page names as one its own type derives from. */
export interface BaseType {
  /** The simple or qualified name of the type, from the link text. */
  name: string;
  /** The page of the type, as {@link pageKey} writes it. */
  ref: string;
}

/**
 * Wording that introduces base types: "Inherits" (QDoc), "Inherits From" (DocC),
 * "Inheritance" (the JavaScript reference, dartdoc, DocFX), "Extends", "Bases" (Sphinx).
 * "inherited from" is not among them: that wording lists members, not types.
 */
const DERIVES = /\b(?:inherits?|inheritance|extends|superclass(?:es)?)\b|^\W*bases\b/i;
const HEADING_LINE = /^ {0,3}#{1,6}[ \t]/;
/** A Markdown link; the target may hold one level of parentheses (DocC member pages). */
const LINK = /\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g;

/**
 * The base types a type page names, in page order: the links of a block that says what the
 * type inherits, or of the block under a heading that says so. A reference that neither
 * lists inherited members (QDoc, DocC) nor states them leaves only this trail to the type
 * that declares one.
 */
export function baseTypes(typePage: DocPage): BaseType[] {
  if (typePage.degraded?.level === 'link-only') return [];
  const blocks = [typePage.header ?? '', joinSections(typePage.sections)]
    .join('\n\n')
    .split(/\n{2,}/);
  const found = new Map<string, BaseType>();
  blocks.forEach((block, position) => {
    if (HEADING_LINE.test(block)) return;
    const above = blocks[position - 1] ?? '';
    // Link targets are left out of the test: a URL may hold any of these words.
    const says = DERIVES.test(block.replace(LINK, '$1'));
    if (!says && !(HEADING_LINE.test(above) && DERIVES.test(above))) return;
    for (const [, label = '', target = ''] of block.matchAll(LINK)) {
      const ref = pageKey(target);
      // DocC labels a base type with its declaration keyword: `class FeatureTable`.
      const name = label.replace(/[`*_]/g, '').trim().split(/\s+/).at(-1) ?? '';
      if (name !== '' && !found.has(ref)) found.set(ref, { name, ref });
    }
  });
  return [...found.values()];
}

/** The notice that tells the caller the answer documents the declaring type's member. */
export function inheritedNotice(type: string, member: string, owner: string): string {
  return `${type} inherits ${member} from ${owner}; this is the documentation of ${owner}.${member}.`;
}
