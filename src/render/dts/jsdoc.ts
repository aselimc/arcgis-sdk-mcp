/**
 * JSDoc and TSDoc block comments to a structured form. The description and tag texts are
 * Markdown as the author wrote them; only the comment decoration and inline `{@link}` tags
 * are rewritten.
 */
import { stepFence, type OpenFence } from '../../core/fences.js';

/** One `@param` tag. */
export interface JsDocParam {
  name: string;
  type?: string;
  optional?: boolean;
  default?: string;
  description?: string;
}

/** A parsed doc comment. */
export interface JsDoc {
  description: string;
  since?: string;
  default?: string;
  /** The deprecation note, or `true` when the tag has no text. */
  deprecated?: string | true;
  params: JsDocParam[];
  returns?: string;
  examples: string[];
  see: string[];
  throws: string[];
  /** Marked `@internal`, `@private`, `@hidden` or `@ignore`: not part of the public API. */
  internal: boolean;
}

/** Removes the comment delimiters and the leading ` * ` of every line. */
export function stripComment(comment: string): string {
  return comment
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*\/\*\*+/, '')
    .replace(/\*+\/\s*$/, '')
    .split('\n')
    .map((line) => line.replace(/^[ \t]*\*(?: |$)?/, '').replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

/** `{@link Target}`, `{@link Target | label}`, `{@linkcode Target label}` to Markdown. */
function inlineTags(text: string): string {
  return text
    .replace(
      /\{@(link|linkcode|linkplain)\s+([^}|\s]+)(?:\s*\|\s*|\s+)?([^}]*)\}/g,
      (_whole, tag: string, target: string, label: string) => {
        const shown = label.trim() === '' ? target : label.trim();
        if (/^https?:\/\//.test(target)) return `[${shown}](${target})`;
        return tag === 'linkplain' ? shown : `\`${shown}\``;
      },
    )
    .replace(/\\@/g, '@');
}

interface RawTag {
  name: string;
  text: string;
}

/** Splits comment text into the description and its block tags; `@` inside fences is code. */
function splitTags(text: string): { description: string; tags: RawTag[] } {
  const description: string[] = [];
  const drafts: Array<{ name: string; lines: string[] }> = [];
  let lines = description;
  let open: OpenFence;
  for (const line of text.split('\n')) {
    const step = stepFence(line, open);
    open = step.open;
    // A tag name ends at whitespace, so a line starting with "@scope/package" stays prose.
    const tag = step.fenced ? null : /^\s*@([A-Za-z]+)(?:[ \t]+(.*))?$/.exec(line);
    if (tag === null) {
      lines.push(line);
      continue;
    }
    lines = [tag[2] ?? ''];
    drafts.push({ name: tag[1] ?? '', lines });
  }
  return {
    description: description.join('\n').trim(),
    tags: drafts.map((draft) => ({
      name: draft.name,
      text: draft.lines.join('\n').replace(/^\n+|\s+$/g, ''),
    })),
  };
}

/** Parses the body of a `@param` tag: `{type} name - text`, `[name=default] text`, `name text`. */
function param(text: string): JsDocParam | undefined {
  const match = /^(?:\{([^}]*)\}\s*)?(\[[^\]]+\]|[\w$.]+)\s*(?:-\s*)?([\s\S]*)$/.exec(text.trim());
  if (match === null) return undefined;
  const [, type, rawName = '', description = ''] = match;
  const bracketed = /^\[([^=\]]+)(?:=([^\]]*))?\]$/.exec(rawName);
  const name = (bracketed?.[1] ?? rawName).trim();
  const fallback = bracketed?.[2]?.trim();
  return {
    name,
    ...(type === undefined || type === '' ? {} : { type }),
    ...(bracketed === null ? {} : { optional: true }),
    ...(fallback === undefined || fallback === '' ? {} : { default: fallback }),
    ...(description.trim() === '' ? {} : { description: inlineTags(description.trim()) }),
  };
}

/** An example body without the optional `<caption>` line some authors add. */
function example(text: string): string {
  const caption = /^<caption>([\s\S]*?)<\/caption>\s*\n?/.exec(text);
  if (caption === null) return text;
  return `// ${(caption[1] ?? '').trim()}\n${text.slice(caption[0].length)}`;
}

/**
 * Parses a doc comment. Understood block tags: `@since`, `@default`, `@deprecated`, `@param`,
 * `@returns`, `@example`, `@see`, `@throws` and the visibility tags; any other tag is ignored.
 * An absent comment gives an empty description.
 */
export function parseJsDoc(comment: string | undefined): JsDoc {
  const doc: JsDoc = {
    description: '',
    params: [],
    examples: [],
    see: [],
    throws: [],
    internal: false,
  };
  if (comment === undefined) return doc;
  const { description, tags } = splitTags(stripComment(comment));
  doc.description = inlineTags(description);

  for (const tag of tags) {
    const text = tag.text;
    switch (tag.name) {
      case 'since':
        if (text !== '') doc.since = text;
        break;
      case 'default':
      case 'defaultValue':
        if (text !== '') doc.default = text;
        break;
      case 'deprecated':
        doc.deprecated = text === '' ? true : inlineTags(text);
        break;
      case 'param':
      case 'arg':
      case 'argument': {
        const parsed = param(text);
        if (parsed !== undefined) doc.params.push(parsed);
        break;
      }
      case 'returns':
      case 'return':
        if (text !== '') doc.returns = inlineTags(text.replace(/^\{[^}]*\}\s*/, ''));
        break;
      case 'example':
        if (text !== '') doc.examples.push(example(text));
        break;
      case 'see':
        if (text !== '') doc.see.push(inlineTags(text));
        break;
      case 'throws':
      case 'exception':
        if (text !== '') doc.throws.push(inlineTags(text));
        break;
      case 'internal':
      case 'private':
      case 'hidden':
      case 'ignore':
        doc.internal = true;
        break;
      default:
    }
  }
  return doc;
}
