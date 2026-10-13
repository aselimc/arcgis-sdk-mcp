import type { AnyNode } from 'domhandler';
import type { MemberEntry } from '../../core/types.js';
import {
  escapeHtml,
  firstSentence,
  ID_ATTR,
  isElement,
  squash,
  tagged,
  unwrap,
  workRoot,
} from '../dom.js';
import { stampOutline } from '../outline.js';
import { sliceUntil } from '../slice.js';
import type { FamilyProfile, PageView, Pass } from '../types.js';
import { themeTitle } from './shared.js';

/** A member heading: the text is the full signature, with qualifiers such as `[explicit]`. */
const MEMBER_HEADING = 'h3.fn';

const endsMember = (node: AnyNode): boolean =>
  isElement(node) &&
  (node.tagName === 'h2' || (node.tagName === 'h3' && /\bfn\b/.test(node.attribs.class ?? '')));

function members(page: PageView): MemberEntry[] {
  const { $ } = page;
  return page.root
    .find(`${MEMBER_HEADING}[id]`)
    .map((_, heading): MemberEntry => {
      const id = $(heading).attr('id') ?? '';
      const summary = firstSentence($(heading).nextUntil('h2, h3').filter('p').first().text());
      return {
        id,
        name: squash($(heading).find('span.name').first().text()) || id,
        kind: 'function',
        signature: squash($(heading).text()),
        ...(summary === '' ? {} : { summary }),
      };
    })
    .get();
}

const prepare: Pass = ($) => {
  // The page breadcrumb is emitted as an `li` outside any list.
  workRoot($).children('li').remove();
  $(MEMBER_HEADING).each((_, el) => {
    const heading = $(el);
    const id = heading.attr(ID_ATTR) ?? heading.attr('id') ?? '';
    const name = squash(heading.find('span.name').first().text()) || id;
    heading.replaceWith(
      tagged('h3', name, `${ID_ATTR}="${escapeHtml(id)}"`) +
        tagged('pre', squash(heading.text()), 'data-md-lang="cpp"'),
    );
  });
  // The declaration of the type (`class Ns::Name`): a fence, so that it reads as the
  // signature. Its namespace links point at unrelated enums upstream and are dropped.
  $('span.small-subtitle').each((_, el) => {
    $(el).replaceWith(tagged('pre', squash($(el).text()), 'data-md-lang="cpp"'));
  });
  unwrap($, $('div.table'));
  // Member summary tables (return type | name and arguments): one linked signature per bullet.
  $('table.alignedsummary')
    .not('.requisites')
    .each((_, table) => {
      const items = $(table)
        .find('tr')
        .map((__, row) => {
          const right = $(row).find('td.memItemRight');
          const signature = tagged(
            'code',
            squash(`${$(row).find('td.memItemLeft').text()} ${right.text()}`),
          );
          const href = right.find('a').first().attr('href');
          return `<li>${href === undefined ? signature : `<a href="${escapeHtml(href)}">${signature}</a>`}</li>`;
        })
        .get();
      $(table).replaceWith(`<ul>${items.join('')}</ul>`);
    });
};

/**
 * Qt (C++) API reference: QDoc output embedded in the Astro shell. Sections are `h2[id]`
 * (`public-functions`, `details`, ...); each member is an `h3.fn[id]` followed by its
 * documentation up to the next member. Overloads differ only by a numeric id suffix
 * (`Map-3`), so the member list carries the full signatures.
 */
export const qdoc: FamilyProfile = {
  id: 'qdoc',
  defaultLanguage: 'cpp',
  root: ($) => $('div.qdoc-html').first(),
  title: themeTitle,
  outline: (page) => stampOutline(page),
  members,
  sliceMember: (page, id) => {
    const heading = page.root
      .find(MEMBER_HEADING)
      .filter((_, el) => page.$(el).attr('id') === id)
      .get(0);
    return heading === undefined ? undefined : sliceUntil(heading, endsMember);
  },
  prepare,
};
