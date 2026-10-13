import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import type { MemberEntry } from '../../core/types.js';
import {
  firstNonEmpty,
  firstSentence,
  removeComments,
  replaceWithPre,
  squash,
  tagged,
} from '../dom.js';
import { stampOutline } from '../outline.js';
import type { FamilyProfile, PageView, Pass } from '../types.js';
import { fragment } from './shared.js';

const ROOT = 'div.contentContainer';
/** Layout-only lists that wrap every block of the page. */
const BLOCK_LISTS = 'ul.blockList, ul.blockListLast';
/** Anchors of the groups themselves (`method.detail`, `field_summary`), not of members. */
const GROUP_ANCHOR = /[._](?:detail|summary)$/;
/** Nesting depth of the layout lists on real pages is 3; this bounds the unwrap loop. */
const MAX_UNWRAP_ROUNDS = 12;

/**
 * javadoc 1.8 anchors are `<a name>` elements, not ids: a group heading follows its anchor,
 * and a member heading sits in the list that follows the member's anchor.
 */
function anchorOf(el: Element, $: CheerioAPI): string | undefined {
  const heading = $(el);
  const holder = el.tagName === 'h4' ? heading.closest('ul') : heading;
  return holder.prev('a[name]').attr('name');
}

/** `Method Detail` gives `method`. */
const kindOf = (groupTitle: string): string =>
  firstNonEmpty(squash(groupTitle).split(' ')[0]?.toLowerCase(), 'member');

function memberAnchors(page: PageView): Element[] {
  return page.root
    .find('div.details a[name]')
    .filter((_, a) => !GROUP_ANCHOR.test(page.$(a).attr('name') ?? ''))
    .filter((_, a) => page.$(a).next('ul').find('h4').length > 0)
    .get();
}

function members(page: PageView): MemberEntry[] {
  const { $ } = page;
  return memberAnchors(page).map((anchor): MemberEntry => {
    const body = $(anchor).next('ul');
    const summary = firstSentence(body.find('div.block').first().text());
    return {
      id: $(anchor).attr('name') ?? '',
      name: squash(body.find('h4').first().text()),
      kind: kindOf($(anchor).parent().children('h3').first().text()),
      signature: squash(body.find('pre').first().text()),
      ...(summary === '' ? {} : { summary }),
      ...(body.find('span.deprecatedLabel').length > 0 ? { deprecated: true } : {}),
    };
  });
}

const prepare: Pass = ($) => {
  $('a[name]')
    .filter((_, a) => $(a).text().trim() === '')
    .remove();
  removeComments($, $.root());
  // Deepest first, so that an item's HTML already has its inner wrappers removed.
  for (let round = 0; round < MAX_UNWRAP_ROUNDS; round += 1) {
    const lists = $(BLOCK_LISTS);
    if (lists.length === 0) break;
    lists.each((_, el) => {
      const list = $(el);
      if (list.find(BLOCK_LISTS).length > 0) return;
      const items = list
        .children('li')
        .map((__, item) => $(item).html() ?? '')
        .get();
      list.replaceWith(items.join(''));
    });
  }
  $('span.deprecatedLabel').each((_, el) => {
    $(el).replaceWith(tagged('strong', $(el).text()));
  });
  // Captions hold the tab labels run together ("All MethodsInstance Methods").
  $('span.tabEnd, table.memberSummary caption, table.overviewSummary caption, hr, br').remove();
  $('pre')
    .filter((_, pre) => $(pre).closest('div.block').length === 0)
    .each((_, pre) => {
      replaceWithPre($, $(pre), $(pre).text(), 'java');
    });
};

/**
 * javadoc 1.8 (Enterprise SDK ArcObjects reference). The class page is a standalone document
 * of the frames layout: the title and package sit in `div.header` outside the content root,
 * and every block is wrapped in layout lists. A member is the list that follows its
 * `<a name>` anchor (`getMapName-int-`).
 */
export const javadocLegacy: FamilyProfile = {
  id: 'javadoc-legacy',
  defaultLanguage: 'java',
  root: ($) => $(ROOT).first(),
  title: ($) => $('div.header .title').first().text(),
  outline: (page) => stampOutline(page, { selector: 'h1, h2, h3, h4, h5, h6', id: anchorOf }),
  members,
  header: (page) => {
    const packageName = squash(page.$('div.header .subTitle').first().text());
    return packageName === '' ? [] : fragment(page.$, `<p>${tagged('code', packageName)}</p>`);
  },
  sliceMember: (page, id) =>
    memberAnchors(page)
      .filter((anchor) => page.$(anchor).attr('name') === id)
      .slice(0, 1)
      .flatMap((anchor) => page.$(anchor).next('ul').get()),
  prepare,
};
