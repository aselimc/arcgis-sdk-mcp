import type { CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { headingLevel, ID_ATTR, replaceWithPre, squash, tagged } from '../dom.js';
import { HEADINGS, stampOutline } from '../outline.js';
import type { FamilyProfile, PageView, Pass } from '../types.js';
import { dropAstroChrome } from './astro.js';
import { CARD, indexTable, NESTED_ATTR, readCard, toMember, type Card } from './js-ref-cards.js';
import { themeRoot, themeTitle } from './shared.js';

/** The page's own member summary tables; never the tables inside a card. */
const SUMMARY_TABLES =
  'starship-lumina-member-section starship-styled-table, div[id$="Events"] > starship-styled-table';

/** The import snippet (ESM / CDN tabs) that opens a class page. */
function importTabs(page: PageView): AnyNode[] {
  const tabs = page.root
    .find('starship-tabs')
    .filter((_, el) => page.$(el).closest(`.lumina-description, ${CARD}`).length === 0)
    .first();
  return tabs.remove().get();
}

/**
 * The page's link-heavy summary tables go; every member section (`h2`) that has cards gets a
 * generated index of them right under its heading.
 */
function indexMemberSections($: CheerioAPI): void {
  $(SUMMARY_TABLES)
    .filter((_, table) => $(table).closest(CARD).length === 0)
    .remove();
  let heading: Element | undefined;
  let cards: Card[] = [];
  const flush = (): void => {
    if (heading !== undefined && cards.length > 0) $(heading).after(indexTable(cards));
    cards = [];
  };
  $(`h2, ${CARD}`).each((_, el) => {
    const inCard = $(el).parent().closest(CARD).length > 0;
    if (inCard) return;
    if (el.tagName === 'h2') {
      flush();
      heading = el;
    } else cards.push(readCard($, el));
  });
  flush();
}

/** Card header: a heading carrying the member id, then the kind and the chips. */
function rewriteCards($: CheerioAPI): void {
  // Headings inside a card ("Parameters", "Returns") are labels: a member is one section.
  $(CARD)
    .find('h1, h2, h3, h4, h5, h6')
    .filter((_, heading) => $(heading).closest('header').length === 0)
    .each((_, heading) => {
      $(heading).replaceWith(`<p>${tagged('strong', squash($(heading).text()))}</p>`);
    });
  $(CARD).each((_, el) => {
    const card = readCard($, el);
    const tag = card.nested ? 'h4' : 'h3';
    const labels = [
      card.kind === '' ? '' : tagged('em', card.kind),
      ...card.chips.map((chip) => tagged('code', chip)),
    ].filter((label) => label !== '');
    $(el)
      .children('header')
      .first()
      .replaceWith(
        tagged(tag, card.name, `${ID_ATTR}="${card.id.replace(/"/g, '&quot;')}"`) +
          (labels.length === 0 ? '' : `<p>${labels.join(' ')}</p>`),
      );
    $(el)
      .children('dl')
      .each((__, list) => {
        const term = $(list).children('dt').first();
        if (term.text().trim() !== 'Signature') return;
        replaceWithPre($, $(list), squash($(list).children('dd').first().text()), 'ts');
      });
  });
}

const prepare: Pass = ($, env) => {
  dropAstroChrome($, env);
  indexMemberSections($);
  if (env.overview) $(CARD).remove();
  else rewriteCards($);
};

/** Section headings left without content (`Type definitions` on most class pages). */
const dropEmptySections: Pass = ($) => {
  $('h2').each((_, el) => {
    const heading = $(el);
    const body = heading.nextUntil('h2');
    if (squash(body.text()) !== '' || body.find('img, pre, table').length > 0) return;
    // A heading that closes a wrapper may have its content after the wrapper.
    const after = heading.parent().nextAll().first();
    if (heading.nextAll().length === 0 && squash(after.text()) !== '' && !after.is('h2')) return;
    body.remove();
    heading.remove();
  });
};

/**
 * JavaScript API reference pages (`@arcgis/core` classes and type modules). Sections are the
 * `h2[id]` blocks (`overview`, `constructors`, `properties`, `methods`, `events`,
 * `type-definitions`); every member is a card and one section of its own, addressable by its
 * card id. A whole-page read with `detail` below `full` returns the overview: introduction
 * plus member index, without the member bodies.
 */
export const astroJsRef: FamilyProfile = {
  id: 'astro-js-ref',
  defaultLanguage: 'ts',
  overviewDropsMembers: true,
  root: themeRoot,
  title: themeTitle,
  // Headings inside cards are member headings; `prepare` writes them with the card id.
  outline: (page) => {
    // A nested card keeps its heading level when it is read on its own.
    page.root.find(`${CARD} ${CARD}`).each((_, card) => void page.$(card).attr(NESTED_ATTR, ''));
    return stampOutline(page, {
      ...HEADINGS,
      level: (el, $) => ($(el).closest(CARD).length > 0 ? 0 : headingLevel(el)),
    });
  },
  // The cards nested in a type definition are the fields of that type (`RangeValue-name`),
  // not members of the class: listed here, `Query` would claim a property `name` that
  // cannot be looked up as `Query.name`. They stay documented in the type definition's
  // own section, and each is still a section under its card id.
  members: (page) =>
    page.root
      .find(CARD)
      .map((_, el) => readCard(page.$, el))
      .get()
      .filter((card) => !card.nested && card.id !== '')
      .map(toMember),
  header: importTabs,
  sliceMember: (page, id) =>
    page.root
      .find(CARD)
      .filter((_, el) => page.$(el).children('header').find('h3').first().attr('id') === id)
      .first()
      .get(),
  prepare,
  clean: dropEmptySections,
};
