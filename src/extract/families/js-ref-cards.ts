/**
 * Member cards of the JavaScript API reference (`div.lumina-detail`). A card documents one
 * constructor, property, method, event or type definition; type-definition cards nest the
 * cards of their properties, so a card is always identified by its **own** header.
 */
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import type { MemberEntry } from '../../core/types.js';
import { escapeHtml, firstSentence, squash, tagged } from '../dom.js';

/** Selector of a member card. */
export const CARD = 'div.lumina-detail';
/** Marks a card that sits inside another card, so that it is known after slicing too. */
export const NESTED_ATTR = 'data-md-nested';

/** What a card says about its member. */
export interface Card {
  el: Element;
  /** Anchor id: the member name, `Constructor`, `event-<name>` or `Type-property`. */
  id: string;
  name: string;
  /** `Property`, `Method`, `Event`, `Constructor`, `Type definition`. */
  kind: string;
  /** `inherited`, `readonly`, `static`, `autocast`, `deprecated`. */
  chips: string[];
  type: string;
  signature: string;
  inheritedFrom: string;
  summary: string;
  nested: boolean;
}

function definition($: CheerioAPI, card: Cheerio<Element>, label: string): string {
  const term = card
    .children('dl')
    .children('dt')
    .filter((_, dt) => $(dt).text().trim() === label)
    .first();
  return squash(term.next('dd').text());
}

/** Reads one card. Call before the card's header is rewritten. */
export function readCard($: CheerioAPI, el: Element): Card {
  const card = $(el);
  const header = card.children('header').first();
  const heading = header.find('h3').first();
  const description = card.children('.lumina-description').clone();
  description.find('calcite-tooltip, dl, pre, .expressive-code, aside').remove();
  return {
    el,
    id: heading.attr('id') ?? '',
    name: squash(heading.find('span > span').first().text()) || squash(heading.text()),
    kind: squash(header.find('div > span').not('.chip').last().text()),
    chips: header
      .find('span.chip')
      .map((_, chip) => squash($(chip).text()))
      .get(),
    type: definition($, card, 'Type'),
    signature: definition($, card, 'Signature'),
    inheritedFrom: squash(card.children('.lumina-inherited').find('a').first().text()),
    summary: firstSentence(description.text()),
    nested: card.attr(NESTED_ATTR) !== undefined || card.parent().closest(CARD).length > 0,
  };
}

/** The card as a `MemberEntry`; a property's "signature" is its type. */
export function toMember(card: Card): MemberEntry {
  const signature = card.signature === '' ? card.type : card.signature;
  return {
    id: card.id,
    name: card.name,
    kind: card.kind.toLowerCase(),
    ...(signature === '' ? {} : { signature }),
    ...(card.summary === '' ? {} : { summary: card.summary }),
    ...(card.inheritedFrom === '' ? {} : { inheritedFrom: card.inheritedFrom }),
    ...(card.chips.includes('deprecated') ? { deprecated: true } : {}),
    ...(card.chips.includes('readonly') ? { readonly: true } : {}),
  };
}

/**
 * A compact member index (name, type or signature, flags, first sentence). It replaces the
 * page's own summary tables, whose cells are link-heavy and repeat every type URL.
 */
export function indexTable(cards: readonly Card[]): string {
  const rows = cards.map((card) => {
    const shape = card.signature === '' ? card.type : card.signature;
    return (
      `<tr><td>${tagged('code', card.id)}</td>` +
      `<td>${shape === '' ? '' : tagged('code', shape)}</td>` +
      `<td>${escapeHtml(card.chips.join(', '))}</td>` +
      `<td>${escapeHtml(card.summary)}</td></tr>`
    );
  });
  return (
    '<table><thead><tr><th>Name</th><th>Type / signature</th><th>Flags</th><th>Summary</th></tr></thead>' +
    `<tbody>${rows.join('')}</tbody></table>`
  );
}
