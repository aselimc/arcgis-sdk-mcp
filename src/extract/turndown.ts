/**
 * Turndown setup. All language and code-content decisions are taken in the DOM before
 * Turndown runs, so the rules here stay trivial: fence a normalised `<pre>`, drop empty
 * links, and tag every heading with the id it had in the page.
 */
import { gfm } from '@joplin/turndown-plugin-gfm';
import TurndownService from 'turndown';
import { ID_ATTR, LANG_ATTR } from './dom.js';

/** Opens the heading marker; private-use characters cannot occur in documentation text. */
const MARK_OPEN = '\ue001';
const MARK_CLOSE = '\ue002';

/** Matches the marker a heading carries after conversion; group 1 indexes `Converted.headingIds`. */
export const HEADING_MARK = /[ \t]*\ue001(\d+)\ue002/;
/** Global form of {@link HEADING_MARK}, for removing every marker from a text. */
export const HEADING_MARKS = /[ \t]*\ue001\d+\ue002/g;

/** Result of converting one HTML fragment. */
export interface Converted {
  markdown: string;
  /** Page ids of the headings in conversion order; `undefined` for a heading without one. */
  headingIds: Array<string | undefined>;
}

/** The part of the DOM interface (Turndown's own parser) the rules use. */
interface RuleNode {
  nodeName: string;
  textContent: string | null;
  parentNode: RuleNode | null;
  nextSibling: unknown;
  children: ArrayLike<unknown>;
  getAttribute(name: string): string | null;
  querySelector(selector: string): unknown;
}

const asRuleNode = (node: unknown): RuleNode => node as RuleNode;

/** A fenced block whose fence is one backtick longer than the longest run inside the code. */
export function fence(code: string, language: string): string {
  const text = code
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/^\n+|\s+$/g, '');
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const marker = '`'.repeat(longest + 1);
  return `${marker}${language}\n${text}\n${marker}`;
}

/**
 * Creates the HTML-to-Markdown converter. The returned function is synchronous and may be
 * called any number of times; each call reports the heading ids of that call only.
 */
export function createMarkdownConverter(): (html: string) => Converted {
  let headingIds: Array<string | undefined> = [];

  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_',
    hr: '---',
  });
  service.use(gfm);

  service.addRule('fencedPre', {
    filter: (node) => node.nodeName === 'PRE',
    replacement: (_content, node) => {
      const pre = asRuleNode(node);
      const language = (pre.getAttribute(LANG_ATTR) ?? '').trim();
      return `\n\n${fence(pre.textContent ?? '', language)}\n\n`;
    },
  });

  service.addRule('dropEmptyLinks', {
    filter: (node) => {
      const link = asRuleNode(node);
      return (
        link.nodeName === 'A' &&
        (link.textContent ?? '').trim() === '' &&
        link.querySelector('img') === null
      );
    },
    replacement: () => '',
  });

  // Turndown pads every marker to four columns (`-   item`). One space after the marker and a
  // continuation indent of the marker's width is the same Markdown in fewer characters, and
  // keeps the fences of list items within the three spaces a strict fence tracker accepts.
  service.addRule('compactListItem', {
    filter: 'li',
    replacement: (content, node) => {
      const item = asRuleNode(node);
      const list = item.parentNode;
      let marker = '- ';
      if (list?.nodeName === 'OL') {
        const start = Number(list.getAttribute('start') ?? '1');
        const index = Array.prototype.indexOf.call(list.children, node);
        marker = String((Number.isFinite(start) ? start : 1) + index) + '. ';
      }
      const body = content
        .replace(/^\n+/, '')
        .replace(/\n+$/, '\n')
        .replace(/\n(?!\n|$)/g, '\n' + ' '.repeat(marker.length));
      return marker + body + (item.nextSibling !== null && !body.endsWith('\n') ? '\n' : '');
    },
  });

  service.addRule('markedHeading', {
    filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    replacement: (content, node) => {
      const heading = asRuleNode(node);
      const text = content.replace(/\s+/g, ' ').trim();
      if (text === '') return '';
      const id = heading.getAttribute(ID_ATTR) ?? heading.getAttribute('id') ?? undefined;
      headingIds.push(id === '' ? undefined : id);
      const level = Number(heading.nodeName.charAt(1));
      return `\n\n${'#'.repeat(level)} ${text} ${MARK_OPEN}${headingIds.length - 1}${MARK_CLOSE}\n\n`;
    },
  });

  service.remove([
    'script',
    'style',
    'noscript',
    'button',
    'form',
    'iframe',
    'template',
    'link',
    'meta',
  ]);
  // `svg` is not in Turndown's HTML element name list, so it is removed by a filter function.
  service.remove((node) => node.nodeName.toLowerCase() === 'svg');

  return (html: string): Converted => {
    headingIds = [];
    const markdown = service.turndown(html);
    return { markdown, headingIds };
  };
}
