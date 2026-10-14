import { escapeHtml, squash, tagged } from '../dom.js';
import { stampOutline } from '../outline.js';
import type { FamilyProfile, Pass } from '../types.js';
import { dropLandingChrome, themeRoot, themeTitle } from './shared.js';

const ARROW = ' \u2192 ';

/**
 * The class pages of the generated API references (Survey123 web app API) show the base
 * classes as a row of names with arrow icons between them. Without the icons the names run
 * together (`Survey123WebFormSurvey123JsApiCommon`): the arrow is written as text.
 */
const inheritanceChains: Pass = ($) => {
  $('div > b:first-child')
    .filter((_, label) => /^inheritance:?$/i.test(squash($(label).text())))
    .each((_, label) => {
      const row = $(label).parent();
      const names = row
        .children('span')
        .map((__, name) => squash($(name).text()))
        .get()
        .filter((name) => name !== '');
      if (names.length === 0) return;
      const chain = names.map((name) => tagged('code', name)).join(escapeHtml(ARROW));
      row.replaceWith(`<p>${tagged('strong', 'Inheritance:')} ${chain}</p>`);
    });
};

/**
 * The same references set every type name in italics, and a compound type is an italic run
 * holding the italic names of its parts (`<em>{ count?: <em>number</em>[] }</em>`). Written
 * as emphasis it comes out as `_{ count?: _number_\[\]; ... }_`; it is a type expression,
 * and is written as code like the signatures and return types of the same page.
 */
const typeExpressions: Pass = ($) => {
  $('em:has(em), i:has(i)')
    .filter((_, el) => $(el).parents('em, i, code, pre').length === 0)
    .each((_, el) => {
      $(el).replaceWith(tagged('code', squash($(el).text())));
    });
};

const prepare: Pass = ($, env) => {
  dropLandingChrome($, env);
  inheritanceChains($, env);
  typeExpressions($, env);
};

/**
 * Gatsby MDX guides on developers.arcgis.com (Arcade, the Python guide, Calcite,
 * `/documentation`). Same shell as the Astro sites; code blocks are react-syntax-highlighter
 * blocks, handled by the shared `fixGatsbyCode` pass, and illustration cards by the shared
 * link pass.
 */
export const gatsby: FamilyProfile = {
  id: 'gatsby',
  defaultLanguage: '',
  root: themeRoot,
  title: themeTitle,
  outline: (page) => stampOutline(page),
  prepare,
};
