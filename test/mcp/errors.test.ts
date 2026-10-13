import { describe, expect, it } from 'vitest';
import { ERROR_CODES, McpDocError, type ErrorDetails } from '../../src/core/errors.js';
import { TOOLS } from '../../src/core/names.js';
import { type ErrorSite, errorText, renderError } from '../../src/mcp/errors.js';
import { FakeClock } from '../support/fake-clock.js';
import { FakeLogger } from '../support/fake-logger.js';
import { firstText } from './support/harness.js';

const REPO = 'https://github.com/aselimc/arcgis-sdk-mcp';
const URL = 'https://developers.arcgis.com/javascript/latest/get-started-with-oauth/';

function deps(): { logger: FakeLogger; clock: FakeClock; repoUrl: string } {
  return { logger: new FakeLogger(), clock: new FakeClock(), repoUrl: REPO };
}

const READ: ErrorSite = { tool: TOOLS.read, args: { ref: URL, view: 'auto', cursor: 'abc' } };

function text(error: McpDocError, site: ErrorSite = READ): string {
  return errorText(error, site, deps(), 'ref123');
}

/** First line of every error: what, optional why, and a recovery, each a closed sentence. */
const SHAPE = /^Error \[([A-Z_]+)\]: [^\n]+\. Next: [^\n]+\.$/;

describe('errorText', () => {
  it.each(ERROR_CODES)('%s has a Next: recovery even without details', (code) => {
    const line = text(new McpDocError(code, 'Something failed')).split('\n')[0] ?? '';
    expect(line).toMatch(SHAPE);
    expect(SHAPE.exec(line)?.[1]).toBe(code);
  });

  it.each(ERROR_CODES)('%s prints the recovery the thrower supplied', (code) => {
    const rendered = text(
      new McpDocError(code, 'Something failed.', { why: 'Because.', next: 'Do the exact thing.' }),
    );
    expect(rendered).toMatch(SHAPE);
    expect(rendered).toContain('Next: Do the exact thing.');
    expect(rendered).not.toContain('..');
  });

  it('follows the format of the design: what, why, Next', () => {
    expect(
      text(
        new McpDocError('DOC_NOT_FOUND', 'The page does not exist', {
          why: 'The host answered 404',
          url: URL,
        }),
      ),
    ).toBe(
      'Error [DOC_NOT_FOUND]: The page does not exist. The host answered 404. Next: arcgis_docs_search({"query":"Get started with oauth"}).',
    );
  });

  const cases: Array<[McpDocError['code'], ErrorDetails, ErrorSite, string]> = [
    [
      'UNKNOWN_PRODUCT',
      {},
      { tool: TOOLS.search, args: { query: 'x', product: 'javscript' } },
      'Next: arcgis_docs_list_products({"query":"javscript","limit":8}).',
    ],
    [
      'UNKNOWN_PRODUCT',
      {},
      { tool: TOOLS.getVersions, args: {} },
      'Next: arcgis_docs_list_products({}).',
    ],
    [
      'SYMBOL_NOT_FOUND',
      {},
      { tool: TOOLS.lookupSymbol, args: { symbol: 'FeatreLayer', product: 'js-maps-sdk' } },
      'Next: arcgis_docs_search({"query":"FeatreLayer","product":"js-maps-sdk","kind":"api"}).',
    ],
    [
      'SYMBOL_NOT_FOUND',
      {},
      { tool: TOOLS.lookupSymbol, args: { symbol: 'X1' } },
      'Next: arcgis_docs_search({"query":"X1","kind":"api"}).',
    ],
    // Regression: the search tool rejects a query of one character, so a recovery built
    // from the symbol `x` was a call that could not be made.
    [
      'SYMBOL_NOT_FOUND',
      {},
      { tool: TOOLS.lookupSymbol, args: { symbol: 'x', product: 'js-maps-sdk' } },
      'Next: arcgis_docs_search({"query":"what you are looking for","product":"js-maps-sdk","kind":"api"}).',
    ],
    [
      'DOC_NOT_FOUND',
      {},
      { tool: TOOLS.read, args: { ref: 'brief:ai/no-such-brief' } },
      'Next: arcgis_docs_search({"query":"No such brief"}).',
    ],
    [
      'DOC_NOT_FOUND',
      {},
      { tool: TOOLS.read, args: { ref: 'https://developers.arcgis.com/' } },
      'Next: arcgis_docs_search({"query":"what you are looking for"}).',
    ],
    ['SECTION_NOT_FOUND', {}, READ, `Next: arcgis_docs_read({"ref":"${URL}","view":"outline"}).`],
    [
      'SECTION_NOT_FOUND',
      {},
      { tool: TOOLS.read, args: {} },
      'Next: arcgis_docs_read({"ref":"<ref>","view":"outline"}).',
    ],
    [
      'HOST_NOT_ALLOWED',
      { url: 'https://example.com/docs/map-view' },
      READ,
      'Next: Pass a URL on an Esri documentation host, or find one with arcgis_docs_search({"query":"Map view"}).',
    ],
    [
      'LINK_ONLY',
      { url: 'https://desktop.arcgis.com/en/arcmap/' },
      { tool: TOOLS.read, args: {} },
      'Next: This content is linked, not fetched: open https://desktop.arcgis.com/en/arcmap/ yourself; for the current documentation call arcgis_docs_list_products({}).',
    ],
    [
      'LINK_ONLY',
      {},
      { tool: TOOLS.search, args: { product: 'arcmap' } },
      'Next: This content is linked, not fetched; for the current documentation call arcgis_docs_list_products({"product":"arcmap"}).',
    ],
    [
      'SOURCE_DISABLED',
      { capability: 'site-search' },
      READ,
      'Next: Set ARCGIS_DOCS_SOURCES=+site-search and restart the server.',
    ],
    [
      'SOURCE_DISABLED',
      {},
      READ,
      'Next: Enable the source in ARCGIS_DOCS_SOURCES and restart the server.',
    ],
    [
      'VERSION_UNAVAILABLE',
      {},
      { tool: TOOLS.search, args: { product: 'js-maps-sdk', version: '9' } },
      'Next: arcgis_docs_get_versions({"product":"js-maps-sdk"}).',
    ],
    [
      'VERSION_UNAVAILABLE',
      {},
      { tool: TOOLS.search, args: {} },
      'Next: arcgis_docs_get_versions({}).',
    ],
    [
      'UPSTREAM_UNAVAILABLE',
      { host: 'developers.arcgis.com' },
      READ,
      'Next: developers.arcgis.com is temporarily unavailable; retry the same call once.',
    ],
    [
      'UPSTREAM_UNAVAILABLE',
      {},
      { tool: TOOLS.search, args: {} },
      'Next: The host is temporarily unavailable; retry the same call once.',
    ],
    ['UPSTREAM_BLOCKED', {}, READ, `Next: Do not retry; open ${URL} directly.`],
    [
      'UPSTREAM_BLOCKED',
      {},
      { tool: TOOLS.search, args: {} },
      'Next: Do not retry; the host refused the request.',
    ],
    [
      'RATE_LIMITED_GITHUB',
      {},
      READ,
      'Next: Set GITHUB_TOKEN to raise the GitHub quota, or retry after the quota resets.',
    ],
    ['CURSOR_EXPIRED', {}, READ, `Next: arcgis_docs_read({"ref":"${URL}","view":"auto"}).`],
    [
      'OFFLINE_MISS',
      {},
      READ,
      'Next: Unset ARCGIS_DOCS_OFFLINE and restart the server to allow network access.',
    ],
    [
      'INTERNAL',
      {},
      READ,
      `Next: Retry once; if it fails again, report ref ref123 at ${REPO}/issues.`,
    ],
  ];

  it.each(cases)(
    '%s falls back to a recovery built from the call (%#)',
    (code, details, site, next) => {
      expect(text(new McpDocError(code, 'Failed', details), site)).toContain(next);
    },
  );

  it('lists candidates after the recovery, capped per code', () => {
    const ids = Array.from({ length: 40 }, (_, index) => `id-${index}`);
    const cap = (code: McpDocError['code']): string =>
      text(new McpDocError(code, 'Failed', { candidates: ids })).split('\n')[1] ?? '';
    expect(cap('UNKNOWN_PRODUCT')).toBe('Nearest product ids: id-0, id-1, id-2, id-3, id-4');
    expect(cap('SYMBOL_NOT_FOUND')).toBe(
      'Nearest names (not verified; this does not prove the symbol does not exist): id-0, id-1, id-2, id-3, id-4',
    );
    expect(cap('SECTION_NOT_FOUND').split(', ')).toHaveLength(30);
    expect(cap('SECTION_NOT_FOUND').startsWith('Section ids: id-0, ')).toBe(true);
    expect(cap('VERSION_UNAVAILABLE').split(', ')).toHaveLength(12);
    expect(cap('HOST_NOT_ALLOWED').startsWith('Documentation hosts: ')).toBe(true);
    expect(cap('DOC_NOT_FOUND')).toBe('See also: id-0, id-1, id-2, id-3, id-4');
  });

  it('shows ambiguous symbols as complete calls, at most eight', () => {
    const pairs = Array.from({ length: 10 }, (_, index) =>
      JSON.stringify({ symbol: 'Graphic', product: `product-${index}` }),
    );
    const lines = text(
      new McpDocError('AMBIGUOUS_SYMBOL', 'Several symbols are named "Graphic"', {
        candidates: pairs,
      }),
      { tool: TOOLS.lookupSymbol, args: { symbol: 'Graphic' } },
    ).split('\n');
    expect(lines[0]).toBe(
      'Error [AMBIGUOUS_SYMBOL]: Several symbols are named "Graphic". Next: Repeat the lookup with one of the candidates below.',
    );
    expect(lines[1]).toBe('Candidates:');
    expect(lines[2]).toBe(
      '- arcgis_docs_lookup_symbol({"symbol":"Graphic","product":"product-0"})',
    );
    expect(lines).toHaveLength(2 + 8);
  });
});

describe('renderError', () => {
  it('returns an isError result and logs a catalogued failure at debug level only', () => {
    const d = deps();
    const result = renderError(new McpDocError('OFFLINE_MISS', 'Not cached'), READ, d);
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/^Error \[OFFLINE_MISS\]: Not cached\. Next: /);
    expect(d.logger.messages('error')).toEqual([]);
    expect(d.logger.entries[0]).toMatchObject({ level: 'debug', fields: { code: 'OFFLINE_MISS' } });
  });

  it('hides the message and stack of an unknown failure and logs them under the shown ref', () => {
    const d = deps();
    const failure = new TypeError('cannot read C:\\Users\\someone\\secret.json');
    const result = renderError(failure, READ, d);
    const shown = firstText(result);
    expect(result.isError).toBe(true);
    expect(shown).toMatch(
      /^Error \[INTERNAL\]: Internal error \(ref [0-9a-f]+\)\. Next: Retry once/,
    );
    expect(shown).not.toContain('secret');
    expect(shown).not.toContain('TypeError');
    expect(shown).not.toMatch(/\n\s+at /);
    const ref = /ref ([0-9a-f]+)/.exec(shown)?.[1];
    const entry = d.logger.entries.find((candidate) => candidate.level === 'error');
    expect(entry?.fields).toMatchObject({ ref, tool: TOOLS.read, message: failure.message });
    expect((entry?.fields as { stack?: string }).stack).toContain('TypeError');
  });

  it('accepts values that are not errors', () => {
    const result = renderError('just a string', READ, deps());
    expect(firstText(result)).toMatch(/^Error \[INTERNAL\]: Internal error \(ref /);
  });

  it('logs an INTERNAL McpDocError that carries no cause', () => {
    const d = deps();
    renderError(new McpDocError('INTERNAL', 'Invariant broken'), READ, d);
    expect(d.logger.entries[0]).toMatchObject({
      level: 'error',
      fields: { message: 'Invariant broken' },
    });
  });
});
