import type { AnyNode } from 'domhandler';
import { escapeHtml, headingLevel, replaceWithPre, squash, tagged } from '../dom.js';
import { stampOutline } from '../outline.js';
import type { FamilyProfile, PageView, Pass } from '../types.js';
import { fragment } from './shared.js';

const ROOT = 'div#content.main-content';

/** Dokka splits identifiers into spans separated by `<wbr>`: join them without spaces. */
const identifier = (text: string): string => text.replace(/\s+/g, '');

/**
 * The fully qualified name, from the root's `pageIds` attribute
 * (`<module>::<package>/<Type>///PointingToDeclaration//...`).
 */
function qualifiedName(page: PageView): AnyNode[] {
  const location = (page.root.attr('pageids') ?? '').split('::')[1]?.split('///')[0] ?? '';
  const name = location.replace(/\/+$/, '').replace(/\//g, '.');
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
    replaceWithPre($, symbol, symbol.text(), 'kotlin');
  });
  $('span.kdoc-tag').each((_, el) => {
    const tag = $(el);
    const label = squash(tag.find('h4').first().remove().text());
    tag.replaceWith(`<p>${tagged('strong', `${label}:`)} ${escapeHtml(squash(tag.text()))}</p>`);
  });
  // Member rows: a linked name, the declarations (overloads share one row) and the brief.
  $('div.table-row').each((_, el) => {
    const row = $(el);
    const link = row.find('.main-subrow a').first();
    const name = escapeHtml(identifier(link.text()));
    const href = link.attr('href');
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
      `<h4>${href === undefined ? name : `<a href="${escapeHtml(href)}">${name}</a>`}</h4>` +
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
  // `Since` and similar tags are marked up as headings but are one-line facts.
  outline: (page) =>
    stampOutline(page, {
      selector: 'h1, h2, h3, h4, h5, h6',
      level: (el, $) => ($(el).closest('span.kdoc-tag').length > 0 ? 0 : headingLevel(el)),
    }),
  header: qualifiedName,
  prepare,
};
