import type { Cheerio, CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { isElement, replaceWithPre, tagged } from '../dom.js';
import type { Pass } from '../types.js';

/** Expressive Code stores the source in `button[data-code]` with this character as newline. */
const LINE_SEPARATOR = /\x7f/g;

/** Comment syntax for the "N collapsed lines" marker of focused mode; `%s` is the label. */
const ELISION: Readonly<Record<string, string>> = {
  html: '<!-- \u2026 %s \u2026 -->',
  xml: '<!-- \u2026 %s \u2026 -->',
  css: '/* \u2026 %s \u2026 */',
  python: '# \u2026 %s \u2026',
  py: '# \u2026 %s \u2026',
  bash: '# \u2026 %s \u2026',
  sh: '# \u2026 %s \u2026',
  yaml: '# \u2026 %s \u2026',
};
const DEFAULT_ELISION = '// \u2026 %s \u2026';

const lineText = ($: CheerioAPI, line: Element): string =>
  $(line).find('.code').text().replace(/\n$/, '');

/** Only the lines the page shows expanded; each collapsed run becomes one comment line. */
function focusedCode($: CheerioAPI, block: Cheerio<Element>, language: string): string {
  const template = ELISION[language] ?? DEFAULT_ELISION;
  const lines: string[] = [];
  block
    .find('pre > code')
    .children()
    .each((_, child) => {
      if (!isElement(child)) return;
      if (child.tagName === 'details') {
        lines.push(template.replace('%s', $(child).children('summary').text().trim()));
      } else lines.push(lineText($, child));
    });
  return lines.join('\n');
}

/** The rendered lines, without the "N collapsed lines" summary rows. */
function renderedCode($: CheerioAPI, block: Cheerio<Element>): string {
  return block
    .find('.ec-line')
    .filter((_, line) => $(line).closest('summary').length === 0)
    .map((_, line) => lineText($, line))
    .get()
    .join('\n');
}

/**
 * The name of a block that is one of several variants of a code switcher (the files of a
 * sample, the languages of a snippet): the `label` of its `data-codeblock` JSON. A block
 * that stands alone has nothing to be told apart from and gets no label.
 */
function variantLabel(wrapper: Cheerio<Element>): string {
  if (wrapper.length === 0 || wrapper.siblings('[data-codeblock]').length === 0) return '';
  try {
    const data: unknown = JSON.parse(wrapper.attr('data-codeblock') ?? '');
    const label = typeof data === 'object' && data !== null && 'label' in data ? data.label : '';
    return typeof label === 'string' ? label.trim() : '';
  } catch {
    return '';
  }
}

/**
 * Expressive Code blocks (Astro sites) become plain `<pre data-md-lang>`. The copy button's
 * `data-code` attribute is the source of truth: the rendered lines include summary rows for
 * collapsed regions and lose blank lines. Must run before buttons are removed.
 *
 * A block without a caption that is one variant of a switcher is titled with the variant's
 * label, which on a sample page is its file name.
 *
 * With `env.focusedCode`, a block with collapsed regions keeps only its expanded lines,
 * because tutorials repeat the whole file at every step.
 */
export const fixExpressiveCode: Pass = ($, env) => {
  // Read before any block is replaced: a replaced variant no longer counts as a sibling.
  const labels = new Map<Element, string>();
  $('div[data-codeblock]').each((_, el) => void labels.set(el, variantLabel($(el))));

  $('div.expressive-code').each((_, el) => {
    const block = $(el);
    const language = block.find('pre[data-language]').first().attr('data-language') ?? '';
    const caption = block.find('figcaption .title').first().text().trim();
    const raw = block.find('button[data-code]').first().attr('data-code');

    let code: string;
    if (env.focusedCode && block.find('details.ec-section').length > 0) {
      code = focusedCode($, block, language);
    } else if (raw !== undefined) code = raw.replace(LINE_SEPARATOR, '\n');
    else code = renderedCode($, block);

    // The block may sit in div[data-codeblock] together with a strip of CodePen links.
    const wrapper = block.closest('div[data-codeblock]');
    const target = wrapper.length > 0 ? wrapper : block;
    const title = caption === '' ? (labels.get(wrapper.get(0) ?? el) ?? '') : caption;
    if (title !== '') target.before(`<p>${tagged('em', title)}</p>`);
    replaceWithPre($, target, code, language);
  });
};
