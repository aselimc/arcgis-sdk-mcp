import { LANG_ATTR, squash, unwrap } from '../dom.js';
import { stampOutline } from '../outline.js';
import type { FamilyProfile, Pass } from '../types.js';
import { metaBlock } from './shared.js';

const META_FIELDS: ReadonlyArray<[string, string]> = [
  ['article-number', 'Article ID'],
  ['article-type', 'Type'],
  ['product', 'Product'],
  ['first-published', 'First published'],
  ['last-published', 'Last published'],
];

/** The editor does not record a language; these openings are unmistakably Python. */
const PYTHON_HINT = /^\s*(?:import \w|from \w+ import |def \w+\(|print\s*\(|arcpy\.)/m;

const prepare: Pass = ($) => {
  $('img[src*="icon"]').remove();
  $('h2').each((_, el) => {
    $(el).text(squash($(el).text()));
  });
  $('pre').each((_, el) => {
    $(el).attr(LANG_ATTR, PYTHON_HINT.test($(el).text()) ? 'python' : '');
  });
  unwrap($, $('section'));
};

/**
 * support.esri.com knowledge-base articles. Only `div.esri-technical-info-text` is content;
 * share links, the sidebar and the contact block are siblings outside it. Sections are
 * `section > h2` (Summary, Procedure, Cause, Solution) without ids.
 */
export const supportKb: FamilyProfile = {
  id: 'support-kb',
  defaultLanguage: '',
  root: ($) => $('div.esri-technical div.esri-technical-info-text').first(),
  title: ($) => $('div.esri-technical h1.esri-text__title').first().text(),
  outline: (page) => stampOutline(page),
  header: (page) => metaBlock(page.$, META_FIELDS),
  prepare,
};
