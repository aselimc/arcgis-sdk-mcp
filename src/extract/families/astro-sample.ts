import type { Cheerio, CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import type { SourceFile } from '../../core/types.js';
import { NATIVE_SAMPLE_SOURCE } from '../detect-family.js';
import { normalizeLanguage } from '../dom.js';
import { stampOutline } from '../outline.js';
import { codeblockLabel } from '../passes/fix-expressive-code.js';
import type { FamilyProfile, PageView } from '../types.js';
import { dropAstroChrome } from './astro.js';
import { themeRoot, themeTitle } from './shared.js';

/** File name for a source block that has no caption. */
function defaultName(language: string, index: number): string {
  const extension = language === '' ? 'txt' : language;
  return index === 0 ? `index.${extension}` : `file-${index + 1}.${extension}`;
}

/** One Expressive Code block as a source file; the text is in the copy button's `data-code`. */
function fileOf(
  $: CheerioAPI,
  block: Cheerio<Element>,
  name: string,
  index: number,
  url: string,
): SourceFile {
  const language = block.find('pre[data-language]').first().attr('data-language') ?? 'html';
  const text = (block.find('button[data-code]').first().attr('data-code') ?? '')
    .replace(/\x7f/g, '\n')
    // Some sources are embedded with the byte order mark of the file they came from.
    .replace(/^\ufeff/, '');
  return {
    name: name === '' ? defaultName(language, index) : name,
    language: normalizeLanguage(language),
    text,
    ref: url,
    bytes: Buffer.byteLength(text, 'utf8'),
  };
}

/**
 * The complete sample source, detached from the page.
 *
 * - JavaScript samples keep it in a hidden `div.sample-code-source`, one Expressive Code
 *   block per file, named by its caption.
 * - Native SDK samples (Kotlin, Swift, .NET, Flutter, Qt) show it under a "Sample code"
 *   heading in a file switcher: one `div[data-codeblock]` per file, all but the first
 *   hidden, named by the `label` of that attribute. The heading goes with it, since nothing
 *   is left under it.
 */
function sourceFiles(page: PageView): SourceFile[] {
  const { $ } = page;
  const container = $('div.sample-code-source');
  const files = container
    .find('div.expressive-code')
    .map((index, block) =>
      fileOf(
        $,
        $(block),
        $(block).find('figcaption .title').first().text().trim(),
        index,
        page.url,
      ),
    )
    .get();
  container.remove();

  const switcher = page.root.find(NATIVE_SAMPLE_SOURCE).first();
  switcher.children('div[data-codeblock]').each((_, el) => {
    const block = $(el).find('div.expressive-code').first();
    if (block.length > 0) files.push(fileOf($, block, codeblockLabel($(el)), files.length, page.url));
  });
  if (switcher.length > 0) {
    switcher.prev('h2').remove();
    switcher.remove();
  }
  return files;
}

/**
 * Sample pages: the description converts like a guide; the source is returned in
 * `DocPage.files` and never repeated in the sections.
 */
export const astroSample: FamilyProfile = {
  id: 'astro-sample',
  defaultLanguage: '',
  root: themeRoot,
  title: themeTitle,
  outline: (page) => stampOutline(page),
  files: sourceFiles,
  prepare: dropAstroChrome,
};
