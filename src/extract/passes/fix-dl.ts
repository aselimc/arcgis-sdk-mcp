import type { Cheerio, CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { isElement, squash, tagged } from '../dom.js';
import type { Pass } from '../types.js';

interface Entry {
  /** Term as HTML, without its trailing colon; empty for a definition without a term. */
  term: string;
  definitions: string[];
}

/** Drops the colon that ends a term, also when it sits inside the last inline element. */
function stripColon(html: string): string {
  return html.trim().replace(/\s*:\s*((?:<\/\w+>\s*)*)$/, '$1');
}

function entriesOf($: CheerioAPI, list: Cheerio<Element>): Entry[] {
  const entries: Entry[] = [];
  let current: Entry | undefined;
  list.children().each((_, child) => {
    if (!isElement(child)) return;
    const html = ($(child).html() ?? '').trim();
    if (child.tagName === 'dt') {
      current = { term: stripColon(html), definitions: [] };
      entries.push(current);
    } else if (child.tagName === 'dd') {
      if (current === undefined) {
        current = { term: '', definitions: [] };
        entries.push(current);
      }
      current.definitions.push(html);
    } else if (child.tagName === 'div') {
      // dl > div > dt + dd (grouping wrapper allowed by HTML)
      const term = $(child).children('dt').first();
      if (term.length === 0) return;
      entries.push({
        term: stripColon(term.html() ?? ''),
        definitions: $(child)
          .children('dd')
          .map((__, dd) => ($(dd).html() ?? '').trim())
          .get(),
      });
    }
  });
  return entries;
}

function itemHtml(entry: Entry): string {
  const term = entry.term === '' ? '' : `<strong>${entry.term}:</strong> `;
  const body =
    entry.definitions.length > 1
      ? `<ul>${entry.definitions.map((definition) => `<li>${definition}</li>`).join('')}</ul>`
      : (entry.definitions[0] ?? '');
  return `<li>${term}${body}</li>`;
}

/**
 * Definition lists become bullet lists (`- **term:** definition`); Turndown has no `dl`
 * support at all. Several `dd` become a nested list. Directly adjacent `<code>` chips get a
 * comma between them (`GET`, `POST`), and in the REST metadata block (`dl.grid`) the URL
 * template becomes one code span.
 */
export const fixDl: Pass = ($) => {
  // Innermost first: a nested list is rewritten before its parent is serialised.
  for (const el of $('dl').get().reverse()) {
    const list = $(el);
    list.find('code + code').each((_, code) => {
      if (isElement(code.prev)) $(code).before(', ');
    });
    if (list.hasClass('grid')) {
      list.children('dt').each((_, dt) => {
        if (!/^url/i.test($(dt).text().trim())) return;
        const definition = $(dt).next('dd');
        definition.html(tagged('code', squash(definition.text())));
      });
    }
    const entries = entriesOf($, list);
    if (entries.length === 0) list.remove();
    else list.replaceWith(`<ul>${entries.map(itemHtml).join('')}</ul>`);
  }
};
