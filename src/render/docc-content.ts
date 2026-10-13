/**
 * DocC render-JSON content trees to Markdown: block nodes (`paragraph`, `aside`, lists,
 * tables, ...), inline nodes (`text`, `codeVoice`, `reference`, ...) and references.
 *
 * Node types the fixtures never showed are implemented from the DocC schema; a type this
 * module does not know is rendered as its plain text and reported, never dropped silently.
 */
import { asRecord, list, records, str, strings, type Json } from './json.js';
import { blocks, bullets, fence, inlineCode, oneLine, table } from './md.js';

/** What content rendering needs from the page. */
export interface DoccContext {
  /** The page's `references` map, by identifier. */
  references: Json;
  /** Public URL prefix for a reference `url` such as `/documentation/arcgis/map`. */
  baseUrl: string;
  /** Collects unknown node types as `docc:<type>`. */
  unknown: Set<string>;
}

/** Joins declaration tokens or title fragments into their source text. */
export function fragmentsText(fragments: unknown): string {
  return records(fragments)
    .map((fragment) => (typeof fragment.text === 'string' ? fragment.text : ''))
    .join('');
}

/** The public URL of a reference, when it has one. */
export function referenceUrl(reference: Json, context: DoccContext): string | undefined {
  const url = str(reference.url);
  if (url === undefined) return undefined;
  return /^https?:\/\//.test(url) ? url : `${context.baseUrl}${url}`;
}

/**
 * A reference as Markdown: symbols as linked code, articles and external links as plain
 * links, references DocC could not resolve (types of other frameworks) as code.
 */
export function referenceLink(identifier: string, context: DoccContext, title?: string): string {
  const reference = asRecord(context.references[identifier]);
  const label = title ?? str(reference.title) ?? identifier.split('/').at(-1) ?? identifier;
  const url = referenceUrl(reference, context);
  const symbol = reference.kind === 'symbol' || reference.type === 'unresolvable';
  const shown = symbol ? inlineCode(label) : label;
  return url === undefined ? shown : `[${shown}](${url})`;
}

/** Plain text of any node, used for node types this module does not know. */
function plainText(node: Json): string {
  if (typeof node.text === 'string') return node.text;
  if (typeof node.code === 'string') return node.code;
  const children = [...list(node.inlineContent), ...list(node.content)];
  return children.map((child) => plainText(asRecord(child))).join('');
}

/** Renders inline content nodes. */
export function inline(nodes: unknown, context: DoccContext): string {
  return records(nodes)
    .map((node): string => {
      const inner = (): string => inline(node.inlineContent, context);
      switch (node.type) {
        case 'text':
          return typeof node.text === 'string' ? node.text : '';
        case 'codeVoice':
          return inlineCode(str(node.code) ?? '');
        case 'emphasis':
        case 'newTerm':
          return `_${node.type === 'newTerm' ? (str(node.text) ?? inner()) : inner()}_`;
        case 'strong':
        case 'inlineHead':
          return `**${inner()}**`;
        case 'strikethrough':
          return `~~${inner()}~~`;
        case 'superscript':
        case 'subscript':
          return inner();
        case 'reference': {
          const title = str(node.overridingTitle);
          return referenceLink(str(node.identifier) ?? '', context, title);
        }
        case 'link':
          return `[${str(node.title) ?? str(node.destination) ?? ''}](${str(node.destination) ?? ''})`;
        case 'image': {
          const reference = asRecord(context.references[str(node.identifier) ?? '']);
          const url = str(asRecord(list(reference.variants)[0]).url);
          const alt = str(reference.alt) ?? '';
          return url === undefined
            ? alt
            : `![${alt}](${/^https?:/.test(url) ? url : `${context.baseUrl}${url}`})`;
        }
        default:
          context.unknown.add(`docc:${str(node.type) ?? 'inline'}`);
          return plainText(node);
      }
    })
    .join('');
}

function listItems(node: Json, context: DoccContext): string[] {
  return records(node.items).map((item) => content(item.content, context));
}

function quote(text: string): string {
  return text
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');
}

function aside(node: Json, context: DoccContext): string {
  const style = str(node.style) ?? 'note';
  const name = str(node.name) ?? style.charAt(0).toUpperCase() + style.slice(1);
  const body = content(node.content, context);
  // A one-paragraph aside reads best on one line; longer ones keep their blocks.
  return quote(body.includes('\n') ? `**${name}:**\n\n${body}` : `**${name}:** ${body}`);
}

function tableBlock(node: Json, context: DoccContext): string {
  const rows = list(node.rows).map((row) => list(row).map((cell) => content(cell, context)));
  const [first, ...rest] = rows;
  if (first === undefined) return '';
  const hasHeader = node.header === 'row' || node.header === 'both';
  return hasHeader
    ? table(first, rest)
    : table(
        first.map(() => ''),
        rows,
      );
}

function block(node: Json, context: DoccContext): string {
  switch (node.type) {
    case 'heading':
      return `${'#'.repeat(Math.min(6, Math.max(1, Number(node.level) || 2)))} ${str(node.text) ?? ''}`;
    case 'paragraph':
    case 'small':
      return inline(node.inlineContent, context);
    case 'codeListing':
      return fence(strings(node.code).join('\n'), str(node.syntax) ?? '');
    case 'unorderedList':
      return bullets(listItems(node, context));
    case 'orderedList':
      return listItems(node, context)
        .map((item, index) => `${index + 1}. ${item.replace(/\n/g, '\n   ')}`)
        .join('\n');
    case 'aside':
      return aside(node, context);
    case 'termList':
      return bullets(
        records(node.items).map((item) => {
          const term = inline(asRecord(item.term).inlineContent, context);
          return `**${term}**: ${content(asRecord(item.definition).content, context)}`;
        }),
      );
    case 'table':
      return tableBlock(node, context);
    case 'tabNavigator':
      return blocks(
        ...records(node.tabs).flatMap((tab) => [
          `**${str(tab.title) ?? ''}**`,
          content(tab.content, context),
        ]),
      );
    case 'row':
      return blocks(...records(node.columns).map((column) => content(column.content, context)));
    case 'links':
      return bullets(strings(node.items).map((identifier) => referenceLink(identifier, context)));
    case 'thematicBreak':
      return '---';
    default:
      context.unknown.add(`docc:${str(node.type) ?? 'block'}`);
      return oneLine(plainText(node));
  }
}

/** Renders block content nodes, separated by blank lines. */
export function content(nodes: unknown, context: DoccContext): string {
  return blocks(...records(nodes).map((node) => block(node, context)));
}
