/**
 * Small DOM helpers used by the passes and the family profiles. All of them work on the
 * cheerio (htmlparser2/parse5) tree; none of them touches anything outside the node given.
 */
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { AnyNode, ChildNode, Element, ParentNode } from 'domhandler';

/** Attribute carrying the fence language of a normalised `<pre>`. */
export const LANG_ATTR = 'data-md-lang';
/** Attribute carrying the final section id of a heading (wins over `id`). */
export const ID_ATTR = 'data-md-id';
/**
 * The element that holds the content of a working document. A custom name, so that no
 * selector of a pass matches it by accident.
 */
export const WORK_ROOT = 'md-root';
/** Stands for a line break inside a table cell until post-processing writes `<br>`. */
export const BR_PLACEHOLDER = '\ue003';

const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  javascript: 'js',
  typescript: 'ts',
  'c#': 'csharp',
  cs: 'csharp',
  'c++': 'cpp',
  kt: 'kotlin',
  sh: 'bash',
  shell: 'bash',
  text: '',
  plaintext: '',
  txt: '',
  none: '',
  other: '',
  hljs: '',
};

/** Escapes text for use inside an HTML string that cheerio parses again. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Collapses every run of whitespace (NBSP included) to one space and trims. */
export function squash(text: string): string {
  return text.replace(/[\s\u00a0]+/g, ' ').trim();
}

/** True for element nodes (`script` and `style` included). */
export function isElement(node: AnyNode | null | undefined): node is Element {
  // `type` is an enum of the parser package; its values are these plain strings.
  const type: string | undefined = node?.type;
  return type === 'tag' || type === 'script' || type === 'style';
}

/** 1 to 6 for `h1` to `h6`, 0 for everything else. */
export function headingLevel(node: AnyNode | null | undefined): number {
  if (!isElement(node)) return 0;
  const match = /^h([1-6])$/.exec(node.tagName);
  return match === null ? 0 : Number(match[1]);
}

/** Canonical fence language: lower-case, common aliases folded, "no language" names emptied. */
export function normalizeLanguage(raw: string | undefined): string {
  const language = (raw ?? '').toLowerCase().trim();
  return LANGUAGE_ALIASES[language] ?? language;
}

/**
 * The top of the content a pass works on: the working document's holder element, or the
 * document itself for a fragment that was parsed without one.
 *
 * The pipeline keeps the content in one holder because cheerio starts every `$(selector)`
 * from the children of the document, and the selector engine deduplicates that list with a
 * quadratic scan: with thousands of top-level blocks (a long reference page, or a hostile
 * one) every single query of every pass would cost tens of milliseconds.
 */
export function workRoot($: CheerioAPI): Cheerio<AnyNode> {
  const holder = $.root().children(WORK_ROOT).first();
  return holder.length > 0 ? holder : $.root();
}

/** A Visual Basic declaration: a modifier or `Dim` first, and `As`, `ByVal` or `End` after it. */
const VISUAL_BASIC =
  /^\s*(?:Public|Private|Protected|Friend|Shared|Dim|Imports|Sub|Function|Property)\b[^;{}]*\b(?:As|ByVal|ByRef|End)\b/;
/** Leading `//` and `#` comment lines, which JSON examples sometimes carry. */
const LEADING_COMMENTS = /^(?:\s*(?:\/\/|#)[^\n]*\n)*\s*/;
/** How a JSON value can start: an object, an array, a string, a number or a literal. */
const JSON_START = /^(?:[{["\d-]|true\b|false\b|null\b)/;
/**
 * A JavaScript statement: a declaration, or a call on a name (`form.setValue(`). A bare
 * `name=value` is not one: request parameters are listed that way under the same label.
 */
const JAVASCRIPT_START =
  /^(?:(?:const|let|var|function|import|export|await|new|return|async)\s|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\()/;

/**
 * The fence language for code whose page names the wrong one. Two mislabels are common
 * enough upstream to mislead: Visual Basic declarations tagged C# (the .NET reference of the
 * Enterprise SDK shows both under `language-cs`) and JavaScript calls tagged JSON (examples
 * of generated API pages). Anything else keeps the language it was given.
 */
export function refineLanguage(language: string, code: string): string {
  if (language === 'csharp' && VISUAL_BASIC.test(code)) return 'vb';
  if (language === 'json') {
    const body = code.replace(LEADING_COMMENTS, '');
    if (!JSON_START.test(body) && JAVASCRIPT_START.test(body)) return 'js';
  }
  return language;
}

/** Makes `children` the children of `parent`, in this order. */
function setChildren(parent: ParentNode, children: ChildNode[]): void {
  parent.children = children;
  children.forEach((child, index) => {
    child.parent = parent;
    child.prev = children[index - 1] ?? null;
    child.next = children[index + 1] ?? null;
  });
}

/**
 * Appends `nodes` to `target`, taking each out of the parent it had. The same as cheerio's
 * `append`, in time linear in the number of nodes: `append` looks every node up in its old
 * parent's child list, which is quadratic when thousands of siblings move at once.
 */
export function moveInto(target: ParentNode, nodes: readonly AnyNode[]): void {
  const moving = new Set<AnyNode>(nodes);
  const former = new Set<ParentNode>();
  for (const node of nodes)
    if (node.parent !== null && node.parent !== target) former.add(node.parent);
  for (const parent of former) {
    setChildren(
      parent,
      parent.children.filter((child) => !moving.has(child)),
    );
  }
  const kept = target.children.filter((child) => !moving.has(child));
  // A document is never passed here: `nodes` are the children of an element.
  setChildren(target, [...kept, ...(nodes as readonly ChildNode[])]);
}

/**
 * The elements below `scope` that match `selector`, in document order. The same as
 * `scope.find(selector)`, but the search starts at the document: `find` hands every child of
 * the scope to the selector engine, which deduplicates that list with a quadratic scan, so
 * one `find` on an element with twenty thousand children takes a quarter of a second.
 */
export function findIn($: CheerioAPI, scope: Cheerio<AnyNode>, selector: string): Cheerio<Element> {
  const top = scope.get(0);
  const inside = (el: AnyNode): boolean => {
    for (let node = el.parent; node !== null; node = node.parent) if (node === top) return true;
    return false;
  };
  return $(selector).filter((_, el): el is Element => isElement(el) && inside(el));
}

/** Replaces each element with its own children. */
export function unwrap($: CheerioAPI, elements: Cheerio<Element>): void {
  elements.each((_, element) => {
    const $element = $(element);
    $element.replaceWith($element.contents());
  });
}

/**
 * Replaces `target` with a plain `<pre data-md-lang>` holding `code` as text. Every code
 * block ends up in this shape, so the Turndown rule only reads text and one attribute.
 */
export function replaceWithPre(
  $: CheerioAPI,
  target: Cheerio<AnyNode>,
  code: string,
  language: string | undefined,
): void {
  const pre = $('<pre></pre>');
  pre.attr(LANG_ATTR, refineLanguage(normalizeLanguage(language), code));
  pre.text(code);
  target.replaceWith(pre);
}

/** Removes every comment node below `scope`. */
export function removeComments($: CheerioAPI, scope: Cheerio<AnyNode>): void {
  scope
    .find('*')
    .addBack()
    .contents()
    .filter((_, node) => (node.type as string) === 'comment')
    .remove();
}

/** The first sentence of a text, or its first 200 characters when it has no sentence end. */
export function firstSentence(text: string): string {
  const flat = squash(text);
  const match = /^(.{20,240}?[.!?])(?:\s|$)/.exec(flat);
  return (match?.[1] ?? flat.slice(0, 200)).trim();
}

/** The first value that is neither `undefined` nor empty; empty when there is none. */
export function firstNonEmpty(...values: Array<string | undefined>): string {
  return values.find((value) => value !== undefined && value !== '') ?? '';
}

/** Builds `<tag>` holding `text` (escaped) and returns its HTML. */
export function tagged(tag: string, text: string, attributes = ''): string {
  return `<${tag}${attributes === '' ? '' : ` ${attributes}`}>${escapeHtml(text)}</${tag}>`;
}
