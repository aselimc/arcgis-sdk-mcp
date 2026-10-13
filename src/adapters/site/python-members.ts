/**
 * The members of an ArcPy class page.
 *
 * The HTML profiles of the two help layouts convert a class page faithfully, but as prose:
 * its properties are rows of one "Properties" section and its methods are headings or code
 * lines of one "Methods" section, and the page reports no member list. A caller that knows
 * the name `exportToPDF` then has nothing to find it by. This module gives every property
 * and method a section of its own (`property-<name>`, `method-<name>`) and lists them in
 * `DocPage.members`, so that a member can be looked up, selected and indexed like the
 * members of every other API reference.
 *
 * Both layouts are understood:
 *
 * | | doc.esri.com | pro.arcgis.com (earlier releases) |
 * |---|---|---|
 * | property | a row starting with the name in bold code, then its type | a row `name (Read Only)` in bold |
 * | method | a heading of its own under "Methods", id `method-<name>` | a one-line code block `name (parameters)` |
 *
 * A page whose renderer reports members itself, or that has neither section, is returned
 * as it is.
 */
import { estimateTokens } from '../../core/budget.js';
import { stepFence, type OpenFence } from '../../core/fences.js';
import type { SectionSelector } from '../../core/ports.js';
import { sectionSubtree } from '../../core/sections.js';
import type { DocPage, DocSection, MemberEntry } from '../../core/types.js';
import { oneLine, withRef } from '../kit/index.js';

const PROPERTIES_ID = 'properties';
const METHODS_ID = 'methods';
/** A method that is a section already: `method-exportToPDF`, `method-export-1`. */
const METHOD_SECTION = /^method-(.+?)(?:-\d+)?$/;
/** A property row of doc.esri.com: the name in bold code, then a dash and its type. */
const CODE_ROW = /^\*\*`([A-Za-z_][A-Za-z0-9_]*)`\*\*(.*)$/;
/** A property row of the earlier layout: the name and its access in bold. */
const ACCESS_ROW = /^\*\*([A-Za-z_][A-Za-z0-9_]*)\s*\((Read[^)]*)\)\*\*\s*$/;
/** The only line of a code block that states a method: `exportToPDF (out_pdf, {resolution})`. */
const SIGNATURE_LINE = /^([A-Za-z_][A-Za-z0-9_]*)\s*(\(.*\))\s*$/;
const SUMMARY_CHARS = 160;

/** One member cut out of the section that lists it. */
interface Cut {
  kind: 'property' | 'method';
  name: string;
  /** Heading text: the name of a property, the call of a method. */
  title: string;
  /** What the row of a property says besides its name, as Markdown: its type or its access. */
  note: string;
  /** The type of a property, when its row states it. */
  type?: string;
  /** The lines that document the member, without the row or code block that opened it. */
  body: string[];
}

function sectionOf(
  base: Pick<DocSection, 'level' | 'parent'>,
  id: string,
  title: string,
  markdown: string,
): DocSection {
  return {
    id,
    level: base.level,
    title,
    markdown,
    tokens: estimateTokens(markdown),
    ...(base.parent === undefined ? {} : { parent: base.parent }),
  };
}

/** The first sentence-like line of a member's text: labels, tables and code are skipped. */
function summaryOf(lines: readonly string[]): string | undefined {
  let open: OpenFence;
  for (const line of lines) {
    const step = stepFence(line, open);
    open = step.open;
    if (step.fenced) continue;
    const text = line
      .replace(/^\s*(?:[-*]\s+|>\s*)+/, '')
      .replace(/^\*\*[^*]+:\*\*\s*/, '')
      .trim();
    if (text === '' || text.startsWith('|') || text.startsWith('#')) continue;
    return oneLine(text, SUMMARY_CHARS);
  }
  return undefined;
}

/** The type of a property: from its row, else from a `- **Data Type:** X` line of its text. */
function typeOf(cut: Cut): string | undefined {
  if (cut.type !== undefined) return cut.type;
  for (const line of cut.body) {
    const stated = /\*\*Data Type:\*\*\s*(.+)$/.exec(line)?.[1];
    if (stated !== undefined) return oneLine(stated);
  }
  return undefined;
}

/**
 * Splits the lines of a section into what precedes its first member and the members.
 * `open` says, for a line outside a code block, which member it starts (if any).
 */
function cutMembers(
  lines: readonly string[],
  open: (line: string, next: readonly string[]) => { cut: Cut; skip: number } | undefined,
): { lead: string[]; cuts: Cut[] } {
  const lead: string[] = [];
  const cuts: Cut[] = [];
  let fence: OpenFence;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    const started = fence === undefined ? open(line, lines.slice(index + 1)) : undefined;
    if (started !== undefined) {
      cuts.push(started.cut);
      index += started.skip;
      continue;
    }
    fence = stepFence(line, fence).open;
    (cuts.at(-1)?.body ?? lead).push(line);
  }
  return { lead, cuts };
}

function propertyRow(line: string): { cut: Cut; skip: number } | undefined {
  const coded = CODE_ROW.exec(line);
  const accessed = coded === null ? ACCESS_ROW.exec(line) : null;
  const name = coded?.[1] ?? accessed?.[1];
  if (name === undefined) return undefined;
  if (accessed !== null) {
    const note = `_${accessed[2] ?? ''}_`;
    return { cut: { kind: 'property', name, title: name, note, body: [] }, skip: 0 };
  }
  // `— _String_, required` after the name; the type may be a link, whose URL may hold `_`.
  const note = (coded?.[2] ?? '').replace(/^\s*[—-]\s*/, '').trim();
  const type = oneLine(/^_(.+)_(?=,|$)/.exec(note)?.[1]);
  return {
    cut: {
      kind: 'property',
      name,
      title: name,
      note,
      body: [],
      ...(type === undefined ? {} : { type }),
    },
    skip: 0,
  };
}

/** A code block of exactly one line that reads like a call opens a method. */
function methodBlock(
  line: string,
  next: readonly string[],
): { cut: Cut; skip: number } | undefined {
  if (!/^ {0,3}(?:`{3,}|~{3,})/.test(line)) return undefined;
  const call = SIGNATURE_LINE.exec((next[0] ?? '').trim());
  const closes = /^ {0,3}(?:`{3,}|~{3,})\s*$/.test(next[1] ?? '');
  if (call?.[1] === undefined || !closes) return undefined;
  const title = `${call[1]}${call[2] ?? '()'}`;
  return { cut: { kind: 'method', name: call[1], title, note: '', body: [] }, skip: 2 };
}

/** The sections of one cut-up section: what is left of it, then one section per member. */
function memberSections(
  parent: DocSection,
  lead: readonly string[],
  cuts: readonly Cut[],
  used: Set<string>,
): { sections: DocSection[]; members: MemberEntry[] } {
  const heading = '#'.repeat(Math.min(6, parent.level + 1));
  const own = lead.join('\n').trim();
  const sections = [{ ...parent, markdown: own, tokens: estimateTokens(own) }];
  const members: MemberEntry[] = [];
  for (const cut of cuts) {
    let id = `${cut.kind}-${cut.name}`;
    for (let count = 1; used.has(id); count++) id = `${cut.kind}-${cut.name}-${count}`;
    used.add(id);
    const text = [cut.note, cut.body.join('\n').trim()].filter((part) => part !== '');
    const markdown = [`${heading} \`${cut.title}\``, ...text].join('\n\n');
    sections.push(
      sectionOf({ level: parent.level + 1, parent: parent.id }, id, cut.title, markdown),
    );
    members.push(entryOf(cut, id));
  }
  return { sections, members };
}

function entryOf(cut: Cut, id: string): MemberEntry {
  const type = cut.kind === 'property' ? typeOf(cut) : undefined;
  const summary = summaryOf(cut.body);
  return {
    id,
    name: cut.name,
    kind: cut.kind,
    signature: type === undefined ? cut.title : `${cut.title}: ${type}`,
    ...(summary === undefined ? {} : { summary }),
    ...(/read only/i.test(cut.note) ? { readonly: true } : {}),
  };
}

/**
 * A method that the page already documents under a heading of its own, below "Methods". The
 * place matters: the earlier layout has a "Method Overview" table next to it, whose id
 * (`method-overview`) reads like a method named `overview`.
 */
function headedMethod(section: DocSection): MemberEntry | undefined {
  const name = section.parent === METHODS_ID ? METHOD_SECTION.exec(section.id)?.[1] : undefined;
  if (name === undefined) return undefined;
  const summary = summaryOf(section.markdown.split('\n').slice(1));
  return {
    id: section.id,
    // The heading is the call as written; the id has lost nothing but may carry a counter.
    name: /^([A-Za-z_][A-Za-z0-9_]*)/.exec(section.title)?.[1] ?? name,
    kind: 'method',
    signature: section.title,
    ...(summary === undefined ? {} : { summary }),
  };
}

/** A class page with its members, and where each member is on the published page. */
interface ClassPage {
  page: DocPage;
  /**
   * The anchor of the published page nearest to each member, by member id: a method heading
   * of doc.esri.com is an anchor itself; a property row or a method line is not, so its
   * section ("properties", "methods") stands in.
   */
  anchors: ReadonlyMap<string, string>;
}

function classPage(page: DocPage): ClassPage | undefined {
  if ((page.members?.length ?? 0) > 0) return undefined;
  // Only a whole page can say what all the members are; a slice starts below the title.
  if ((page.sections[0]?.level ?? 0) > 1) return undefined;

  const used = new Set(page.sections.map((section) => section.id));
  const sections: DocSection[] = [];
  const members: MemberEntry[] = [];
  const anchors = new Map<string, string>();
  for (const section of page.sections) {
    const lines = section.markdown.split('\n');
    const cut =
      section.id === PROPERTIES_ID
        ? cutMembers(lines, propertyRow)
        : section.id === METHODS_ID
          ? cutMembers(lines, methodBlock)
          : undefined;
    if (cut !== undefined && cut.cuts.length > 0) {
      const made = memberSections(section, cut.lead, cut.cuts, used);
      sections.push(...made.sections);
      members.push(...made.members);
      for (const member of made.members) anchors.set(member.id, section.id);
      continue;
    }
    sections.push(section);
    const headed = headedMethod(section);
    if (headed === undefined) continue;
    members.push(headed);
    anchors.set(headed.id, headed.id);
  }
  return members.length === 0 ? undefined : { page: { ...page, sections, members }, anchors };
}

/** The member a selector names by its id or name; letter case decides only between ties. */
function memberNamed(
  members: readonly MemberEntry[],
  select: SectionSelector | undefined,
): MemberEntry | undefined {
  const wanted = select?.member ?? select?.section;
  if (wanted === undefined) return undefined;
  // `exportToPDF()` names the method `exportToPDF`.
  const name = wanted.replace(/\(.*\)$/s, '').trim();
  return (
    members.find((entry) => entry.id === wanted || entry.name === name) ??
    members.find((entry) => entry.name.toLowerCase() === name.toLowerCase())
  );
}

/**
 * Gives the properties and methods of an ArcPy class page sections of their own and lists
 * them as the page's members. With a selector that names one of them (by name or section
 * id) the page is cut to that member, as `SectionSelector` asks of every adapter, and its
 * ref points at the anchor the published page has for it, not at the bare name.
 *
 * The page is returned unchanged when its renderer reports members itself or already cut
 * it to a part, and when it documents neither properties nor methods.
 */
export function withPythonMembers(page: DocPage, select?: SectionSelector): DocPage {
  const found = classPage(page);
  if (found === undefined) return page;
  const member = memberNamed(found.page.members ?? [], select);
  const sections = member === undefined ? [] : sectionSubtree(found.page.sections, member.id);
  if (member === undefined || sections.length === 0) return found.page;

  const anchor = found.anchors.get(member.id) ?? member.id;
  return withRef({ ...found.page, sections }, `${page.url}#${anchor}`);
}
