import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { escapeHtml, ID_ATTR, removeComments, replaceWithPre, squash, tagged } from '../dom.js';
import { stampOutline } from '../outline.js';
import type { FamilyProfile, Pass } from '../types.js';

const ROOT = 'div#i-body-content';
/** `div#i-syntax-section-heading` is the heading of section `syntax`. */
const SECTION_HEADING = 'div.i-section-heading';
/** Three NBSP of indentation per level in the inheritance tree. */
const INDENT_WIDTH = 3;
const LEVEL_MARK = '\u203a ';

const sectionId = (el: Element, $: CheerioAPI): string =>
  ($(el).attr('id') ?? '').replace(/^i-|-section-heading$/g, '');

/** `<a>..</a><br><a>..</a>` runs become a list; NBSP indentation becomes a depth marker. */
function breakRunsToLists($: CheerioAPI): void {
  $('p')
    .filter((_, p) => $(p).children('br').length > 0)
    .each((_, p) => {
      const items = ($(p).html() ?? '')
        .split(/<br\s*\/?>/i)
        .filter((line) => line.replace(/&nbsp;|[\s\u00a0]/g, '') !== '')
        .map((line) => {
          const indent = /^(?:\s|&nbsp;|\u00a0)*/.exec(line)?.[0] ?? '';
          const depth = Math.floor((indent.match(/&nbsp;|\u00a0/g) ?? []).length / INDENT_WIDTH);
          const text = line.replace(/&nbsp;|\u00a0/g, ' ').trim();
          return `<li>${LEVEL_MARK.repeat(depth)}${text}</li>`;
        });
      $(p).replaceWith(`<ul>${items.join('')}</ul>`);
    });
}

const prepare: Pass = ($) => {
  $(
    'div.i-page-title, .i-in-this-topic-container, #i-footer-content, .i-footer-content, ' +
      '.i-section-heading-icon, td.i-image, .i-copy-code, .i-toggle-all-sections, img',
  ).remove();
  removeComments($, $.root());
  $('a[name]')
    .filter((_, anchor) => $(anchor).text().trim() === '')
    .remove();
  // Both languages are in the page, toggled client-side: keep C#.
  $('.i-filtered-content-VB').remove();
  $('.i-tab-container > ul').remove();
  // Code is a `pre` nested in a `pre`, with inline colour spans.
  $('div.i-code').each((_, el) => {
    replaceWithPre($, $(el), $(el).find('pre').last().text(), 'csharp');
  });
  $(SECTION_HEADING).each((_, el) => {
    const id = $(el).attr(ID_ATTR) ?? sectionId(el, $);
    $(el).replaceWith(tagged('h2', squash($(el).text()), `${ID_ATTR}="${escapeHtml(id)}"`));
  });
  $('h4.i-sub-heading').each((_, el) => {
    $(el).replaceWith(`<p>${tagged('strong', squash($(el).text()))}</p>`);
  });
  // Member tables: the first column held an icon.
  $('table.i-filtered-item-list tr').each((_, row) => {
    const headers = $(row).children('th');
    if (headers.length === 3 && headers.first().text().trim() === '') headers.first().remove();
  });
  $('a[href$="#top"]').each((_, el) => {
    const parent = $(el).parent();
    $(el).remove();
    if (parent.is('p') && parent.text().trim() === '') parent.remove();
  });
  breakRunsToLists($);
};

/**
 * Innovasys Document! X (ArcGIS Pro SDK API reference). One topic per type, per member list
 * and per member. Sections are `div.i-section-heading` blocks (`syntax`, `remarks`,
 * `inheritance`, `requirements`, `seealso`, ...), which become `h2` headings.
 */
export const documentx: FamilyProfile = {
  id: 'documentx',
  defaultLanguage: 'csharp',
  root: ($) => $(ROOT).first(),
  title: ($) => $(ROOT).find('.i-page-title-text').first().text(),
  outline: (page) =>
    stampOutline(page, { selector: SECTION_HEADING, level: () => 2, id: sectionId }),
  prepare,
};
