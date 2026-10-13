/**
 * Pieces several family profiles share: the page shell of developers.arcgis.com (the same
 * theme on its Astro and Gatsby sites) and the metadata block built from `<meta>` tags.
 */
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { escapeHtml } from '../dom.js';

/** Content root of the developers.arcgis.com theme. */
export function themeRoot($: CheerioAPI): Cheerio<Element> {
  const main = $('main#main').first();
  const body = main.find('div#skip-to-content.page-content').first();
  return body.length > 0 ? body : main.find('div.page-content').first();
}

/** Page title of the developers.arcgis.com theme (an `h1`, or an `h2` on sample pages). */
export function themeTitle($: CheerioAPI): string {
  return $('main#main header.page-header .page-title').first().text();
}

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
