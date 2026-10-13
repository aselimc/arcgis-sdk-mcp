/**
 * Pieces several family profiles share: the page shell of developers.arcgis.com (the same
 * theme on its Astro and Gatsby sites) and the metadata block built from `<meta>` tags.
 */
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { escapeHtml } from '../dom.js';
import type { Pass } from '../types.js';

/** The banner that opens a landing page of the theme; such a page has no `div.page-content`. */
const LANDING_BANNER = 'header.page-banner';

/**
 * Content root of the developers.arcgis.com theme: the page content block, or the whole
 * `main` on a landing page (a banner followed by sections of cards).
 */
export function themeRoot($: CheerioAPI): Cheerio<Element> {
  const main = $('main#main').first();
  const body = main.find('div#skip-to-content.page-content').first();
  if (body.length > 0) return body;
  const content = main.find('div.page-content').first();
  if (content.length > 0) return content;
  return main.children(LANDING_BANNER).length > 0 ? main : content;
}

/**
 * Page title of the developers.arcgis.com theme (an `h1`, or an `h2` on sample pages); on a
 * landing page, the title of its banner.
 */
export function themeTitle($: CheerioAPI): string {
  const title = $('main#main header.page-header .page-title').first().text();
  return title.trim() === ''
    ? $(`main#main > ${LANDING_BANNER} .page-banner-title`).first().text()
    : title;
}

/**
 * What a landing page shows besides its sections: the banner, whose title the pipeline
 * writes itself, and the "Jump to" strip of in-page links.
 */
export const dropLandingChrome: Pass = ($) => {
  $(`${LANDING_BANNER}, div.top-site-header`).remove();
};

/**
 * Id of a heading: its own, else the id of the `section[id]` it opens. dartdoc and javadoc
 * put the anchor on the section element, not on the heading.
 */
export function headingOrSectionId(element: Element, $: CheerioAPI): string | undefined {
  const own = $(element).attr('id');
  if (own !== undefined && own !== '') return own;
  const section = $(element).parent('section[id]');
  return section.children().first().get(0) === element ? section.attr('id') : undefined;
}

/** Parses an HTML fragment into detached nodes of the page's document. */
export function fragment($: CheerioAPI, html: string): AnyNode[] {
  return $.parseHTML(html);
}

/**
 * A bullet list of the named `<meta>` values that are present, as detached nodes; empty when
 * none is. `fields` maps a meta name to the label shown.
 */
export function metaBlock(
  $: CheerioAPI,
  fields: ReadonlyArray<[name: string, label: string]>,
): AnyNode[] {
  const items: string[] = [];
  for (const [name, label] of fields) {
    const value = ($(`meta[name="${name}"]`).attr('content') ?? '').trim();
    if (value !== '')
      items.push(`<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</li>`);
  }
  return items.length === 0 ? [] : fragment($, `<ul>${items.join('')}</ul>`);
}
