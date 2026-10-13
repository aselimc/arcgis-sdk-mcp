import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { squash, tagged, unwrap } from '../dom.js';
import { stampOutline } from '../outline.js';
import type { FamilyProfile, Pass } from '../types.js';

const ROOT = 'article#_content';
const ARROW = ' \u2192 ';

/** The links (or unlinked names) inside a metadata block, as HTML. */
function references($: CheerioAPI, block: Element, selector: string): string[] {
  return $(block)
    .find(selector)
    .map((_, reference) => $.html(reference))
    .get();
}

/** `level2` gives 2: the depth of an entry in the inheritance block. */
const levelOf = (entry: Element): number =>
  Number(/(?:^|\s)level(\d+)(?:\s|$)/.exec(entry.attribs.class ?? '')?.[1] ?? Number.NaN);

/**
 * The inheritance block as two lines. DocFX lists the base types one level apart, then the
 * type itself (the one name that is not a link), then the types derived from it one level
 * below: read as one chain, twenty sibling subclasses of `Layer` would each seem to derive
 * from the one before. The chain ends at the type; what follows is the "Derived" line.
 */
function inheritance($: CheerioAPI, block: Element): string {
  const label = squash($(block).find('h5').first().text()) || 'Inheritance';
  const entries = $(block).children('div').get();
  const reference = (entry: Element): string => references($, entry, 'a, span.xref').join('');
  // The type itself is not linked; without that marker, the deepest level holds the derived types.
  let self = entries.findIndex((entry) => $(entry).find('a').length === 0);
  if (self === -1) {
    const deepest = Math.max(...entries.map(levelOf).filter((level) => !Number.isNaN(level)));
    const first = entries.findIndex((entry) => levelOf(entry) === deepest);
    const shared = entries.filter((entry) => levelOf(entry) === deepest).length > 1;
    self = shared && first > 0 ? first - 1 : entries.length - 1;
  }
  const chain = entries.slice(0, self + 1).map(reference);
  const derived = entries.slice(self + 1).map(reference);
  return (
    `<p>${tagged('strong', `${label}:`)} ${chain.join(ARROW)}</p>` +
    (derived.length === 0 ? '' : `<p>${tagged('strong', 'Derived:')} ${derived.join(', ')}</p>`)
  );
}

const prepare: Pass = ($) => {
  $('h1').first().remove();
  $('.collapsible-button, a.header-action, .anchorjs-link').remove();
  // Thirty-odd one-link divs become one comma-separated line.
  $('div.inheritedMembers').each((_, el) => {
    const label = tagged('strong', 'Inherited members:');
    $(el).replaceWith(`<p>${label} ${references($, el, 'a, span.xref').join(', ')}</p>`);
  });
  $('div.inheritance').each((_, el) => {
    $(el).replaceWith(inheritance($, el));
  });
  $('div.implements, div.derived').each((_, el) => {
    const label = squash($(el).find('h5').first().text());
    const items = references($, el, 'div a, div span.xref').join(', ');
    $(el).replaceWith(`<p>${tagged('strong', `${label}:`)} ${items}</p>`);
  });
  // `h5` and `h6` are field labels on these pages (Namespace, Assembly, Declaration).
  $('h5, h6').each((_, el) => {
    if (
      $(el).closest('div.NOTE, div.WARNING, div.TIP, div.IMPORTANT, div.CAUTION, div.alert')
        .length > 0
    )
      return;
    const text = squash($(el).text());
    const field = /^([^:]{1,40}):\s*(.+)$/.exec(text);
    $(el).replaceWith(
      field === null
        ? `<p>${tagged('strong', text)}</p>`
        : `<p>${tagged('strong', `${field[1] ?? ''}:`)} ${tagged('code', field[2] ?? '')}</p>`,
    );
  });
  unwrap($, $('div.codewrapper'));
};

/**
 * DocFX (.NET API reference). A type page lists its members per kind (`h3#constructors`,
 * `h3#properties`, `h3#methods`) in tables whose first cell links to the member's own page.
 */
export const docfxNet: FamilyProfile = {
  id: 'docfx-net',
  defaultLanguage: 'csharp',
  root: ($) => $(ROOT).first(),
  title: ($) => $(ROOT).find('h1').first().text(),
  // The field labels above are not sections.
  outline: (page) => stampOutline(page, { selector: 'h1, h2, h3, h4' }),
  prepare,
};
