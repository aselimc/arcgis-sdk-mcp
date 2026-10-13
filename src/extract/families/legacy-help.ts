import type { Cheerio, CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { escapeHtml, firstNonEmpty, squash, tagged, unwrap } from '../dom.js';
import { stampOutline } from '../outline.js';
import type { FamilyProfile, Pass } from '../types.js';
import { metaBlock } from './shared.js';

const META_FIELDS: ReadonlyArray<[string, string]> = [
  ['product', 'Product'],
  ['version', 'Version'],
  ['last-modified', 'Last modified'],
];

function root($: CheerioAPI): Cheerio<Element> {
  const inSection = $('div.content-section main').first();
  return inSection.length > 0 ? inSection : $('main').first();
}

/** The id of the `section` element a heading opens (`ESRI_SECTION1_<GUID>`): in-page links use it. */
function sectionAlias(el: Element, $: CheerioAPI): string | undefined {
  const section = $(el).parent('section[id]');
  return section.children().first().get(0) === el ? section.attr('id') : undefined;
}

const prepare: Pass = ($) => {
  $('.feedback, .icon-ui-link, a.anchor').remove();
  // `h4.table` repeats the table caption.
  $('h4.table').remove();
  $('span.usertext, span[purpose=codeph], span.codeph, kbd').each((_, el) => {
    $(el).replaceWith(tagged('code', $(el).text().trim()));
  });
  $('span.uicontrol, span.wintitle').each((_, el) => {
    $(el).replaceWith(`<strong>${$(el).html() ?? ''}</strong>`);
  });
  unwrap($, $('span.ph, span.keyword'));
  $('figure').each((_, el) => {
    const image = $(el).find('img').first();
    const caption = squash($(el).find('figcaption').text());
    const alt = escapeHtml(firstNonEmpty(image.attr('alt'), caption, 'figure'));
    const src = escapeHtml(image.attr('src') ?? '');
    $(el).replaceWith(image.length === 0 ? '' : `<p><img src="${src}" alt="${alt}"></p>`);
  });
  unwrap($, $('div.codeblock, div.codeblockdesc'));
  // Step wrappers carry no meaning of their own.
  unwrap(
    $,
    $(
      'div.stepinfo, div.stepresult, div.stepexample, div.info, div.steps, div.substeps, div.overflow-auto',
    ),
  );
};

/**
 * Legacy Apache help (doc.arcgis.com and older product help). The title is outside `main`;
 * sections are nested `section.section1` / `section.section2` elements whose ids are opaque
 * GUIDs, so section ids are slugs of the heading text and the GUID stays usable as an alias.
 */
export const legacyHelp: FamilyProfile = {
  id: 'legacy-help',
  defaultLanguage: '',
  root,
  title: ($) => {
    const inHeader = $('header.trailer-1 > h1').first();
    return (inHeader.length > 0 ? inHeader : $('h1').first()).text();
  },
  // `h5` labels note boxes; `h4.table` duplicates captions.
  outline: (page) =>
    stampOutline(page, {
      selector: 'h1, h2, h3, h4',
      level: (el, $) => ($(el).is('h4.table') ? 0 : Number(el.tagName.charAt(1))),
      alias: sectionAlias,
    }),
  header: (page) => metaBlock(page.$, META_FIELDS),
  prepare,
};
