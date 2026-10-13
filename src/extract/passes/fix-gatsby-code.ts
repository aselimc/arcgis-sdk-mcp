import type { Cheerio, CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { replaceWithPre } from '../dom.js';
import type { Pass } from '../types.js';

/** Removes what react-syntax-highlighter adds around the code: hidden copies and line numbers. */
function stripGutter($: CheerioAPI, pre: Cheerio<Element>): void {
  pre.find('.react-syntax-highlighter-line-number, .linenumber').remove();
  pre
    .find('code[style]')
    .filter((_, code) => /display:\s*none/i.test($(code).attr('style') ?? ''))
    .remove();
}

function languageOf(pre: Cheerio<Element>): string {
  const declared = pre.attr('data-language');
  if (declared !== undefined) return declared;
  return /(?:^|\s)language-(\S+)/.exec(pre.find('code').first().attr('class') ?? '')?.[1] ?? '';
}

/**
 * Gatsby code blocks (react-syntax-highlighter) become plain `<pre data-md-lang>`. The whole
 * `div.code-block` is replaced: besides the code it holds copy buttons and tooltips. Without
 * this pass every code line is preceded by its gutter number.
 */
export const fixGatsbyCode: Pass = ($) => {
  $('div.code-block').each((_, el) => {
    const pre = $(el).find('pre').first();
    if (pre.length === 0) return;
    stripGutter($, pre);
    replaceWithPre($, $(el), pre.text(), languageOf(pre));
  });
  // Highlighter blocks that are not wrapped in div.code-block.
  $('pre.syntax-highlighter').each((_, el) => {
    const pre = $(el);
    stripGutter($, pre);
    replaceWithPre($, pre, pre.text(), languageOf(pre));
  });
};
