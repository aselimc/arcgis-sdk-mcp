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
 * The order of the shared passes is load-bearing: code blocks and tabs read the buttons that
 * the bulk removal deletes, icon labels are read before SVGs go, and tables are rewritten
 * after everything that can sit inside a cell has its final shape.
 */
import { load, type CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { RenderMeta, RenderOptions, SectionSelector } from '../core/ports.js';
import { sectionSubtree } from '../core/sections.js';
import type { DocSection, MemberEntry, SourceFile } from '../core/types.js';
import { buildSections, stripHeadingMarks } from './build-sections.js';
import { squash, tagged } from './dom.js';
import { absolutize } from './passes/absolutize.js';
import { fixAsides } from './passes/fix-asides.js';
import { fixCodeLinks } from './passes/fix-code-links.js';
import { fixDetails } from './passes/fix-details.js';
import { fixDl } from './passes/fix-dl.js';
import { fixExpressiveCode } from './passes/fix-expressive-code.js';
import { fixGatsbyCode } from './passes/fix-gatsby-code.js';
import { fixGenericPre } from './passes/fix-generic-pre.js';
import { fixGlossary } from './passes/fix-glossary.js';
import { fixIslands } from './passes/fix-islands.js';
import { fixTables } from './passes/fix-tables.js';
import { fixTabs } from './passes/fix-tabs.js';
import { iconLabelsToText } from './passes/icon-labels.js';
import { removeCommon } from './passes/remove-common.js';
import { unwrapBlockyInline } from './passes/unwrap-blocky-inline.js';
import { postProcess } from './post-process.js';
import { sliceByHeading } from './slice.js';
import type { Converted } from './turndown.js';
import type { FamilyProfile, OutlineNode, PageView, Pass, PassCounters, PassEnv } from './types.js';

/** The shared passes, in the only order in which they are correct. */
export const SHARED_PASSES: readonly Pass[] = [
  fixGlossary,
  fixExpressiveCode,
  fixGatsbyCode,
  fixIslands,
  fixTabs,
  iconLabelsToText,
  removeCommon,
  fixDetails,
  fixCodeLinks,
  fixAsides,
  fixDl,
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
  return member === undefined ? {} : { member };
}

/** Moves the nodes into a working document, runs the steps over it and converts the result. */
function convertNodes(
  nodes: AnyNode[],
  steps: ReadonlyArray<Pass | undefined>,
  env: PassEnv,
  convert: (html: string) => Converted,
): Converted {
  const $ = load('', null, false);
  $.root().append(nodes);
  for (const step of steps) step?.($, env);
  const converted = convert($.html());
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

  const counters: PassCounters = { tables: {}, unknownIslands: new Set() };
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
    work.root().prepend(tagged('h1', title));
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
