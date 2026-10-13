import { LANG_ATTR, normalizeLanguage } from '../dom.js';
import type { Pass } from '../types.js';

/** `lang-csharp`, `language-python`, `brush: js`, `highlight-json`. */
const PREFIXED = /(?:^|\s)(?:language-|lang-|highlight-|brush:\s*)([\w#+-]+)/i;
/** A bare class naming the language, as QDoc (`pre.cpp`) and old highlighters write it. */
const BARE =
  /(?:^|\s)(cpp|qml|python|csharp|java|kotlin|swift|dart|json|xml|html|js|ts|sql|bash|yaml)(?:\s|$)/i;

/**
 * Every remaining `<pre>` gets its fence language: from `data-language`, a `lang-x` /
 * `language-x` class on the `pre` or its `code`, a bare language class, else the family
 * default. `hljs` is a highlighter marker, not a language. `<br>` inside a `pre` is a newline.
 */
export const fixGenericPre: Pass = ($, env) => {
  $('pre').each((_, el) => {
    const pre = $(el);
    if (pre.attr(LANG_ATTR) !== undefined) return;
    pre.find('br').replaceWith('\n');
    const code = pre.find('code').first();
    const classes = `${pre.attr('class') ?? ''} ${code.attr('class') ?? ''}`;
    const declared =
      pre.attr('data-language') ??
      code.attr('data-language') ??
      PREFIXED.exec(classes)?.[1] ??
      BARE.exec(classes)?.[1];
    const language = normalizeLanguage(declared);
    pre.attr(LANG_ATTR, language === '' ? env.defaultLanguage : language);
  });
};
