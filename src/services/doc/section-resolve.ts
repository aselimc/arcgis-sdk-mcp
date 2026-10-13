/**
 * Resolves the `section` argument of `arcgis_docs_read` against a page (design section 3.5),
 * in this order: exact id; slug of heading text; case-insensitive heading text; member id or
 * name on API pages; the pseudo-sections `source`, `readme`, `parameters`, `syntax` and
 * `members`; fuzzy match (edit distance at most 2).
 */
import { sectionSubtree } from '../../core/sections.js';
import { levenshtein } from '../../core/text-distance.js';
import type { DocPage, DocSection } from '../../core/types.js';
import { slugify } from '../../core/url.js';
import {
  MEMBERS_SECTION_ID,
  SOURCE_SECTION_ID,
  fileSections,
  memberIndexSection,
  memberSection,
} from './display.js';

/** Names that select a kind of content rather than one heading. */
export const PSEUDO_SECTIONS = ['source', 'readme', 'parameters', 'syntax', 'members'] as const;

type PseudoSection = (typeof PSEUDO_SECTIONS)[number];

/** Which rule matched; reported so a fuzzy match can be mentioned to the agent. */
export type ResolvedBy = 'id' | 'slug' | 'heading' | 'member' | 'pseudo' | 'fuzzy';

/** A resolved section: what to show and how it was found. */
export interface ResolvedSection {
  /** The section and its descendants, in document order. */
  sections: DocSection[];
  /** Id of the matched section (or the pseudo-section name). */
  id: string;
  by: ResolvedBy;
}

const MAX_FUZZY_DISTANCE = 2;

/** True when `name` is one of the pseudo-sections. */
export function isPseudoSection(name: string): name is PseudoSection {
  return (PSEUDO_SECTIONS as readonly string[]).includes(name.trim().toLowerCase());
}

/** `queryFeatures()` and `#queryFeatures` name the member `queryFeatures`. */
function bare(name: string): string {
  return name
    .trim()
    .replace(/^#/, '')
    .replace(/\(.*\)$/s, '');
}

function subtree(sections: readonly DocSection[], id: string, by: ResolvedBy): ResolvedSection {
  return { sections: sectionSubtree(sections, id), id, by };
}

function firstMatching(sections: readonly DocSection[], pattern: RegExp): DocSection | undefined {
  return sections.find((section) => pattern.test(section.id) || pattern.test(section.title));
}

function pseudo(page: DocPage, sections: readonly DocSection[], name: PseudoSection): ResolvedSection | undefined {
  switch (name) {
    case 'source': {
      const files = fileSections(page.files ?? []);
      if (files.length > 0) return { sections: files, id: SOURCE_SECTION_ID, by: 'pseudo' };
      const found = firstMatching(sections, /^(?:source|code|example|usage)/i);
      return found === undefined ? undefined : subtree(sections, found.id, 'pseudo');
    }
    case 'readme':
      // The description of a sample or repository page, without its source files.
      return page.sections.length === 0 ? undefined : { sections: [...page.sections], id: 'readme', by: 'pseudo' };
    case 'parameters': {
      const found = firstMatching(sections, /^(?:param|argument|input)/i);
      return found === undefined ? undefined : subtree(sections, found.id, 'pseudo');
    }
    case 'syntax': {
      const found = firstMatching(sections, /^(?:syntax|signature|declaration|usage|constructor)/i);
      return found === undefined ? undefined : subtree(sections, found.id, 'pseudo');
    }
    case 'members': {
      const members = page.members ?? [];
      if (members.length > 0) {
        return { sections: [memberIndexSection(members)], id: MEMBERS_SECTION_ID, by: 'pseudo' };
      }
      const found = firstMatching(sections, /^(?:members|properties|methods|fields)/i);
      return found === undefined ? undefined : subtree(sections, found.id, 'pseudo');
    }
  }
}

function fuzzy(sections: readonly DocSection[], wanted: string): DocSection | undefined {
  const needle = wanted.toLowerCase();
  const slug = slugify(wanted);
  let best: { section: DocSection; distance: number } | undefined;
  let tied = false;
  for (const section of sections) {
    const distance = Math.min(
      levenshtein(slug, section.id.toLowerCase(), MAX_FUZZY_DISTANCE),
      levenshtein(needle, section.title.toLowerCase(), MAX_FUZZY_DISTANCE),
    );
    if (distance > MAX_FUZZY_DISTANCE) continue;
    if (best === undefined || distance < best.distance) {
      best = { section, distance };
      tied = false;
    } else if (distance === best.distance) {
      tied = true;
    }
  }
  // Two equally near headings are a guess, and a wrong section is worse than an error.
  return tied ? undefined : best?.section;
}

/**
 * Resolves `wanted` against the sections shown for `page`.
 *
 * @param sections the page's sections as displayed, including generated ones.
 * @returns `undefined` when nothing matches; the caller raises `SECTION_NOT_FOUND`.
 */
export function resolveSection(
  page: DocPage,
  sections: readonly DocSection[],
  wanted: string,
): ResolvedSection | undefined {
  const name = bare(wanted);
  if (name === '') return undefined;
  const lower = name.toLowerCase();

  if (sections.some((section) => section.id === name)) return subtree(sections, name, 'id');

  const slug = slugify(name);
  if (sections.some((section) => section.id === slug)) return subtree(sections, slug, 'slug');

  const byHeading = sections.find((section) => section.title.toLowerCase() === lower);
  if (byHeading !== undefined) return subtree(sections, byHeading.id, 'heading');

  const members = page.members ?? [];
  const member =
    members.find((candidate) => candidate.id === name || candidate.name === name) ??
    members.find((candidate) => candidate.id.toLowerCase() === lower || candidate.name.toLowerCase() === lower);
  if (member !== undefined) {
    const documented = sectionSubtree(sections, member.id);
    return documented.length > 0
      ? { sections: documented, id: member.id, by: 'member' }
      : { sections: [memberSection(member)], id: member.id, by: 'member' };
  }

  if (isPseudoSection(name)) {
    const found = pseudo(page, sections, lower as PseudoSection);
    if (found !== undefined) return found;
  }

  const near = fuzzy(sections, name);
  return near === undefined ? undefined : subtree(sections, near.id, 'fuzzy');
}
