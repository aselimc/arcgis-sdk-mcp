import type { Cheerio, CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { findIn, isElement, squash } from '../dom.js';
import { stampOutline } from '../outline.js';
import { COMMON_REMOVE } from '../passes/remove-common.js';
import type { FamilyProfile } from '../types.js';

/** Where the content of an unknown page most likely is, most specific first. */
const CANDIDATES = ['main', 'article', '[role=main]', 'body'];
/** A specific container with at least this much text is taken without looking further. */
const MIN_SPECIFIC_CHARS = 200;

/** Text that would not survive cleaning does not count as content. */
const CHROME = `${COMMON_REMOVE}, footer`;

/** Length of an element's text without the text of page chrome inside it. */
function contentLength($: CheerioAPI, el: AnyNode): number {
  const chrome = findIn($, $(el), CHROME).filter(
    (_, inner) => $(inner).parent().closest(CHROME).length === 0,
  );
  return squash($(el).text()).length - squash(chrome.text()).length;
}

/**
 * The candidate with the most content. Nothing is removed here: the shared passes read
 * buttons and icons before they delete them.
 */
function root($: CheerioAPI): Cheerio<Element> {
  let best: Element | undefined;
  let bestLength = 0;
  for (const selector of CANDIDATES) {
    $(selector).each((_, el) => {
      const length = contentLength($, el);
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
  title: ($) => {
    const heading = squash($('h1').first().text());
    return heading === '' ? $('title').first().text() : heading;
  },
  outline: (page) => stampOutline(page),
  prepare: ($, env) => {
    $('footer').remove();
    $('h1')
      .filter((_, heading) => squash($(heading).text()) === env.title)
      .first()
      .remove();
  },
};
