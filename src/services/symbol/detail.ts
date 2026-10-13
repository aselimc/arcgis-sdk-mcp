/**
 * Shapes the page of a symbol to the requested detail and token budget. Renderers that know
 * a format's structure already apply `detail`; this is the uniform trimming for those that
 * cannot, and it leaves an already trimmed page as it is.
 */
import { estimateTokens, fitSections, joinSections, splitBlocks } from '../../core/budget.js';
import { sectionSubtree } from '../../core/sections.js';
import type {
  CatalogRecord,
  DocPage,
  DocSection,
  MemberEntry,
  SymbolDetail,
} from '../../core/types.js';
import {
  MEMBERS_SECTION_ID,
  compactMemberIndexSection,
  memberIndexSection,
} from '../doc/display.js';
import { resolveSection } from '../doc/section-resolve.js';
import { simpleName } from '../index/symbol-map.js';

/** The budgeted text of a symbol. */
export interface SymbolText {
  text: string;
  /** True when documentation was left out to fit the detail level or the budget. */
  truncated: boolean;
}

const FENCE = /^ {0,3}(?:`{3,}|~{3,})/;
const HEADING = /^ {0,3}#{1,6}[ \t]/;
/** A table row or list line that opens with a name in code: one line of a member index. */
const INDEX_LINE = /^(?:\| ?|[-*] )`([^`]+)`/;

/** Least share of the budget that the member index of a type summary can count on. */
const INDEX_SHARE = 0.5;

/** Said where the description of a type was shortened in favour of its member index. */
export const DESCRIPTION_CUT_NOTE =
  '_The description is cut here to leave room for the member index._';

function withTokens(section: DocSection, markdown: string): DocSection {
  return { ...section, markdown, tokens: estimateTokens(markdown) };
}

/** The part of a page that documents the record: one member's section, or the whole type page. */
function ownSections(page: DocPage, record: CatalogRecord): DocSection[] {
  if (record.parent === undefined) return page.sections;
  // A page that opens with a member's section was cut by its adapter already, to the member
  // or to its overloads: looking the name up again would keep one overload and drop the rest.
  const first = page.sections[0];
  if (first !== undefined && (page.members ?? []).some((member) => member.id === first.id)) {
    return page.sections;
  }
  // An adapter that could not slice returns the whole type page; cut the member out here.
  const fragment = record.ref.includes('#') ? record.ref.slice(record.ref.indexOf('#') + 1) : '';
  for (const name of [fragment, simpleName(record)]) {
    if (name === '') continue;
    const resolved = resolveSection(page, page.sections, name);
    if (resolved !== undefined && resolved.by !== 'fuzzy') return resolved.sections;
  }
  return page.sections;
}

/** The declaration and one line: headings, the first code block and the first paragraph. */
function signatureOf(sections: readonly DocSection[]): DocSection[] {
  const [first] = sections;
  if (first === undefined) return [];
  const kept: string[] = [];
  let hasCode = false;
  let hasProse = false;
  for (const block of sections.flatMap((section) => splitBlocks(section.markdown))) {
    const code = FENCE.test(block);
    const heading = HEADING.test(block);
    if (heading && kept.length > 0) {
      if (hasCode || hasProse) break;
      continue;
    }
    if (heading) kept.push(block);
    else if (code && !hasCode) {
      kept.push(block);
      hasCode = true;
    } else if (!code && !hasProse) {
      kept.push(block);
      hasProse = true;
    }
    if (hasCode && hasProse) break;
  }
  return [withTokens(first, kept.join('\n\n'))];
}

/** A type's own documentation followed by a one-line index of its members. */
function typeSummary(page: DocPage, sections: readonly DocSection[]): DocSection[] {
  const members = page.members ?? [];
  if (members.length === 0) return [...sections];
  const memberSections = new Set(
    members.flatMap((member) => sectionSubtree(sections, member.id).map((section) => section.id)),
  );
  if (memberSections.size === 0) return [...sections];
  const own = sections.filter((section) => !memberSections.has(section.id));
  // A page that is nothing but member sections documents the symbol itself (an Arcade
  // function with its overloads under a bare title, a specification object listed as the
  // only member of its page): an index would replace the documentation that was asked for.
  const ownText = own.some(
    (section) =>
      section.markdown
        .split('\n')
        .filter((line) => !HEADING.test(line))
        .join('')
        .trim() !== '',
  );
  if (!ownText) return [...sections];
  return [...own, memberIndexSection(members)];
}

/** Position of the first section that lists members rather than describes the type; -1 if none. */
function indexStart(sections: readonly DocSection[], members: readonly MemberEntry[]): number {
  const names = new Set(members.flatMap((member) => [member.id, member.name]));
  return sections.findIndex(
    (section, position) =>
      position > 0 &&
      (section.id === MEMBERS_SECTION_ID ||
        section.markdown.split('\n').some((line) => names.has(INDEX_LINE.exec(line)?.[1] ?? ''))),
  );
}

/**
 * Fits the summary of a type. Its member index is what the caller goes on from, so a long
 * description does not push it out: the index keeps at least {@link INDEX_SHARE} of the
 * budget (as bare names when one line per member is too much) and the description is cut to
 * what is left.
 */
function fitTypeSummary(
  page: DocPage,
  sections: readonly DocSection[],
  budget: number,
): { text: string; shownAll: boolean } {
  const whole = fitSections(sections, budget);
  if (whole.nextOffset === undefined) return { text: whole.text, shownAll: true };
  const members = page.members ?? [];
  const start = indexStart(sections, members);
  if (start === -1) return { text: whole.text, shownAll: false };

  const tokensOf = (list: readonly DocSection[]): number =>
    list.reduce((sum, section) => sum + section.tokens, 0);
  const prose = sections.slice(0, start);
  const listed = sections.slice(start);
  const room = Math.max(Math.floor(budget * INDEX_SHARE), budget - tokensOf(prose));
  const index = tokensOf(listed) <= room ? listed : [compactMemberIndexSection(members, room)];
  const description = fitSections(prose, Math.max(1, budget - tokensOf(index)));
  return {
    text: [
      description.text,
      ...(description.nextOffset === undefined ? [] : [DESCRIPTION_CUT_NOTE]),
      joinSections(index),
    ].join('\n\n'),
    shownAll: false,
  };
}

/**
 * The text of a symbol at a detail level within `maxTokens`.
 *
 * - `signature`: the header block when the page has one, else the first code block, plus
 *   one line of description.
 * - `summary`: a member in full; a type as its own documentation and a member index, the
 *   index kept when the two do not fit together.
 * - `full`: everything.
 */
export function symbolText(
  page: DocPage,
  record: CatalogRecord,
  detail: SymbolDetail,
  maxTokens: number,
): SymbolText {
  const own = ownSections(page, record);
  let sections: DocSection[];
  if (detail === 'signature') sections = signatureOf(own);
  else if (detail === 'summary' && record.parent === undefined) sections = typeSummary(page, own);
  else sections = [...own];

  const header = page.header?.trim() ?? '';
  const budget = Math.max(50, maxTokens - (header === '' ? 0 : estimateTokens(header)));
  let text: string;
  let shownAll: boolean;
  if (detail === 'summary' && record.parent === undefined) {
    ({ text, shownAll } = fitTypeSummary(page, sections, budget));
  } else {
    const fit = fitSections(sections, budget);
    text = fit.text;
    shownAll = fit.nextOffset === undefined;
  }
  const reduced =
    sections.reduce((sum, s) => sum + s.tokens, 0) < own.reduce((sum, s) => sum + s.tokens, 0);
  return {
    text: [header, text].filter((part) => part !== '').join('\n\n'),
    truncated: !shownAll || (detail === 'signature' && reduced),
  };
}
