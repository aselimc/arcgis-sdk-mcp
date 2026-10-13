import type { CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { escapeHtml, headingLevel, ID_ATTR, replaceWithPre, squash, tagged } from '../dom.js';
import { HEADINGS, stampOutline } from '../outline.js';
import type { FamilyProfile, PageView, Pass } from '../types.js';
import { fragment } from './shared.js';

const ROOT = 'div#content.main-content';
const MEMBER_ROW = 'div.table-row';
const ROW_LINK = '.main-subrow a';

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
  // Member rows: a linked name, the declarations (overloads share one row) and the brief.
  $(MEMBER_ROW).each((_, el) => {
    const row = $(el);
    const name = escapeHtml(rowName(el, $));
    const href = row.find(ROW_LINK).first().attr('href');
    const id = row.attr(ID_ATTR);
    const attributes = id === undefined ? '' : ` ${ID_ATTR}="${escapeHtml(id)}"`;
    const declarations = row
      .find('pre')
      .map((__, pre) => $.html(pre))
      .get()
      .join('');
    const brief = row
      .find('.brief')
      .map((__, part) => $(part).html() ?? '')
      .get()
      .join(' ');
    row.replaceWith(
      `<h4${attributes}>${href === undefined ? name : `<a href="${escapeHtml(href)}">${name}</a>`}</h4>` +
        declarations +
        (brief.trim() === '' ? '' : `<p>${brief}</p>`),
    );
  });
};

/**
 * Dokka (Kotlin API reference). Sections are the `h2.tableheader` blocks (Constructors,
 * Types, Properties, Functions and their inherited variants). Members are listed with their
 * declarations but documented on pages of their own, which the member headings link to.
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
      { selector: MEMBER_ROW, level: () => 4, id: () => undefined, title: rowName },
    ),
  header: qualifiedName,
  prepare,
};
