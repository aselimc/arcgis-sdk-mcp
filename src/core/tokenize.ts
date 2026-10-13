/**
 * The one tokenizer of the project. Index and query text go through the same function, so
 * `queryFeatures`, `query features` and `FeatureLayer.queryFeatures` all meet on shared terms.
 */

/** Runs of identifier characters; everything else separates words. */
const WORD = /[\p{L}\p{N}_]+/gu;

/**
 * Humps of a camelCase or PascalCase identifier: `3D`-style digit acronyms, upper-case
 * acronyms (`OGC`, `JSON`), capitalised or lower-case words, digit runs.
 */
const HUMP = /\d+\p{Lu}+(?!\p{Ll})|\p{Lu}+(?!\p{Ll})|\p{Lu}?\p{Ll}+|\p{Lu}|\d+/gu;

/**
 * Splits text into lower-case search terms.
 *
 * Text is split on everything that is not a letter, digit or underscore. Each word is
 * emitted whole, followed by its snake_case and camelCase / PascalCase parts when it has
 * more than one (single-character parts are dropped as noise).
 *
 * @example tokenize('FeatureLayer.queryFeatures')
 * // ['featurelayer', 'feature', 'layer', 'queryfeatures', 'query', 'features']
 * @example tokenize('SEARCH_CURSOR') // ['search_cursor', 'search', 'cursor']
 */
export function tokenize(text: string): string[] {
  const terms: string[] = [];
  for (const word of text.match(WORD) ?? []) {
    const whole = word.toLowerCase();
    terms.push(whole);
    const parts = word
      .split('_')
      .flatMap((piece) => piece.match(HUMP) ?? [])
      .map((part) => part.toLowerCase())
      .filter((part) => part.length > 1 && part !== whole);
    terms.push(...parts);
  }
  return terms;
}

/**
 * Removes `new`, call parentheses with their arguments, and angle-bracket generics, so
 * `new FeatureLayer().queryFeatures<T>(q)` becomes `FeatureLayer.queryFeatures`.
 */
function stripCallSyntax(input: string): string {
  let text = input.trim().replace(/^new\s+/, '');
  // Both nest (`Map<string, List<T>>`, `f(g(x))`), so peel innermost pairs until none are left.
  let previous: string;
  do {
    previous = text;
    text = text.replace(/\([^()]*\)|<[^<>]*>/g, '');
  } while (text !== previous);
  // An unbalanced opening parenthesis (a call cut short) drops everything after it.
  return text.replace(/\(.*$/s, '').trim();
}

/** `<arcgis-map>` or `<calcite-button />` written as an HTML tag. */
const HTML_TAG = /^<\s*([a-z][a-z0-9]*(?:-[a-z0-9]+)+)\s*\/?>$/i;

/**
 * Normalises a symbol as an agent would write it.
 *
 * Strips `new `, call parentheses and argument lists, generics, the legacy `esri/` module
 * prefix, the `@arcgis/core/` package prefix and a `.js` / `.d.ts` extension, then splits on
 * `.`, `#`, `::` and `/`.
 *
 * @returns `parts` in order (empty when nothing is left) and `simple`, the last part.
 * @example normalizeSymbol('new FeatureLayer().queryFeatures(q)')
 * // parts ['FeatureLayer', 'queryFeatures'], simple 'queryFeatures'
 * @example normalizeSymbol('esri/layers/FeatureLayer#queryFeatures')
 * // parts ['layers', 'FeatureLayer', 'queryFeatures'], simple 'queryFeatures'
 */
export function normalizeSymbol(input: string): { parts: string[]; simple: string } {
  const tag = HTML_TAG.exec(input.trim());
  const text = (tag?.[1] ?? stripCallSyntax(input))
    .replace(/\.(?:d\.ts|js|mjs)$/i, '')
    .replace(/^@arcgis\/core\//i, '')
    .replace(/^esri\//i, '');
  const parts = text
    .split(/::|[.#/]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return { parts, simple: parts.at(-1) ?? '' };
}

/**
 * True when a query looks like an API name rather than a description, so that search tries
 * the symbol index first. A single token qualifies when it is qualified (`a.b`, `A#b`,
 * `A::b`), a call (`foo()`, `new Foo`), camelCase or PascalCase with at least two humps,
 * snake_case, a REST operation path (`/applyEdits`), or a custom-element tag
 * (`arcgis-map`, `calcite-button`, `<arcgis-map>`). Anything with spaces, and plain numbers
 * such as `5.1`, is not.
 */
export function isSymbolShaped(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed === '') return false;
  if (HTML_TAG.test(trimmed)) return true;

  const text = stripCallSyntax(trimmed);
  if (text === '' || /\s/.test(text)) return false;
  // Version numbers and other digit-led tokens contain dots but name nothing.
  if (/^[\d.]+$/.test(text) || !/^[@/\p{L}_$]/u.test(text)) return false;
  if (!/^[\p{L}\p{N}_$@/.#:-]+$/u.test(text)) return false;

  // A parenthesis or generic directly after a name is call syntax; "buffer (geodesic)" is prose.
  const calledOrConstructed =
    /[\p{L}\p{N}_$>][(<]/u.test(trimmed) || /^new\s+\p{Lu}/u.test(trimmed);
  const qualified = /[\p{L}\p{N}_$](?:\.|#|::)[\p{L}_$]/u.test(text);
  const restOperation = /^\/[\p{L}_]/u.test(text);
  const customElement = /^(?:arcgis|calcite)-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text);
  const snakeCase = /^[\p{L}\p{N}]+(?:_[\p{L}\p{N}]+)+$/u.test(text);
  const camelCase = /^[\p{L}\p{N}_$]+$/u.test(text) && /[\p{Ll}\p{N}]\p{Lu}/u.test(text);
  return (
    calledOrConstructed || qualified || restOperation || customElement || snakeCase || camelCase
  );
}
