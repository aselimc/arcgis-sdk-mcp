/**
 * `symbols: 'glossary'`: the developer glossary. One static query holds every term:
 *
 * ```
 * { "uid": "glossary-feature-subtype", "name": "feature subtype", "aliases": ["subtype"],
 *   "url": "/DEVSITE/documentation/glossary/feature-subtype/", "shortDef": "<p>…</p>" }
 * ```
 *
 * Each term becomes a `term` symbol on its glossary page, findable by name and by alias.
 */
import { isObject, textOf } from './shape.js';
import { resolveSiteUrl } from './site.js';
import { plainText } from './store.js';
import type { SymbolEntry, SymbolInput } from './symbols.js';

/** Glossary terms as symbols. Terms without a name or URL are skipped. */
export function glossarySymbols(input: SymbolInput): SymbolEntry[] {
  const entries: SymbolEntry[] = [];
  const seen = new Set<string>();
  for (const term of input.index.glossaryTerms) {
    if (!isObject(term)) continue;
    const name = textOf(term.name);
    const url = resolveSiteUrl(input.site, term.url);
    if (name === '' || url === undefined || seen.has(url)) continue;
    seen.add(url);
    const description = plainText(term.shortDef);
    const aliases = Array.isArray(term.aliases)
      ? term.aliases.filter((alias): alias is string => typeof alias === 'string' && alias !== '')
      : [];
    entries.push({
      url,
      symbol: name,
      symbolKind: 'term',
      title: name,
      kind: 'guide',
      crumbs: ['Glossary'],
      ...(description === undefined ? {} : { description }),
      ...(aliases.length === 0 ? {} : { keywords: aliases }),
    });
  }
  return entries;
}
