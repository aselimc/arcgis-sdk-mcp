import type { Cheerio, CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { isElement, squash } from '../dom.js';
import { stampOutline } from '../outline.js';
import { COMMON_REMOVE } from '../passes/remove-common.js';
import type { FamilyProfile } from '../types.js';

/** Where the content of an unknown page most likely is, most specific first. */
const CANDIDATES = ['main', 'article', '[role=main]', 'body'];
/** A specific container with at least this much text is taken without looking further. */
const MIN_SPECIFIC_CHARS = 200;

/**
 * The candidate with the most text once page chrome is gone. Chrome is removed from the
 * page itself: what is left is what gets converted.
 */
function root($: CheerioAPI): Cheerio<Element> {
  $(COMMON_REMOVE).remove();
  $('header, footer').remove();
  let best: Element | undefined;
  let bestLength = 0;
  for (const selector of CANDIDATES) {
    $(selector).each((_, el) => {
      const length = squash($(el).text()).length;
      if (isElement(el) && length > bestLength) {
        best = el;
        bestLength = length;
      }
    });
    // A specific container with real content beats a larger, less specific one.
    if (bestLength >= MIN_SPECIFIC_CHARS) break;
  }
  return best === undefined ? $('body').first() : $(best);
}

/**
 * The fallback for pages of no known family, and for known families whose markup drifted.
 * It applies the shared passes only; a page converted this way is reported as degraded.
 */
export const generic: FamilyProfile = {
  id: 'generic',
  defaultLanguage: '',
  root,
  // The title is read before `root` removes page headers.
  title: ($) => {
    const heading = squash($('h1').first().text());
    return heading === '' ? $('title').first().text() : heading;
  },
  outline: (page) => stampOutline(page),
  prepare: ($, env) => {
    $('h1')
      .filter((_, heading) => squash($(heading).text()) === env.title)
      .first()
      .remove();
  },
};
