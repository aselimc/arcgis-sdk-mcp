import type { CheerioAPI } from 'cheerio';
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
    const text = $(el)
      .text()
      .replace(/[ \t]+/g, ' ')
      .replace(/\s*\n\s*/g, '\n')
      .trim();
    replaceWithPre($, $(el), text, 'dart');
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
  outline: (page) =>
    stampOutline(page, { ...HEADINGS, id: headingOrSectionId }),
  prepare,
};
