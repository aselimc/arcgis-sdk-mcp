import { tagged } from '../dom.js';
import type { Pass } from '../types.js';

interface AsideRule {
  selector: string;
  /** Element holding the label, searched inside the aside. */
  label: string;
  /** Element holding the body; default: what is left after the label is removed. */
  body?: string;
  /**
   * What to do without a label element: `named` uses a label derived from the element,
   * `quote` quotes the content as it is (it opens with its own bold label), `skip` leaves
   * the element alone (a layout `div.panel` is not a note).
   */
  unlabelled: 'named' | 'quote' | 'skip';
}

const RULES: readonly AsideRule[] = [
  // developers.arcgis.com (Astro and Gatsby theme)
  {
    selector: 'aside.note, aside[role=note]',
    label: 'header span',
    body: 'div.contents',
    unlabelled: 'named',
  },
  // doc.esri.com and DocFX
  {
    selector: 'div.alert, div.NOTE, div.WARNING, div.TIP, div.IMPORTANT, div.CAUTION',
    label: 'h5',
    unlabelled: 'skip',
  },
  // Sphinx and QDoc (`div.admonition.note`: before the plain `div.note` rule)
  { selector: 'div.admonition', label: 'p.admonition-title', unlabelled: 'named' },
  // legacy help
  { selector: 'div.panel', label: 'h5', unlabelled: 'skip' },
  // legacy help with a label; the JavaScript reference without one
  { selector: 'div.note', label: 'h5', unlabelled: 'quote' },
];

/** `admonition warning` names the kind in its second class. */
function labelFromClass(classes: string): string {
  const kind = classes.split(/\s+/).find((name) => name !== '' && name !== 'admonition');
  return kind === undefined ? 'Note' : kind.charAt(0).toUpperCase() + kind.slice(1);
}

/**
 * Notes, warnings and other admonitions become a block quote that opens with the label in
 * bold (`> **Caution:**`), whatever markup the site used for the box.
 */
export const fixAsides: Pass = ($) => {
  for (const rule of RULES) {
    // Innermost first: a note inside a note is rewritten before its parent is serialised.
    for (const el of $(rule.selector).get().reverse()) {
      const aside = $(el);
      const labelEl = aside.find(rule.label).first();
      if (labelEl.length === 0 && rule.unlabelled === 'skip') continue;
      const fallback = aside.is('aside') ? 'Note' : labelFromClass(aside.attr('class') ?? '');
      const text = labelEl
        .text()
        .replace(/[:\s]+$/, '')
        .trim();
      // QDoc writes the label into the text (`<p><b>Note:</b> ...`): do not add a second one.
      const opening = aside.children().first();
      const labelled = (opening.is('p') ? opening.contents().first() : opening).is('b, strong');
      const lead =
        labelEl.length === 0 && (rule.unlabelled === 'quote' || labelled)
          ? ''
          : `<p>${tagged('strong', `${text === '' ? fallback : text}:`)}</p>`;
      labelEl.remove();
      aside.find('header, calcite-icon').remove();
      const body = rule.body === undefined ? aside : aside.find(rule.body).first();
      const html = (body.length > 0 ? body : aside).html() ?? '';
      aside.replaceWith(`<blockquote>${lead}${html}</blockquote>`);
    }
  }
};
