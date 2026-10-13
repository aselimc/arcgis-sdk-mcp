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

/** The button under a block whose server-rendered HTML holds only the first lines of the code. */
const EXPAND_BUTTON = 'calcite-button[data-component-link="Expand/Collapse Code Block"]';

/** Last line of a block that the page shows collapsed; the rest of the code is not in its HTML. */
export const COLLAPSED_MARK =
  '\u2026 (collapsed on the source page: the rest of this block is not in its HTML)';

/**
 * Gatsby code blocks (react-syntax-highlighter) become plain `<pre data-md-lang>`. The whole
 * `div.code-block` is replaced: besides the code it holds copy buttons and tooltips. Without
 * this pass every code line is preceded by its gutter number.
 *
 * A long block is rendered collapsed: the page's HTML holds its first lines and an "Expand"
 * button, and the rest arrives with a script. Such a block ends with {@link COLLAPSED_MARK}
 * and is counted, so that a request cut off in the middle of an object is not taken for the
 * whole example.
 */
export const fixGatsbyCode: Pass = ($, env) => {
  $('div.code-block').each((_, el) => {
    const pre = $(el).find('pre').first();
    if (pre.length === 0) return;
    stripGutter($, pre);
    const collapsed = $(el).find(EXPAND_BUTTON).length > 0;
    if (collapsed) env.counters.collapsedCode += 1;
    const code = collapsed ? `${pre.text().replace(/\s+$/, '')}\n${COLLAPSED_MARK}` : pre.text();
    replaceWithPre($, $(el), code, languageOf(pre));
  });
  // Highlighter blocks that are not wrapped in div.code-block.
  $('pre.syntax-highlighter').each((_, el) => {
    const pre = $(el);
    stripGutter($, pre);
    replaceWithPre($, pre, pre.text(), languageOf(pre));
  });
};
