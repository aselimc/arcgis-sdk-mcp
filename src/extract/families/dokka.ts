import type { CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { escapeHtml, headingLevel, ID_ATTR, replaceWithPre, squash, tagged } from '../dom.js';
import { HEADINGS, stampOutline } from '../outline.js';
import type { FamilyProfile, PageView, Pass } from '../types.js';
import { fragment } from './shared.js';

const ROOT = 'div#content.main-content';
const MEMBER_ROW = 'div.table-row';
const ROW_LINK = '.main-subrow a';
/** The table of a documentation tag (Parameters, Throws, See also): names, not members. */
const TAG_TABLE = 'h4.tableheader + div.table';

/** Dokka splits identifiers into spans separated by `<wbr>`: join them without spaces. */
const identifier = (text: string): string => text.replace(/\s+/g, '');

const rowName = (row: Element, $: CheerioAPI): string =>
  identifier($(row).find(ROW_LINK).first().text());

/**
 * The fully qualified name, from the root's `pageIds` attribute. Its value is a Dokka
 * address: `<module>::<package>/<Type>/<member>/<signature>/PointingToDeclaration//<hash>`,
 * with `<member>` and `<signature>` empty on a type page and `<Type>` empty on a top-level
 * function. Only the first three fields are part of the name.
 */
function qualifiedName(page: PageView): AnyNode[] {
  const address = (page.root.attr('pageids') ?? '').split('::')[1] ?? '';
  const name = address
    .split('/')
    .slice(0, 3)
    .filter((part) => part !== '')
    .join('.');
  return name === '' ? [] : fragment(page.$, `<p>${tagged('code', name)}</p>`);
}

const isTagRow = (row: Element, $: CheerioAPI): boolean => $(row).parent().is(TAG_TABLE);

/**
 * One row of a tag table as a list item: the name (linked for See also and Throws, code for
 * a parameter) and what the page says about it.
 */
function tagItem($: CheerioAPI, row: Element): string {
  const key = $(row).find('.main-subrow').first().children().first();
  const name = identifier(key.text());
  const href = key.find('a').first().attr('href');
  const label =
    href === undefined ? tagged('code', name) : tagged('a', name, `href="${escapeHtml(href)}"`);
  const detail = $(row).find('.title').first();
  const opening = detail.children().first();
  // A one-paragraph description reads best on the line of its name.
  const lead = opening.is('p') ? (opening.html() ?? '').trim() : '';
  if (lead !== '') opening.remove();
  return `<li>${label}${lead === '' ? '' : `: ${lead}`}${detail.html() ?? ''}</li>`;
}

const prepare: Pass = ($) => {
  $(
    '.breadcrumbs, .anchor-wrapper, .copy-popup-wrapper, .tabs-section, .floating-right, dokka-template-command',
  ).remove();
  $('h1.cover').remove();
  $('div.symbol.monospace').each((_, el) => {
    const symbol = $(el);
    symbol.find('.top-right-position, .copy-icon').remove();
    replaceWithPre($, symbol, symbol.text().trim(), 'kotlin');
  });
  $('span.kdoc-tag').each((_, el) => {
    const tag = $(el);
    const label = squash(tag.find('h4').first().remove().text());
    tag.replaceWith(`<p>${tagged('strong', `${label}:`)} ${escapeHtml(squash(tag.text()))}</p>`);
  });
  $(TAG_TABLE).each((_, el) => {
    const items = $(el)
      .children(MEMBER_ROW)
      .map((__, row) => tagItem($, row))
      .get();
    $(el).replaceWith(`<ul>${items.join('')}</ul>`);
  });
  // Member rows: a linked name, then each declaration with its brief. Overloads share one
  // row, so the parts are kept in page order: a brief belongs to the declaration before it.
  $(MEMBER_ROW).each((_, el) => {
    const row = $(el);
    const name = escapeHtml(rowName(el, $));
    const href = row.find(ROW_LINK).first().attr('href');
    const id = row.attr(ID_ATTR);
    const attributes = id === undefined ? '' : ` ${ID_ATTR}="${escapeHtml(id)}"`;
    const parts = row
      .find('pre, .brief')
      .map((__, part) => {
        if (part.tagName === 'pre') return $.html(part);
        const brief = $(part).html() ?? '';
        return brief.trim() === '' ? '' : `<div>${brief}</div>`;
      })
      .get()
      .join('');
    row.replaceWith(
      `<h4${attributes}>${href === undefined ? name : `<a href="${escapeHtml(href)}">${name}</a>`}</h4>${parts}`,
    );
  });
};

/**
 * Dokka (Kotlin API reference). Sections are the `h2.tableheader` blocks (Constructors,
 * Types, Properties, Functions and their inherited variants). Members are listed with their
 * declarations but documented on pages of their own, which the member headings link to.
 * The tables under an `h4.tableheader` (Parameters, Throws, See also) become lists.
 */
export const dokka: FamilyProfile = {
  id: 'dokka',
  defaultLanguage: 'kotlin',
  root: ($) => $(ROOT).first(),
  title: ($) => identifier($(ROOT).find('h1.cover').first().text()),
  outline: (page) =>
    stampOutline(
      page,
      // `Since` and similar tags are marked up as headings but are one-line facts.
      {
        ...HEADINGS,
        level: (el, $) => ($(el).closest('span.kdoc-tag').length > 0 ? 0 : headingLevel(el)),
      },
      // Member rows become headings in `prepare`; their ids are fixed here, before slicing.
      {
        selector: MEMBER_ROW,
        level: (el, $) => (isTagRow(el, $) ? 0 : 4),
        id: () => undefined,
        title: rowName,
      },
    ),
  header: qualifiedName,
  prepare,
};
