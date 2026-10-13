/**
 * The HTML extraction package: turns a fetched HTML page of any supported family into a
 * `DocPage`. Pure and synchronous; it performs no I/O and holds no state between calls.
 */
import type { CreateHtmlExtractor } from '../core/factories.js';
import { detectFamily } from './detect-family.js';
import { extractPage } from './extract-page.js';
import { detectMetaRefresh } from './meta-refresh.js';
import { createMarkdownConverter } from './turndown.js';

export { detectFamily } from './detect-family.js';
export { detectMetaRefresh } from './meta-refresh.js';

/**
 * Creates the HTML extractor. The renderer delegates `'html'` input to `extract`; the HTTP
 * client is given `detectMetaRefresh` to follow stub pages.
 */
export const createHtmlExtractor: CreateHtmlExtractor = () => {
  const convert = createMarkdownConverter();
  return {
    extract: (input, meta, opts) => extractPage(convert, input, meta, opts),
    detectFamily,
    detectMetaRefresh,
  };
};
