/**
 * TypeDoc comments (`comment.summary[]`, `comment.blockTags[]`) to Markdown.
 *
 * Text and code parts are Markdown already. Inline `{@link}` tags carry either the numeric
 * id of a reflection, which is resolvable when it lives on the same page, or a URL.
 */
import { asRecord, list, records, str, type Json } from './json.js';
import { fencedExample, inlineCode } from './md.js';

/** What a comment needs to resolve links. */
export interface CommentContext {
  /** Public URL of the page, without fragment. */
  pageUrl: string;
  /** Reflection id to member anchor, for every member (and signature) on the page. */
  anchors: ReadonlyMap<number, string>;
}

function inlineTag(part: Json, context: CommentContext): string {
  const tag = str(part.tag) ?? '@link';
  const code = tag === '@linkcode';
  let text = (str(part.text) ?? '').trim();
  const target = part.target;
  const anchor = typeof target === 'number' ? context.anchors.get(target) : undefined;
  // Authors write `{@link Class.method | ()}`-style labels; alone they would read as "()".
  if (anchor !== undefined && anchor !== '' && /^\(.*\)$/.test(text)) text = `${anchor}${text}`;
  if (text === '') text = anchor ?? '';
  const label = code ? inlineCode(text) : text;

  if (anchor !== undefined) {
    return `[${label}](${context.pageUrl}${anchor === '' ? '' : `#${anchor}`})`;
  }
  if (typeof target === 'string' && /^https?:\/\//.test(target)) return `[${label}](${target})`;
  if (/^https?:\/\//.test(text)) return text;
  // A symbol on another page: its URL is not derivable from the page data, so name it.
  return tag === '@linkplain' ? text : inlineCode(text);
}

/** Renders comment display parts (`text`, `code`, `inline-tag`) as Markdown. */
export function renderParts(parts: unknown, context: CommentContext): string {
  return records(parts)
    .map((part) => {
      if (part.kind === 'inline-tag') return inlineTag(part, context);
      return typeof part.text === 'string' ? part.text : '';
    })
    .join('')
    .replace(/\r\n?/g, '\n')
    .trim();
}

/** The parts of a TypeDoc comment a member section shows. */
export interface CommentDoc {
  description?: string;
  returns?: string;
  deprecated?: string | boolean;
  since?: string;
  defaultValue?: string;
  examples: string[];
  see: string[];
  throws: string[];
  /** `@param` texts by parameter name, for sources that document parameters on the comment. */
  params: Map<string, string>;
  /** Block tags without a dedicated field (`@remarks`, custom tags), appended to the description. */
  remarks: string[];
}

/** Reads a TypeDoc `comment` object. Missing comments give an empty result. */
export function readComment(comment: unknown, context: CommentContext): CommentDoc {
  const node = asRecord(comment);
  const doc: CommentDoc = { examples: [], see: [], throws: [], params: new Map(), remarks: [] };
  const summary = renderParts(node.summary, context);
  if (summary !== '') doc.description = summary;
  if (list(node.modifierTags).includes('@deprecated')) doc.deprecated = true;

  for (const block of records(node.blockTags)) {
    const tag = str(block.tag) ?? '';
    const text = renderParts(block.content, context);
    switch (tag) {
      case '@returns':
      case '@return':
        if (text !== '') doc.returns = text;
        break;
      case '@deprecated':
        doc.deprecated = text === '' ? true : text;
        break;
      case '@since':
        if (text !== '') doc.since = text;
        break;
      case '@default':
      case '@defaultValue':
        if (text !== '') doc.defaultValue = text.replace(/^```\w*\n?|\n?```$/g, '').trim();
        break;
      case '@example':
        if (text !== '') doc.examples.push(fencedExample(text, 'ts'));
        break;
      case '@see':
        if (text !== '') doc.see.push(text.replace(/^[-*]\s+/, ''));
        break;
      case '@throws':
        if (text !== '') doc.throws.push(text);
        break;
      case '@param': {
        const name = str(block.name);
        if (name !== undefined && text !== '') doc.params.set(name, text);
        break;
      }
      default:
        if (text !== '') doc.remarks.push(tag === '@remarks' ? text : `**${tag.slice(1)}:** ${text}`);
    }
  }
  if (doc.remarks.length > 0) {
    doc.description = [doc.description ?? '', ...doc.remarks].filter((s) => s !== '').join('\n\n');
  }
  return doc;
}
