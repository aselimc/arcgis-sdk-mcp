/**
 * C# XML documentation files (`<doc><members><member name="M:Ns.Type.Method(...)">`) to
 * pages. The XML carries prose only: there are no declared types, so signatures are rebuilt
 * from the member id, which encodes the parameter types but not the return type.
 */
import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'cheerio';
import type { RenderMeta, RenderOptions, RendererInputs } from '../core/ports.js';
import type { DocPage } from '../core/types.js';
import { renderApiPage, type ApiMember, type ApiParam, type ApiType } from './api-page.js';
import { blocks, bullets, decodeEntities, fence, inlineCode, oneLine, table } from './md.js';
import { invalidInput } from './page.js';
import { parseMemberId, type MemberId } from './xmldoc-id.js';

const GROUPS: Record<MemberId['prefix'], { group: string; kind: string }> = {
  T: { group: 'Types', kind: 'type' },
  M: { group: 'Methods', kind: 'method' },
  P: { group: 'Properties', kind: 'property' },
  E: { group: 'Events', kind: 'event' },
  F: { group: 'Fields', kind: 'field' },
  N: { group: 'Namespaces', kind: 'namespace' },
};

/** The short name of a `cref` target: `T:Ns.Type` gives `Type`, a method keeps its owner. */
function crefName(cref: string): string {
  const id = parseMemberId(cref);
  if (id === undefined) return cref.replace(/^[A-Z]:/, '');
  if (id.prefix === 'T' || id.prefix === 'N') return id.name;
  return `${id.owner.split('.').at(-1) ?? id.owner}.${id.name}`;
}

/** Conversion state: the document, and code blocks parked while paragraphs are re-flowed. */
interface Api {
  (selector: AnyNode | string | undefined): cheerio.Cheerio<AnyNode>;
  fences: string[];
}

/** Stores a finished block and returns the marker that stands in for it. */
function park($: Api, block: string): string {
  $.fences.push(block);
  return `\n\n@@fence:${$.fences.length - 1}@@\n\n`;
}

/** Code text without the indentation the XML file gives every line of an element. */
function codeText(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').replace(/^\s*\n|\s+$/g, '').split('\n');
  const indent = Math.min(
    ...lines.filter((line) => line.trim() !== '').map((line) => /^\s*/.exec(line)?.[0].length ?? 0),
  );
  return lines.map((line) => line.slice(Number.isFinite(indent) ? indent : 0)).join('\n');
}

function listBlock($: Api, element: Element): string {
  const items = $(element).children('item').toArray();
  const entries = items.map((item) => {
    const term = oneLine(children($, $(item).children('term').get(0)));
    const description = children($, $(item).children('description').get(0) ?? item).trim();
    return { term, description };
  });
  if ($(element).attr('type') === 'table') {
    const header = $(element).children('listheader').get(0);
    const titles = [
      oneLine(children($, $(header).children('term').get(0))) || 'Term',
      oneLine(children($, $(header).children('description').get(0))) || 'Description',
    ];
    return table(titles, entries.map((entry) => [entry.term, entry.description]));
  }
  const lines = entries.map((entry) =>
    entry.term === '' || entry.term === entry.description ? entry.description : `**${entry.term}**: ${entry.description}`,
  );
  return $(element).attr('type') === 'number'
    ? lines.map((line, index) => `${index + 1}. ${line}`).join('\n')
    : bullets(lines);
}

/** Converts one node of a doc comment to Markdown. Block elements are set off by blank lines. */
function node($: Api, item: AnyNode): string {
  if (item.type === 'text') return item.data.replace(/\s+/g, ' ');
  if (item.type !== 'tag') return '';
  const inner = (): string => children($, item);
  const attr = (name: string): string | undefined => $(item).attr(name);
  switch (item.name.toLowerCase()) {
    case 'see':
    case 'seealso': {
      const href = attr('href');
      const label = inner().trim();
      if (href !== undefined) return `[${label === '' ? href : label}](${href})`;
      const target = attr('cref') ?? attr('langword');
      return target === undefined ? label : inlineCode(label === '' ? crefName(target) : label);
    }
    case 'paramref':
    case 'typeparamref':
      return inlineCode(attr('name') ?? '');
    case 'c':
      return inlineCode($(item).text());
    case 'code':
      return park($, fence(codeText($(item).text()), attr('lang') ?? attr('language') ?? 'csharp'));
    case 'para':
    case 'p':
      return `\n\n${inner().trim()}\n\n`;
    case 'br':
      return '\n\n';
    case 'b':
    case 'strong':
      return `**${inner().trim()}**`;
    case 'i':
    case 'em':
      return `_${inner().trim()}_`;
    case 'a': {
      const href = attr('href');
      return href === undefined ? inner() : `[${inner().trim()}](${href})`;
    }
    case 'list':
      return `\n\n${listBlock($, item)}\n\n`;
    case 'note':
      return `\n\n> **Note:** ${inner().trim()}\n\n`;
    default:
      return inner();
  }
}

function children($: Api, parent: AnyNode | undefined): string {
  if (parent === undefined || parent.type !== 'tag') return '';
  return parent.children.map((child) => node($, child)).join('');
}

/** The Markdown of one element's content, with paragraph spacing normalised. */
function markdown($: Api, element: AnyNode | undefined): string {
  return blocks(
    ...children($, element)
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.replace(/[ \t]*\n[ \t]*/g, ' ').trim()),
  ).replace(/@@fence:(\d+)@@/g, (_whole, index: string) => $.fences[Number(index)] ?? '');
}

interface Slice {
  id: string;
  xml: string;
}

const MEMBER_OPEN = /<member\s+name="([^"]+)"\s*(\/?)>/g;

/** Every `<member>` of the file as a text slice; nothing is parsed until a member is needed. */
function sliceMembers(xml: string): Slice[] {
  const slices: Slice[] = [];
  for (const match of xml.matchAll(MEMBER_OPEN)) {
    const start = match.index;
    const end = match[2] === '/' ? start + match[0].length : xml.indexOf('</member>', start);
    if (end === -1) break;
    slices.push({
      id: decodeEntities(match[1] ?? ''),
      xml: xml.slice(start, match[2] === '/' ? end : end + '</member>'.length),
    });
  }
  return slices;
}

/** Members marked `<exclude/>` are internal: Esri's own reference leaves them out. */
function isExcluded(slice: Slice): boolean {
  return /<exclude\b/i.test(slice.xml);
}

function toMember(slice: Slice): ApiMember | undefined {
  const id = parseMemberId(slice.id);
  if (id === undefined) return undefined;
  const loaded = cheerio.load(slice.xml, { xml: true });
  const $: Api = Object.assign(
    (selector: AnyNode | string | undefined) => loaded(selector as string),
    { fences: [] as string[] },
  );
  const root = $('member').get(0);
  const section = (name: string): string => markdown($, $(root).children(name).get(0));
  const params: ApiParam[] = $(root)
    .children('param')
    .toArray()
    .map((element, index) => {
      const description = markdown($, element);
      const type = id.parameters[index];
      return {
        name: $(element).attr('name') ?? `arg${index}`,
        ...(type === undefined ? {} : { type }),
        ...(description === '' ? {} : { description }),
      };
    });
  const typeParams = $(root)
    .children('typeparam')
    .toArray()
    .map((element) => `${inlineCode($(element).attr('name') ?? 'T')}: ${markdown($, element)}`);
  const throws = $(root)
    .children('exception')
    .toArray()
    .map((element) => {
      const cref = $(element).attr('cref');
      const text = markdown($, element);
      return `${cref === undefined ? '' : `${inlineCode(crefName(cref))}: `}${text}`.replace(/: $/, '');
    });
  const see = $(root)
    .children('seealso')
    .toArray()
    .map((element) => node($, element))
    .filter((text) => text !== '');
  const description = blocks(
    section('summary'),
    section('remarks'),
    section('value') === '' ? undefined : `**Value:** ${section('value')}`,
    typeParams.length === 0 ? undefined : blocks('**Type parameters**', bullets(typeParams)),
  );
  const returns = section('returns');
  const examples = $(root)
    .children('example')
    .toArray()
    .map((element) => markdown($, element))
    .filter((text) => text !== '');
  return {
    id: slice.id,
    name: id.name,
    ...GROUPS[id.prefix],
    // With one documented parameter per type in the id, the names can be shown too.
    signature:
      id.prefix === 'M' && params.length > 0 && params.length === id.parameters.length
        ? `${id.display}(${params.map((item) => `${item.type ?? ''} ${item.name}`).join(', ')})`
        : id.signature,
    ...(description === '' ? {} : { description }),
    ...(params.length === 0 ? {} : { params }),
    ...(returns === '' ? {} : { returns }),
    throws,
    examples,
    see,
  };
}

/**
 * Renders one member of a C# XML documentation file.
 *
 * `input.memberId` is the documentation id (`T:`, `M:`, `P:`, `E:` or `F:` prefix). A type
 * is rendered with its direct members, which are the entries whose id continues the type's
 * name; a member is rendered alone under the title of its declaring type. Members marked
 * `<exclude/>` are treated as absent.
 *
 * @throws McpDocError `DOC_NOT_FOUND` when the file has no such member.
 */
export function renderXmldoc(
  input: RendererInputs['xmldoc'],
  meta: RenderMeta,
  opts?: RenderOptions,
): DocPage {
  const slices = sliceMembers(input.xml).filter((slice) => !isExcluded(slice));
  const wanted = slices.find((slice) => slice.id === input.memberId);
  const id = parseMemberId(input.memberId);
  if (wanted === undefined || id === undefined) {
    throw invalidInput('xmldoc', meta, `the documentation file has no member ${input.memberId}`);
  }
  const typeName = id.prefix === 'T' ? id.qualified : id.owner;
  const typeSlice = slices.find((slice) => slice.id === `T:${typeName}`);
  const typeDoc = typeSlice === undefined ? undefined : toMember(typeSlice);
  const members = slices.flatMap((slice) => {
    const parsed = parseMemberId(slice.id);
    // Direct members only: nested types and their members belong to the nested type's page.
    if (parsed === undefined || parsed.prefix === 'T' || parsed.owner !== typeName) return [];
    return toMember(slice) ?? [];
  });
  const assembly = /<assembly>\s*<name>([^<]+)<\/name>/.exec(input.xml)?.[1]?.trim();
  const namespace = typeName.split('.').slice(0, -1).join('.');

  const type: ApiType = {
    title: typeName.split('.').at(-1) ?? typeName,
    header: [
      '_Type_',
      namespace === '' ? undefined : `namespace ${inlineCode(namespace)}`,
      assembly === undefined ? undefined : `assembly ${inlineCode(assembly)}`,
    ]
      .filter((part) => part !== undefined)
      .join(' · '),
    language: 'csharp',
    signature: typeName,
    ...(typeDoc?.description === undefined ? {} : { description: typeDoc.description }),
    examples: typeDoc?.examples ?? [],
    see: typeDoc?.see ?? [],
    members,
  };
  return renderApiPage('xmldoc', meta, type, opts, id.prefix === 'T' ? undefined : input.memberId);
}
