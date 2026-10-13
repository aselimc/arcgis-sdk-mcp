/**
 * The extraction pipeline:
 *
 * ```
 * html -> cheerio -> family profile: root, title, members, files, header, outline
 *      -> slice to the selected section / member (before cleaning)
 *      -> profile.prepare -> the shared passes in fixed order -> profile.clean
 *      -> Turndown -> post-process -> sections with page ids
 * ```
 *
 * The order of the shared passes is load-bearing: code blocks, code switchers and tabs read
 * the buttons that the bulk removal deletes, icon labels are read before SVGs go, hidden
 * elements are removed only after the tab and code passes have revealed the panels a page
 * hides on purpose, and tables are rewritten after everything that can sit inside a cell
 * has its final shape.
 */
import { load, type CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { RenderMeta, RenderOptions, SectionSelector } from '../core/ports.js';
import { sectionSubtree } from '../core/sections.js';
import type { DocSection, MemberEntry, SourceFile } from '../core/types.js';
import { buildSections, stripHeadingMarks } from './build-sections.js';
import { isElement, moveInto, squash, tagged, WORK_ROOT, workRoot } from './dom.js';
import { absolutize } from './passes/absolutize.js';
import { fixAsides } from './passes/fix-asides.js';
import { fixCodeLinks } from './passes/fix-code-links.js';
import { fixCodeSwitchers } from './passes/fix-code-switchers.js';
import { fixDetails } from './passes/fix-details.js';
import { fixDl } from './passes/fix-dl.js';
import { fixExpressiveCode } from './passes/fix-expressive-code.js';
import { fixGatsbyCode } from './passes/fix-gatsby-code.js';
import { fixGenericPre } from './passes/fix-generic-pre.js';
import { fixGlossary } from './passes/fix-glossary.js';
import { fixIslands } from './passes/fix-islands.js';
import { fixLinkGroups } from './passes/fix-link-groups.js';
import { fixLists } from './passes/fix-lists.js';
import { fixTables } from './passes/fix-tables.js';
import { fixTabs } from './passes/fix-tabs.js';
import { iconLabelsToText } from './passes/icon-labels.js';
import { removeCommon } from './passes/remove-common.js';
import { removeHidden } from './passes/remove-hidden.js';
import { unwrapBlockyInline } from './passes/unwrap-blocky-inline.js';
import { postProcess } from './post-process.js';
import { sliceByHeading } from './slice.js';
import type { Converted } from './turndown.js';
import type { FamilyProfile, OutlineNode, PageView, Pass, PassCounters, PassEnv } from './types.js';

/** The shared passes, in the only order in which they are correct. */
export const SHARED_PASSES: readonly Pass[] = [
  fixGlossary,
  fixCodeSwitchers,
  fixExpressiveCode,
  fixGatsbyCode,
  fixIslands,
  fixTabs,
  iconLabelsToText,
  removeCommon,
  removeHidden,
  fixDetails,
  fixCodeLinks,
  fixAsides,
  fixDl,
  fixLists,
  fixLinkGroups,
  unwrapBlockyInline,
  fixTables,
  fixGenericPre,
  absolutize,
];

/** What one profile made of a page. */
export interface ProfileResult {
  title: string;
  header?: string;
  /** The selected part when `selected` is set, else the whole page. */
  sections: DocSection[];
  members?: MemberEntry[];
  files?: SourceFile[];
  /** The member the selector resolved to, when it named one. */
  selected?: MemberEntry;
  /** True when `sections` hold a slice. */
  sliced: boolean;
  counters: PassCounters;
}

interface Selection {
  nodes?: AnyNode[];
  member?: MemberEntry;
}

/** Resolves a selector against the members and the outline, and cuts the nodes out. */
function select(
  profile: FamilyProfile,
  page: PageView,
  outline: OutlineNode[],
  members: MemberEntry[],
  selector: SectionSelector | undefined,
): Selection {
  const key = selector?.member ?? selector?.section;
  if (key === undefined) return {};
  const byId = members.find((member) => member.id === key);
  const byName = members.find((member) => member.name === key);
  const section =
    outline.find((node) => node.id === key) ?? outline.find((node) => node.alias === key);
  // A member selector prefers members; a section selector prefers sections, except that a
  // member id always wins: member cards carry headings of their own.
  const preferSection = selector?.member === undefined && section !== undefined;
  const member = byId ?? (preferSection ? undefined : byName);
  if (member !== undefined) {
    const nodes = profile.sliceMember?.(page, member.id);
    if (nodes !== undefined && nodes.length > 0) return { nodes, member };
  }
  if (section !== undefined) return { nodes: sliceByHeading(page, section) };
  if (member !== undefined) return { member };
  // An anchor that is neither a listed member nor a heading (the field of a type definition).
  const nodes = profile.sliceMember?.(page, key);
  return nodes !== undefined && nodes.length > 0 ? { nodes } : {};
}

/** Children of one element above which they are grouped before conversion. */
const WIDE = 512;
/** Elements whose children mean something only as direct children. */
const NOT_CHUNKED = new Set(
  'ul ol dl table thead tbody tfoot tr pre code select a em strong b i span'.split(' '),
);

/**
 * Groups the children of very wide elements into plain `div`s of {@link WIDE}. The Markdown
 * converter joins the output of siblings one by one, re-reading everything joined so far,
 * so its cost grows with the square of the number of siblings: ten thousand top-level
 * blocks take seconds, grouped they take milliseconds. A `div` adds nothing to the Markdown
 * of block content. Lists, tables and inline elements are left as they are.
 */
function chunkWideElements($: CheerioAPI): void {
  const wide = $('*')
    .get()
    .filter((el) => isElement(el) && el.children.length > WIDE && !NOT_CHUNKED.has(el.tagName));
  for (const el of wide) {
    if (!isElement(el)) continue;
    const children = [...el.children];
    const groups: AnyNode[] = [];
    for (let start = 0; start < children.length; start += WIDE) {
      const group = $('<div></div>').get(0);
      if (!isElement(group)) return;
      moveInto(group, children.slice(start, start + WIDE));
      groups.push(group);
    }
    moveInto(el, groups);
  }
}

/** Moves the nodes into a working document, runs the steps over it and converts the result. */
function convertNodes(
  nodes: AnyNode[],
  steps: ReadonlyArray<Pass | undefined>,
  env: PassEnv,
  convert: (html: string) => Converted,
): Converted {
  const $ = load(`<${WORK_ROOT}></${WORK_ROOT}>`, null, false);
  const holder = workRoot($).get(0);
  if (isElement(holder)) moveInto(holder, nodes);
  for (const step of steps) step?.($, env);
  chunkWideElements($);
  const converted = convert(workRoot($).html() ?? '');
  return { markdown: postProcess(converted.markdown), headingIds: converted.headingIds };
}

/**
 * Applies one family profile to a parsed page, which it consumes: the content nodes are
 * moved out of it. Returns `undefined` when the page has no content root for this family,
 * which the caller treats as drift.
 */
export function runProfile(
  $: CheerioAPI,
  profile: FamilyProfile,
  meta: RenderMeta,
  opts: RenderOptions,
  convert: (html: string) => Converted,
): ProfileResult | undefined {
  // The title often lives outside the content root; `<title>` is the last resort.
  const ownTitle = squash(profile.title($));
  const title = ownTitle === '' ? squash($('title').first().text()) : ownTitle;
  const root = profile.root($);
  if (root.length === 0) return undefined;
  const page: PageView = { $, root, title, url: meta.url.replace(/#.*$/, '') };

  const members = profile.members?.(page);
  const files = profile.files?.(page);
  const headerNodes = profile.header?.(page) ?? [];
  const outline = profile.outline(page);
  const selection = select(profile, page, outline, members ?? [], opts.select);

  const counters: PassCounters = { tables: {}, unknownIslands: new Set(), collapsedCode: 0 };
  const env: PassEnv = {
    url: page.url,
    title,
    focusedCode: opts.focusedCode === true,
    defaultLanguage: profile.defaultLanguage,
    overview:
      profile.overviewDropsMembers === true &&
      selection.nodes === undefined &&
      (opts.detail === 'signature' || opts.detail === 'summary'),
    counters,
  };

  const whole = selection.nodes === undefined;
  // The page's own title heading is removed by `prepare`; every full page opens with one.
  const addTitle: Pass = (work) => {
    workRoot(work).prepend(tagged('h1', title));
  };
  const body = convertNodes(
    selection.nodes ?? root.contents().get(),
    [profile.prepare, whole ? addTitle : undefined, ...SHARED_PASSES, profile.clean],
    env,
    convert,
  );
  let sections = buildSections(body);
  let sliced = !whole;

  // A section the page markup could not be cut at (a generated heading) is cut afterwards.
  const key = opts.select?.member ?? opts.select?.section;
  if (whole && key !== undefined) {
    const subtree = sectionSubtree(sections, selection.member?.id ?? key);
    if (subtree.length > 0) {
      sections = subtree;
      sliced = true;
    }
  }

  const header =
    headerNodes.length === 0
      ? ''
      : stripHeadingMarks(convertNodes(headerNodes, SHARED_PASSES, env, convert).markdown);

  return {
    title,
    ...(header === '' ? {} : { header }),
    sections,
    ...(members === undefined ? {} : { members }),
    ...(files === undefined ? {} : { files }),
    ...(selection.member === undefined || !sliced ? {} : { selected: selection.member }),
    sliced,
    counters,
  };
}
