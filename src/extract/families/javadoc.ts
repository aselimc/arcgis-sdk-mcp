import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import type { MemberEntry } from '../../core/types.js';
import { firstSentence, replaceWithPre, squash, tagged } from '../dom.js';
import { HEADINGS, stampOutline } from '../outline.js';
import type { FamilyProfile, PageView, Pass } from '../types.js';
import { headingOrSectionId } from './shared.js';

const ROOT = 'main[role=main]';
/** A member: its id is the erased signature, e.g. `<init>(com.example.Item)`. */
const DETAIL = 'section.detail';
const ARROW = ' \u2192 ';

const KINDS: Readonly<Record<string, string>> = {
  'constructor-detail': 'constructor',
  'method-detail': 'method',
  'field-detail': 'field',
  'enum-constant-detail': 'constant',
};

function members(page: PageView): MemberEntry[] {
  const { $ } = page;
  return page.root
    .find(`${DETAIL}[id]`)
    .map((_, el): MemberEntry => {
      const section = $(el);
      const group = section.parent().closest('section[id]').attr('id') ?? '';
      const summary = firstSentence(section.children('div.block').first().text());
      const deprecated = section.find('.deprecated-label, .deprecation-block').length > 0;
      return {
        id: section.attr('id') ?? '',
        name: squash(section.children('h3').first().text()),
        kind: KINDS[group] ?? 'member',
        signature: squash(section.children('div.member-signature').first().text()),
        ...(summary === '' ? {} : { summary }),
        ...(deprecated ? { deprecated: true } : {}),
      };
    })
    .get();
}

/** Summary tables are CSS grids of `div`s: regroup the cells into the rows of a real table. */
function gridsToTables($: CheerioAPI): void {
  $('div.summary-table, div.details-table').each((_, el) => {
    const classes = $(el).attr('class') ?? '';
    const cells = $(el).children('div').get();
    const isHeader = (cell: Element): boolean => $(cell).hasClass('table-header');
    const header = cells.filter(isHeader).map((cell) => `<th>${$(cell).html() ?? ''}</th>`);
    const declared = classes.includes('two-column') ? 2 : classes.includes('four-column') ? 4 : 3;
    const width = header.length > 0 ? header.length : declared;
    const body = cells.filter((cell) => !isHeader(cell));
    const rows: string[] = [];
    for (let start = 0; start < body.length; start += width) {
      const row = body
        .slice(start, start + width)
        .map((cell) => `<td>${$(cell).html() ?? ''}</td>`);
      rows.push(`<tr>${row.join('')}</tr>`);
    }
    $(el).replaceWith(
      `<table><thead><tr>${header.join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`,
    );
  });
}

/** The nested `div.inheritance` tree as one line: `Object \u2192 GeoModel \u2192 ArcGISMap`. */
function flattenInheritance($: CheerioAPI): void {
  const outer = $('div.inheritance').first();
  if (outer.length === 0) return;
  const chain = outer
    .find('a')
    .map((_, link) => squash($(link).text()))
    .get();
  const innermost = outer.find('div.inheritance').last();
  const own = squash(
    (innermost.length > 0 ? innermost : outer).clone().children().remove().end().text(),
  );
  const names = [...chain, own].filter((name) => name !== '');
  outer.replaceWith(
    `<p>${tagged('strong', 'Inheritance:')} ${names.map((name) => tagged('code', name)).join(ARROW)}</p>`,
  );
}

const prepare: Pass = ($) => {
  $('div.header h1.title').remove();
  // `.table-tabs` are filter buttons with ARIA tab roles, not content tabs.
  $('.table-tabs, .copy, hr').remove();
  gridsToTables($);
  $('div.type-signature, div.member-signature').each((_, el) => {
    replaceWithPre($, $(el), squash($(el).text()), 'java');
  });
  flattenInheritance($);
  $('div.sub-title').each((_, el) => {
    $(el).replaceWith(`<p>${$(el).html() ?? ''}</p>`);
  });
  $('div.inherited-list').each((_, el) => {
    const label = squash($(el).find('h3').first().remove().text());
    $(el).replaceWith(`<p>${tagged('strong', `${label}:`)} ${$(el).html() ?? ''}</p>`);
  });
  $('span.deprecated-label').each((_, el) => {
    $(el).replaceWith(tagged('strong', $(el).text()));
  });
  // Layout lists around summaries and details: keep the items' content. Innermost first,
  // because the lists nest and an outer list is rebuilt from its HTML.
  for (const el of $('ul.summary-list, ul.details-list, ul.member-list').get().reverse()) {
    const items = $(el)
      .children('li')
      .map((_, item) => $(item).html() ?? '')
      .get();
    $(el).replaceWith(items.join(''));
  }
};

/**
 * javadoc 17 / 21. Sections are `section[id]` elements (`method-summary`, `method-detail`,
 * ...); each member is a `section.detail` whose id is its erased signature. Those ids hold
 * `<`, `(` and `,`, so they are compared as strings, never placed in a selector.
 */
export const javadoc: FamilyProfile = {
  id: 'javadoc',
  defaultLanguage: 'java',
  root: ($) => $(ROOT).first(),
  title: ($) => $(ROOT).find('h1.title').first().text(),
  outline: (page) =>
    stampOutline(page, { ...HEADINGS, id: headingOrSectionId }),
  members,
  sliceMember: (page, id) =>
    page.root
      .find(DETAIL)
      .filter((_, el) => page.$(el).attr('id') === id)
      .first()
      .get(),
  prepare,
};
