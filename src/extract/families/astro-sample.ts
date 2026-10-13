import { normalizeLanguage } from '../dom.js';
import { stampOutline } from '../outline.js';
import type { FamilyProfile, PageView } from '../types.js';
import type { SourceFile } from '../../core/types.js';
import { dropAstroChrome } from './astro.js';
import { themeRoot, themeTitle } from './shared.js';

/** File name for a source block that has no caption. */
function defaultName(language: string, index: number): string {
  const extension = language === '' ? 'txt' : language;
  return index === 0 ? `index.${extension}` : `file-${index + 1}.${extension}`;
}

/**
 * The complete sample source sits in a hidden `div.sample-code-source`, one Expressive Code
 * block per file, with the text in the copy button's `data-code` attribute.
 */
function sourceFiles(page: PageView): SourceFile[] {
  const { $ } = page;
  const container = $('div.sample-code-source');
  const files = container
    .find('div.expressive-code')
    .map((index, block): SourceFile => {
      const language = $(block).find('pre[data-language]').first().attr('data-language') ?? 'html';
      const text = ($(block).find('button[data-code]').first().attr('data-code') ?? '').replace(
        /\x7f/g,
        '\n',
      );
      const caption = $(block).find('figcaption .title').first().text().trim();
      return {
        name: caption === '' ? defaultName(language, index) : caption,
        language: normalizeLanguage(language),
        text,
        ref: page.url,
        bytes: Buffer.byteLength(text, 'utf8'),
      };
    })
    .get();
  container.remove();
  return files;
}

/**
 * JavaScript sample pages: the description converts like a guide; the source is returned in
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
