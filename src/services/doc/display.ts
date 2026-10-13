/**
 * Sections the doc service derives from a page rather than receives in it: the source files
 * of a sample, its relevant-API list, a member index for a type, and the placeholder page
 * returned when a document cannot be fetched at all.
 */
import { estimateTokens } from '../../core/budget.js';
import type { RenderMeta } from '../../core/ports.js';
import { pageProvenance } from '../../core/provenance.js';
import { sectionsFromMarkdown } from '../../core/sections.js';
import type { DocPage, DocSection, MemberEntry, SourceFile } from '../../core/types.js';

/** Id of the section holding a sample's main source file; further files are `source-2`, ... */
export const SOURCE_SECTION_ID = 'source';
/** Id of the generated relevant-APIs section of a sample. */
export const APIS_SECTION_ID = 'relevant-apis';
/** Id of the generated member index of a type. */
export const MEMBERS_SECTION_ID = 'members';
/** Id of the generated list of a sample's other files. */
const OTHER_FILES_SECTION_ID = 'other-source-files';

function section(id: string, title: string, body: string): DocSection {
  const markdown = `## ${title}\n\n${body}`;
  return { id, level: 2, title, markdown, tokens: estimateTokens(markdown) };
}

/** A fence that cannot be closed by anything inside `text`. */
function fenced(text: string, language: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((run) => run[0].length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}${language}\n${text.replace(/\s+$/, '')}\n${fence}`;
}

/** One section per source file: the main file is `source`, the others `source-2`, `source-3`, ... */
export function fileSections(files: readonly SourceFile[]): DocSection[] {
  return files.map((file, position) =>
    section(
      position === 0 ? SOURCE_SECTION_ID : `${SOURCE_SECTION_ID}-${position + 1}`,
      `Source: ${file.name}`,
      fenced(file.text, file.language),
    ),
  );
}

function apisSection(page: DocPage): DocSection[] {
  const apis = page.relevantApis ?? [];
  const present = page.sections.some((existing) => /relevant[- ]apis?/i.test(`${existing.id} ${existing.title}`));
  if (apis.length === 0 || present) return [];
  return [section(APIS_SECTION_ID, 'Relevant APIs', apis.map((api) => `- ${api}`).join('\n'))];
}

/**
 * The sections of a page as the doc service shows them.
 *
 * - `default`: what `view: "auto"` reads. For a sample: description, relevant APIs and the
 *   main source file, with the other files listed by name.
 * - `all`: everything, for `view: "full"`, section resolution and the outline.
 */
export function displaySections(page: DocPage, scope: 'default' | 'all'): DocSection[] {
  const files = page.files ?? [];
  if (files.length === 0) return [...page.sections, ...apisSection(page)];
  const sources = fileSections(files);
  const [main, ...others] = sources;
  if (scope === 'all' || others.length === 0) {
    return [...page.sections, ...apisSection(page), ...sources];
  }
  const list = files
    .slice(1)
    .map((file) => `- ${file.name}: ${file.ref}`)
    .join('\n');
  return [
    ...page.sections,
    ...apisSection(page),
    ...(main === undefined ? [] : [main]),
    section(OTHER_FILES_SECTION_ID, 'Other source files', `${list}\n\nRead them with section "source" or view "full".`),
  ];
}

function memberLine(member: MemberEntry): string {
  const flags = [
    member.deprecated === true ? 'deprecated' : '',
    member.readonly === true ? 'read-only' : '',
    member.inheritedFrom === undefined ? '' : `inherited from ${member.inheritedFrom}`,
  ].filter((flag) => flag !== '');
  const summary = member.summary === undefined ? '' : `: ${member.summary.replace(/\s+/g, ' ').trim()}`;
  return `- \`${member.name}\` (${[member.kind, ...flags].join(', ')})${summary}`;
}

/** A one-line-per-member index of a type, grouped by member kind. */
export function memberIndexSection(members: readonly MemberEntry[]): DocSection {
  const kinds = [...new Set(members.map((member) => member.kind))];
  const body = kinds
    .map((kind) => {
      const lines = members.filter((member) => member.kind === kind).map(memberLine);
      return `**${kind}** (${lines.length})\n\n${lines.join('\n')}`;
    })
    .join('\n\n');
  return section(MEMBERS_SECTION_ID, 'Members', body);
}

/** The section for a member that is listed on a page but has no section of its own. */
export function memberSection(member: MemberEntry): DocSection {
  const parts = [
    member.signature === undefined ? '' : fenced(member.signature, ''),
    member.summary ?? '',
    member.inheritedFrom === undefined
      ? ''
      : `Inherited from ${member.inheritedFrom}: look that type up for the full documentation.`,
  ].filter((part) => part !== '');
  const markdown = `### ${member.name}\n\n${parts.join('\n\n')}`.trim();
  return { id: member.id, level: 3, title: member.name, markdown, tokens: estimateTokens(markdown) };
}

/**
 * The last rung of the content ladder: a page that only says where the document is and why
 * it could not be retrieved, so that a read never fails for an upstream problem.
 */
export function linkOnlyPage(meta: RenderMeta, title: string, reason: string): DocPage {
  const markdown = [
    `# ${title}`,
    `This page could not be retrieved: ${reason}.`,
    `Open it directly: <${meta.url}>`,
  ].join('\n\n');
  return {
    ...pageProvenance(meta),
    title,
    sections: sectionsFromMarkdown(markdown),
    degraded: { level: 'link-only', reason },
    diagnostics: {
      family: 'structured',
      fences: 0,
      fencesWithLanguage: 0,
      tablesByStrategy: {},
      unknownIslands: [],
      leftoverHtmlTags: 0,
      redirectHops: 0,
      ms: 0,
    },
    notices: [`Only the link is available: ${reason}.`],
  };
}
