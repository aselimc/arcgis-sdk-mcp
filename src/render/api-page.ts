/**
 * The common layout of an API reference entry. TypeDoc, Custom Elements Manifests, `.d.ts`
 * files, C# doc XML and Sphinx pages are all reduced to an {@link ApiType} with
 * {@link ApiMember}s; this module turns that model into sections, applies the detail level
 * and selects a member, so the five sources read alike and behave alike.
 */
import type { RenderMeta, RenderOptions } from '../core/ports.js';
import type { DocPage, MemberEntry, SymbolDetail } from '../core/types.js';
import { slugify } from '../core/url.js';
import { blocks, bullets, fence, fencedExample, firstSentence, inlineCode, oneLine } from './md.js';
import { buildSections, finishPage, type Block } from './page.js';

/** One parameter of a callable member. */
export interface ApiParam {
  name: string;
  type?: string;
  optional?: boolean;
  default?: string;
  description?: string;
}

/** Documentation shared by types and members. All text fields are Markdown. */
export interface ApiDoc {
  /** Declaration text shown in a fence. */
  signature?: string;
  /** Lines shown right under the declaration, for example the list of base classes. */
  facts?: string[];
  description?: string;
  since?: string;
  /** `true` when deprecated without a note. */
  deprecated?: string | boolean;
  params?: ApiParam[];
  returns?: string;
  throws?: string[];
  examples?: string[];
  see?: string[];
}

/** One member of a type (property, method, event, ...) or one export of a module. */
export interface ApiMember extends ApiDoc {
  /** Anchor of the member on its page; becomes the section id and `MemberEntry.id`. */
  id: string;
  name: string;
  /** Lower-case kind: `property`, `method`, `event`, `constructor`, `function`, ... */
  kind: string;
  /** Heading the member is listed under, for example `Properties`. */
  group: string;
  /** Short facts shown on one line: `readonly`, `static`, ``attribute `icon` ``. */
  flags?: string[];
  inheritedFrom?: string;
  readonly?: boolean;
  /** Markdown appended at detail `full`, for content that fits no other field. */
  extra?: string;
}

/** A documented type, component or module. */
export interface ApiType extends ApiDoc {
  title: string;
  /** Section id of the type itself, when it has an anchor of its own; default the title's slug. */
  id?: string;
  /** Identity block (kind, package, import line); becomes `DocPage.header`. */
  header?: string;
  /** Fence language of every signature on the page. */
  language: string;
  members: ApiMember[];
  /** Sections that follow the members (slots, CSS properties). */
  trailing?: Block[];
  notices?: string[];
  unknown?: string[];
}

function deprecation(doc: ApiDoc): string | undefined {
  if (doc.deprecated === undefined || doc.deprecated === false) return undefined;
  const note = doc.deprecated === true ? '' : ` ${oneLine(doc.deprecated)}`;
  return `> **Deprecated:**${note}`.replace(/:\*\*$/, '**');
}

function paramLine(param: ApiParam): string {
  const facts = [
    param.type === undefined ? undefined : inlineCode(param.type),
    param.optional === true ? 'optional' : undefined,
    param.default === undefined ? undefined : `default ${inlineCode(param.default)}`,
  ].filter((fact) => fact !== undefined);
  const head = `${inlineCode(param.name)}${facts.length > 0 ? ` (${facts.join(', ')})` : ''}`;
  return param.description === undefined || param.description.trim() === ''
    ? head
    : `${head}: ${param.description.trim()}`;
}

function examplesOf(doc: ApiDoc, language: string, limit: number): string | undefined {
  const examples = (doc.examples ?? []).slice(0, limit);
  if (examples.length === 0) return undefined;
  const label = examples.length === 1 ? '**Example**' : '**Examples**';
  return blocks(label, ...examples.map((example) => fencedExample(example, language)));
}

/** Body of a documented entity at one detail level (the rules of `RenderOptions.detail`). */
function docBody(doc: ApiDoc & Partial<ApiMember>, language: string, detail: SymbolDetail): string {
  const signature = doc.signature === undefined ? undefined : fence(doc.signature, language);
  if (detail === 'signature') return blocks(signature, firstSentence(doc.description));

  const flags = [...(doc.flags ?? [])];
  if (doc.since !== undefined) flags.push(`since ${doc.since}`);
  if (doc.inheritedFrom !== undefined) flags.push(`inherited from ${doc.inheritedFrom}`);
  const full = detail === 'full';
  return blocks(
    signature,
    flags.length > 0 ? `_${flags.join(' · ')}_` : undefined,
    ...(doc.facts ?? []),
    deprecation(doc),
    doc.description,
    doc.params !== undefined && doc.params.length > 0
      ? blocks('**Parameters**', bullets(doc.params.map(paramLine)))
      : undefined,
    doc.returns === undefined ? undefined : `**Returns:** ${doc.returns.trim()}`,
    full && doc.throws !== undefined && doc.throws.length > 0
      ? blocks('**Throws**', bullets(doc.throws))
      : undefined,
    examplesOf(doc, language, full ? Number.POSITIVE_INFINITY : 1),
    full && doc.see !== undefined && doc.see.length > 0
      ? blocks('**See also**', bullets(doc.see))
      : undefined,
    full ? doc.extra : undefined,
  );
}

/** The section of one member. */
export function memberBlock(
  member: ApiMember,
  language: string,
  detail: SymbolDetail,
  level: number,
): Block {
  return {
    id: member.id,
    level,
    title: member.name,
    body: docBody(member, language, detail),
  };
}

function indexLine(member: ApiMember): string {
  const marks = [
    member.readonly === true ? 'readonly' : undefined,
    member.inheritedFrom === undefined ? undefined : `inherited from ${member.inheritedFrom}`,
    member.deprecated === undefined || member.deprecated === false ? undefined : 'deprecated',
  ].filter((mark) => mark !== undefined);
  const summary = firstSentence(member.description);
  return [
    inlineCode(member.name),
    marks.length > 0 ? ` _(${marks.join(', ')})_` : '',
    summary === '' ? '' : `: ${summary}`,
  ].join('');
}

/** Members grouped by `group`, groups in order of first appearance. */
function grouped(members: readonly ApiMember[]): Array<[string, ApiMember[]]> {
  const groups = new Map<string, ApiMember[]>();
  for (const member of members) {
    const bucket = groups.get(member.group);
    if (bucket === undefined) groups.set(member.group, [member]);
    else bucket.push(member);
  }
  return [...groups];
}

/**
 * The sections of a whole type, starting at heading `level`:
 *
 * - `signature`: the title with the declaration and a one-line summary;
 * - `summary`: the description and, per group, a one-line index of the members;
 * - `full`: the description and one section per member.
 */
export function typeBlocks(
  type: ApiType,
  detail: SymbolDetail,
  level: number,
  id?: string,
): Block[] {
  const top: Block = {
    ...(id === undefined ? {} : { id }),
    level,
    title: type.title,
    body: docBody(type, type.language, detail),
  };
  if (detail === 'signature') return [top];

  const result: Block[] = [top];
  const groupLevel = Math.min(6, level + 1);
  const memberLevel = Math.min(6, level + 2);
  for (const [group, members] of grouped(type.members)) {
    result.push({
      // A nested type's groups are qualified so they cannot take the page-level group ids.
      ...(id === undefined ? {} : { id: `${id}-${slugify(group)}` }),
      level: groupLevel,
      title: group,
      body: detail === 'summary' ? bullets(members.map(indexLine)) : '',
    });
    if (detail === 'full') {
      result.push(
        ...members.map((member) => memberBlock(member, type.language, 'full', memberLevel)),
      );
    }
  }
  result.push(...(type.trailing ?? []));
  return result;
}

/** The `MemberEntry` list of a type: every member, whatever part of the page is shown. */
export function memberEntries(members: readonly ApiMember[]): MemberEntry[] {
  return members.map((member) => {
    const summary = firstSentence(member.description);
    return {
      id: member.id,
      name: member.name,
      kind: member.kind,
      ...(member.signature === undefined ? {} : { signature: oneLine(member.signature) }),
      ...(summary === '' ? {} : { summary }),
      ...(member.inheritedFrom === undefined ? {} : { inheritedFrom: member.inheritedFrom }),
      ...(member.deprecated === undefined || member.deprecated === false
        ? {}
        : { deprecated: true }),
      ...(member.readonly === true ? { readonly: true } : {}),
    };
  });
}

/** Gives members that share an id (overloads, a property and a method) distinct anchors. */
export function distinctIds<M extends ApiMember>(members: readonly M[]): M[] {
  const seen = new Map<string, number>();
  return members.map((member) => {
    const count = seen.get(member.id) ?? 0;
    seen.set(member.id, count + 1);
    return count === 0 ? member : { ...member, id: `${member.id}-${count}` };
  });
}

/** Finds a member by id, then by name, then by name ignoring case. */
export function findMember<M extends ApiMember>(
  members: readonly M[],
  wanted: string | undefined,
): M | undefined {
  if (wanted === undefined || wanted === '') return undefined;
  const lower = wanted.toLowerCase();
  return (
    members.find((member) => member.id === wanted) ??
    members.find((member) => member.name === wanted) ??
    members.find((member) => member.name.toLowerCase() === lower)
  );
}

/**
 * Renders a type as a page.
 *
 * With `member` (or `opts.select.member`) naming one of the type's members, `sections` hold
 * that member only, rendered at `opts.detail`; `title`, `header` and `members` still describe
 * the whole type. An unknown member name gives the whole type, as `SectionSelector` requires.
 */
export function renderApiPage(
  renderer: string,
  meta: RenderMeta,
  type: ApiType,
  opts: RenderOptions | undefined,
  member?: string,
): DocPage {
  const detail = opts?.detail ?? 'full';
  const members = distinctIds(type.members);
  const selected = findMember(members, member ?? opts?.select?.member);
  const sectionBlocks =
    selected === undefined
      ? typeBlocks({ ...type, members }, detail, 1, type.id)
      : [memberBlock(selected, type.language, detail, 3)];
  return finishPage(
    renderer,
    meta,
    {
      title: type.title,
      ...(type.header === undefined ? {} : { header: type.header }),
      sections: buildSections(sectionBlocks),
      members: memberEntries(members),
      ...(type.notices === undefined ? {} : { notices: type.notices }),
      ...(type.unknown === undefined ? {} : { unknown: type.unknown }),
    },
    opts,
  );
}
