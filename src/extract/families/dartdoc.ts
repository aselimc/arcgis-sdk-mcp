import type { Cheerio, CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { escapeHtml, replaceWithPre, squash, tagged } from '../dom.js';
import { HEADINGS, stampOutline } from '../outline.js';
import type { FamilyProfile, Pass } from '../types.js';
import { headingOrSectionId } from './shared.js';

const ROOT = 'div#dartdoc-main-content';
/** The member summary lists: `dt[id]` holds the signature, `dd` the description and features. */
const SUMMARY_LISTS =
  'section.summary dl, dl.constructor-summary-list, dl.properties, dl.callables';

/** `ArcGISMap class` plus its feature chips in brackets: `ArcGISMap class (final)`. */
function title($: CheerioAPI): string {
  const heading = $(ROOT).find('h1').first().clone();
  heading.find('.feature').each((_, feature) => {
    $(feature).replaceWith(` (${escapeHtml(squash($(feature).text()))})`);
  });
  return heading.text();
}

/** A declaration longer than this is written with one parameter per line. */
const MAX_DECLARATION_LINE = 100;

/** Stands in for the parameter list while the text around it is read (a private-use character). */
const PARAMETERS = '\uE000';

/** Text on one line, without the spaces the markup leaves inside brackets and before commas. */
function tidy(text: string): string {
  return squash(text)
    .replace(/([([{]) /g, '$1')
    .replace(/ ([)\]},])/g, '$1');
}

/**
 * The declaration of a member as Dart writes it. The page lays out every token of the
 * signature block on a line of its own (return type, `get`, name, each parameter):
 * annotations keep their own lines, the rest is one line, or one parameter per line when
 * that line would be long.
 */
function declarationOf($: CheerioAPI, section: Cheerio<Element>): string {
  const annotations = section
    .find('ol.annotation-list > li')
    .map((_, item) => tidy($(item).text()))
    .get();
  section.find('ol.annotation-list').remove();
  const line = tidy(section.text()).replace(/,([)\]}])/g, '$1');
  const list = section.find('ol.parameter-list').first();
  const parameters = list
    .children('li')
    .map((_, item) => tidy($(item).text()))
    .get();
  if (line.length <= MAX_DECLARATION_LINE || parameters.length < 2) {
    return [...annotations, line].join('\n');
  }
  list.replaceWith(PARAMETERS);
  const [head = '', tail = ''] = tidy(section.text()).split(PARAMETERS);
  return [
    ...annotations,
    head.trimEnd(),
    ...parameters.map((parameter) => `  ${parameter}`),
    tail.trim(),
  ].join('\n');
}

const prepare: Pass = ($) => {
  $('h1').first().remove();
  $(
    '#dartdoc-sidebar-left, #dartdoc-sidebar-right, .sidebar, footer, .material-symbols-outlined, #source',
  ).remove();
  $(SUMMARY_LISTS).each((_, el) => {
    const items = $(el)
      .children('dt')
      .map((__, dt) => {
        const term = $(dt);
        const description = term.next('dd');
        const features = description
          .find('.features .feature, .constructor-modifier')
          .map((___, feature) => squash($(feature).text()))
          .get()
          .filter((feature) => feature !== '');
        description.find('.features, .constructor-modifier').remove();
        const signature = tagged('code', squash(term.text()));
        const href = term.find('.name a').first().attr('href');
        const link =
          href === undefined ? signature : `<a href="${escapeHtml(href)}">${signature}</a>`;
        const flags = features.length === 0 ? '' : ` ${tagged('em', `(${features.join(', ')})`)}`;
        const text = (description.html() ?? '').trim();
        return `<li>${link}${flags}${text === '' ? '' : `: ${text}`}</li>`;
      })
      .get();
    $(el).replaceWith(`<ul>${items.join('')}</ul>`);
  });
  $('section.multi-line-signature').each((_, el) => {
    replaceWithPre($, $(el), declarationOf($, $(el)), 'dart');
  });
};

/**
 * dartdoc (Flutter API reference). Sections are `section[id]` elements (`constructors`,
 * `instance-properties`, `instance-methods`, `operators`, `static-methods`); the summary
 * lists link to the member pages, where the full member documentation lives.
 */
export const dartdoc: FamilyProfile = {
  id: 'dartdoc',
  defaultLanguage: 'dart',
  root: ($) => $(ROOT).first(),
  title,
  outline: (page) => stampOutline(page, { ...HEADINGS, id: headingOrSectionId }),
  prepare,
};
