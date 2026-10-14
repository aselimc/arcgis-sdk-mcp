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
import { chunkFences, mergeChunks } from '../doc/paging.js';
import { resolveSection } from '../doc/section-resolve.js';
import { simpleName } from '../index/symbol-map.js';

/** The budgeted text of a symbol. */
export interface SymbolText {
  text: string;
  /** True when documentation was left out to fit the detail level or the budget. */
  truncated: boolean;
  /**
   * Where the budget cut the text, as a character offset into the canonical text of the
   * symbol's own sections (`joinSections`). Present only when what is shown is a prefix of
   * that text, so a reader can continue from the offset without repeating anything.
   */
  cutOffset?: number;
  /** True when the budget, and not only the detail level, left text out. */
  budgetCut: boolean;
  /** Tokens of the symbol's whole documentation, header included: what `full` would need. */
  totalTokens: number;
  /** The sections `cutOffset` indexes into. */
  own: DocSection[];
}

const FENCE = /^ {0,3}(?:`{3,}|~{3,})/;
const HEADING = /^ {0,3}#{1,6}[ \t]/;
/** A table row or list line that opens with a name in code: one line of a member index. */
const INDEX_LINE = /^(?:\| ?|[-*] )`([^`]+)`/;
/** A paragraph that is one bold phrase: the label of the block below it (a parameter name). */
const BOLD_LABEL = /^\*\*[^\n]+\*\*$/;
/** A notice that the symbol should no longer be used, as a quote or a paragraph. */
const DEPRECATION = /^(?:>\s*)?(?:\*\*|__|_)?\s*deprecated\b/i;
/** Sections that record when something was added: history, not how to use the symbol. */
const HISTORY_TITLE = /^(?:new|added|changed|what'?s new)\s+(?:at|in|for)\b/i;

/** Least share of the budget that the member index of a type summary can count on. */
const INDEX_SHARE = 0.5;

/** Names of what was left out that a cut note lists. */
const MAX_CUT_NAMES = 12;

/** Tokens kept free for the cut note. */
const NOTE_TOKENS = 60;

/** Said where the description of a type was shortened in favour of its member index. */
export const DESCRIPTION_CUT_NOTE =
  '_The description is cut here to leave room for the member index._';

function withTokens(section: DocSection, markdown: string): DocSection {
  return { ...section, markdown, tokens: estimateTokens(markdown) };
}

function tokensOf(sections: readonly DocSection[]): number {
  return sections.reduce((sum, section) => sum + section.tokens, 0);
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

/**
 * The sections that are overloads of one member: several sections on the level of the first
 * whose headings carry the member's name. A page with one declaration has none.
 */
function overloadsOf(sections: readonly DocSection[], name: string): DocSection[] {
  const [first] = sections;
  if (first === undefined || name === '') return [];
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const named = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'u');
  const onLevel = (level: number): DocSection[] =>
    sections.filter((section) => section.level === level && named.test(section.title));
  const siblings = onLevel(first.level);
  if (siblings.length > 1 && siblings[0] === first) return siblings;
  // A bare title with one section per overload below it (an Arcade function).
  const second = sections[1];
  const bare = splitBlocks(first.markdown).every((block) => HEADING.test(block));
  if (!bare || second === undefined || second.level <= first.level) return [];
  const below = onLevel(second.level);
  const all = sections.filter((section) => section.level === second.level);
  return below.length > 1 && below.length === all.length ? below : [];
}

/** The declaration and one line of one section list: heading, first code block, first paragraph. */
function declarationOf(sections: readonly DocSection[], prose: boolean): string[] {
  const kept: string[] = [];
  let hasCode = false;
  let hasProse = !prose;
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
    } else if (!code && DEPRECATION.test(block)) {
      // Deprecation is part of a declaration: the cheapest level must not teach a call that
      // the reference tells its readers to stop using.
      kept.push(block);
    } else if (!code && !hasProse) {
      kept.push(block);
      hasProse = true;
    }
  }
  return kept;
}

/**
 * The declaration and one line. For an overloaded member that is the declaration of every
 * overload: a caller that checks a call against one of twelve signatures would conclude that
 * the arguments of that one are required.
 */
function signatureOf(sections: readonly DocSection[], name: string): DocSection[] {
  const [first] = sections;
  if (first === undefined) return [];
  const overloads = overloadsOf(sections, name);
  if (overloads.length === 0) {
    return [withTokens(first, declarationOf(sections, true).join('\n\n'))];
  }
  // The title above the overloads, when they are sections below it.
  const title = overloads[0] === first ? [] : splitBlocks(first.markdown).slice(0, 1);
  const blocks = overloads.flatMap((overload, position) =>
    declarationOf(sectionSubtree(sections, overload.id), position === 0),
  );
  blocks.unshift(...title);
  blocks.push(`_${overloads.length} overloads; the declaration of each is shown._`);
  return [withTokens(first, blocks.join('\n\n'))];
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

/**
 * A summary without the release history of the symbol ("New at 11.3", "New in 10.9.1"),
 * when the whole does not fit: a REST operation page opens with a section per release, and
 * a summary that spends its budget on them never reaches the parameters.
 */
function withoutHistory(sections: readonly DocSection[], budget: number): DocSection[] {
  if (tokensOf(sections) <= budget) return [...sections];
  const history = new Set(
    sections
      .filter((section, position) => position > 0 && HISTORY_TITLE.test(section.title))
      .flatMap((section) => sectionSubtree(sections, section.id).map((part) => part.id)),
  );
  return history.size === 0 ? [...sections] : sections.filter((part) => !history.has(part.id));
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
): { text: string; nextOffset?: number } | undefined {
  const members = page.members ?? [];
  const start = indexStart(sections, members);
  if (start === -1) return undefined;

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
  };
}

/** What a text names block by block: its headings and the bold labels of its paragraphs. */
function namesIn(text: string): string[] {
  const names: string[] = [];
  for (const block of splitBlocks(text)) {
    const line = block.split('\n')[0] ?? '';
    const label = HEADING.test(line)
      ? line.replace(/^ {0,3}#{1,6}[ \t]+/, '')
      : /^\*\*([^*\n]+)\*\*/.exec(line)?.[1];
    const name = label?.replace(/[`*_]/g, '').trim();
    if (name !== undefined && name !== '' && !names.includes(name)) names.push(name);
  }
  return names;
}

/** The line that says a text was cut by the budget and what the rest holds. */
function cutNote(shown: number, total: number, rest: string): string {
  const names = namesIn(rest);
  const listed = names.slice(0, MAX_CUT_NAMES).join(', ');
  const more = names.length > MAX_CUT_NAMES ? ` and ${names.length - MAX_CUT_NAMES} more` : '';
  const left = names.length === 0 ? '' : ` Not shown: ${listed}${more}.`;
  return `_Cut at the token budget: about ${shown} of ${total} tokens shown.${left}_`;
}

/**
 * Fits sections into the budget and says so when they are cut. A cut does not end on the
 * bold label of a block that did not fit: a parameter name without its description reads as
 * if the parameter had none.
 */
function fitWithNote(
  sections: readonly DocSection[],
  budget: number,
): { text: string; nextOffset?: number } {
  const whole = fitSections(sections, budget);
  if (whole.nextOffset === undefined) return { text: whole.text };
  // The note is part of the answer, so the text makes room for it.
  const reserve = Math.min(NOTE_TOKENS, Math.floor(budget / 10));
  const fit = fitSections(sections, budget - reserve);
  if (fit.nextOffset === undefined) return { text: fit.text };
  let { text, nextOffset } = fit;
  const blocks = splitBlocks(text);
  const last = blocks.at(-1);
  if (blocks.length > 1 && last !== undefined && BOLD_LABEL.test(last.trim())) {
    text = text.slice(0, text.length - last.length).trimEnd();
    nextOffset -= last.length + 2;
  }
  const all = joinSections(sections);
  const note = cutNote(estimateTokens(text), estimateTokens(all), all.slice(nextOffset));
  return { text: `${text}\n\n${note}`, nextOffset };
}

/**
 * The text of a symbol at a detail level within `maxTokens`.
 *
 * - `signature`: the header block when the page has one, else the first code block, plus
 *   one line of description; every overload's declaration, and a deprecation notice.
 * - `summary`: a member in full; a type as its own documentation and a member index, the
 *   index kept when the two do not fit together. Release history goes first when the
 *   budget is short.
 * - `full`: everything.
 *
 * A text that the budget cut ends with a line that says so and names what is missing.
 */
export function symbolText(
  page: DocPage,
  record: CatalogRecord,
  detail: SymbolDetail,
  maxTokens: number,
): SymbolText {
  // Above the signature level, code blocks larger than any budget are divided as the reader
  // divides them, so that a cut can fall inside one and a read can continue at its offset.
  const undivided = ownSections(page, record);
  const own = detail === 'signature' ? undivided : chunkFences(undivided);
  const isType = record.parent === undefined;
  const signature = detail === 'signature' ? signatureOf(own, simpleName(record)) : undefined;
  // The header describes the whole page (a class's constructor call, its import line). A
  // member with a declaration of its own is that declaration at the signature level.
  const ownDeclaration =
    signature !== undefined &&
    !isType &&
    signature.some((section) => /^ {0,3}(?:`{3,}|~{3,})/m.test(section.markdown));
  const header = ownDeclaration ? '' : (page.header?.trim() ?? '');
  const headerTokens = header === '' ? 0 : estimateTokens(header);
  const budget = Math.max(50, maxTokens - headerTokens);

  let sections: DocSection[];
  let historyDropped = false;
  if (signature !== undefined) {
    sections = signature;
  } else if (detail === 'summary') {
    const summary = isType ? typeSummary(page, own) : [...own];
    sections = withoutHistory(summary, budget);
    historyDropped = sections.length < summary.length;
  } else {
    sections = [...own];
  }

  const fits = fitSections(sections, budget).nextOffset === undefined;
  const indexed =
    fits || detail !== 'summary' || !isType ? undefined : fitTypeSummary(page, sections, budget);
  const fit = indexed ?? fitWithNote(sections, budget);

  const reduced = tokensOf(sections) < tokensOf(own);
  // The offset is only meaningful when the text shown is the start of the full one.
  const continuous = indexed === undefined && joinSections(sections) === joinSections(own);
  return {
    text: [header, mergeChunks(fit.text)].filter((part) => part !== '').join('\n\n'),
    truncated:
      fit.nextOffset !== undefined ||
      indexed !== undefined ||
      historyDropped ||
      (detail === 'signature' && reduced),
    ...(continuous && fit.nextOffset !== undefined ? { cutOffset: fit.nextOffset } : {}),
    budgetCut: fit.nextOffset !== undefined,
    totalTokens: headerTokens + tokensOf(own),
    own,
  };
}
