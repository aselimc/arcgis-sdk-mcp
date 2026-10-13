import { describe, expect, it } from 'vitest';
import {
  FILTER_KEYS,
  FilterError,
  and,
  isValidFilterString,
  or,
  serializeFilter,
  term,
} from '../../../../src/services/search/esearch/filters.js';

const HOST = 'developers.arcgis.com';

/**
 * Every row of the grammar table in `gap-esearchapi-contract-and-coverage.md` section 2.2.
 * Rows that the backend answers correctly must serialise to exactly the tested string; rows
 * it misreads (zero or unfiltered results, HTTP 500) must be impossible to produce.
 */
describe('serializeFilter: rows the backend accepts', () => {
  it.each([
    ['exact term', term('product', 'api-kotlin'), 'product:api-kotlin'],
    [
      'value case is kept (matching is case-sensitive)',
      term('product', 'API-Kotlin'),
      'product:API-Kotlin',
    ],
    [
      'OR of two terms',
      or(term('product', 'api-swift'), term('product', 'api-kotlin')),
      'product:api-swift|product:api-kotlin',
    ],
    [
      'AND of two terms',
      and(term('product', 'api-kotlin'), term('version', '300')),
      'product:api-kotlin.version:300',
    ],
    [
      'a one-member group needs no parentheses',
      and(term('product', 'api-kotlin'), and(term('version', '300'))),
      'product:api-kotlin.version:300',
    ],
    [
      'OR group inside AND',
      and(or(term('product', 'api-kotlin'), term('product', 'api-swift')), term('version', '300')),
      '(product:api-kotlin|product:api-swift).version:300',
    ],
    [
      'AND groups inside OR',
      or(
        and(term('product', 'api-kotlin'), term('version', '300')),
        and(term('product', 'api-swift'), term('version', '300')),
      ),
      '(product:api-kotlin.version:300)|(product:api-swift.version:300)',
    ],
    ['literal space in a value', term('content_type', 'Guide Topic'), 'content_type:Guide Topic'],
    ['a dot in a value becomes %2E', term('version', '3.7'), 'version:3%2E7'],
    [
      'product and dotted version',
      and(term('product', 'api-python'), term('version', '2.4')),
      'product:api-python.version:2%2E4',
    ],
  ])('requiredfields: %s', (_name, node, expected) => {
    expect(serializeFilter(node, 'requiredfields')).toBe(expected);
    expect(isValidFilterString(expected)).toBe(true);
  });

  it.each([
    ['phrase prefix on a meta field', term('product', 'api-net'), 'product:api-net'],
    [
      'URL prefix with the host and encoded dots',
      term('Content-Location', `${HOST}/kotlin/api-reference`),
      'Content-Location:developers%2Earcgis%2Ecom/kotlin/api-reference',
    ],
    [
      'several URL prefixes',
      or(
        term('Content-Location', `${HOST}/kotlin/api-reference`),
        term('Content-Location', `${HOST}/swift/api-reference`),
      ),
      'Content-Location:developers%2Earcgis%2Ecom/kotlin/api-reference|Content-Location:developers%2Earcgis%2Ecom/swift/api-reference',
    ],
    [
      'OR group inside AND is allowed',
      and(or(term('product', 'a'), term('product', 'b')), term('version', '300')),
      '(product:a|product:b).version:300',
    ],
  ])('partialfields: %s', (_name, node, expected) => {
    expect(serializeFilter(node, 'partialfields')).toBe(expected);
    expect(isValidFilterString(expected)).toBe(true);
  });

  it('never leaves a raw dot inside a value', () => {
    const text = serializeFilter(
      and(term('product', 'arcgis-pro'), term('version', '3.7.1')),
      'requiredfields',
    );
    expect(text).toBe('product:arcgis-pro.version:3%2E7%2E1');
    // The only dots left are the AND operators between terms.
    expect(text.split('.').every((part) => /^[A-Za-z_-]+:[^.]+$/.test(part))).toBe(true);
  });

  it('accepts every documented meta-field key', () => {
    for (const key of FILTER_KEYS.filter((candidate) => candidate !== 'Content-Location')) {
      expect(serializeFilter(term(key, 'x'), 'requiredfields')).toBe(`${key}:x`);
    }
  });
});

describe('serializeFilter: rows that must be refused', () => {
  it.each([
    [
      'AND groups inside OR in partialfields (matches nothing)',
      or(
        and(term('product', 'api-kotlin'), term('version', '300')),
        term('Content-Location', `${HOST}/kotlin/api-reference`),
      ),
      'partialfields' as const,
    ],
    ['negation by key', term('-product', 'api-flutter'), 'requiredfields' as const],
    ['negation by value', term('product', '-api-flutter'), 'requiredfields' as const],
    [
      'a percent escape other than the generated %2E',
      term('content_type', 'Guide%20Topic'),
      'requiredfields' as const,
    ],
    ['a top-level document field', term('language', 'en'), 'requiredfields' as const],
    ['a key containing a colon', term('article:published_time', '2025'), 'partialfields' as const],
    ['a value containing a colon', term('published_at', '10:30'), 'partialfields' as const],
    ['a value with a parenthesis', term('product', '((product'), 'requiredfields' as const],
    ['a value with a pipe', term('product', 'a|b'), 'requiredfields' as const],
    ['a value with a control character', term('product', 'a\nb'), 'requiredfields' as const],
    ['an empty value', term('product', ''), 'requiredfields' as const],
    ['a padded value', term('product', ' api-kotlin'), 'requiredfields' as const],
    [
      'a URL prefix in requiredfields (HTTP 500)',
      term('Content-Location', `${HOST}/kotlin`),
      'requiredfields' as const,
    ],
    [
      'a URL prefix with a scheme',
      term('Content-Location', `https://${HOST}/kotlin`),
      'partialfields' as const,
    ],
    [
      'a URL prefix without its host',
      term('Content-Location', 'com/kotlin'),
      'partialfields' as const,
    ],
    [
      'an unanchored URL token',
      term('Content-Location', 'documentation'),
      'partialfields' as const,
    ],
    ['an empty group', and(), 'requiredfields' as const],
    ['an empty group inside a group', and(term('product', 'a'), or()), 'requiredfields' as const],
  ])('%s', (_name, node, param) => {
    expect(() => serializeFilter(node, param)).toThrow(FilterError);
  });
});

describe('isValidFilterString', () => {
  it.each([
    'product:api-kotlin',
    'product:api-kotlin.(version:300)',
    'product:api-kotlin|product:api-swift.version:300',
    '(product:api-kotlin.version:300)|(product:api-swift.version:300)',
    'content_type:Guide Topic',
  ])('accepts %s', (text) => {
    expect(isValidFilterString(text)).toBe(true);
  });

  it.each([
    ['the malformed filter that returns unfiltered results', '((product:'],
    ['a raw dot in a value', 'product:arcgis-pro.version:3.7'],
    ['negation', '-product:api-flutter'],
    ['negated group', '-(product:api-flutter)'],
    ['an unclosed group', '(product:a'],
    ['a stray closing parenthesis', 'product:a)'],
    ['a trailing operator', 'product:a.'],
    ['an empty group', '()'],
    ['a term without a value', 'product:'],
    ['a key with a colon', 'article:published_time:2025'],
    ['an empty string', ''],
  ])('rejects %s', (_name, text) => {
    expect(isValidFilterString(text)).toBe(false);
  });
});
