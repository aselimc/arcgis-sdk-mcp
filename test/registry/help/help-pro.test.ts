import { describe, expect, it } from 'vitest';
import {
  MAX_PRO_BOOKS_PER_SOURCE,
  proCatalog,
  proSourceBooks,
} from '../../../scripts/data/help-registry.pro.js';
import type { Entry, RulesFile } from '../../../scripts/data/help-registry.schema.js';
import { legacyHelpSource } from '../../../scripts/data/help-registry.sources.js';

type ProRules = RulesFile['pro'];
type SourceRule = ProRules['sources'][string];

/** An invented host in the layout of pro.arcgis.com: sections that are directories of books. */
function makeEntry(scripts: Record<string, unknown> = SCRIPTS): Entry {
  return {
    id: 'legacy-desk',
    name: 'ArcGIS Desk (previous versions)',
    host: 'pro.arcgis.com',
    base_url: 'https://pro.arcgis.com/en/desk/<version>/',
    url_slug: 'desk',
    search: { site: '', product: ['desk'] },
    other_versions_on_host: ['2.0', '1.0'],
    books: {
      '2.0': {
        api: ['api/main', 'api/functions', 'api/classes'],
        tools: ['tools/main', 'tools/analysis', 'tools/raster', 'tools/network'],
        start: ['start'],
      },
      toc_scripts: scripts,
    },
    status: 'migrated',
    scope: 'versioned-on-demand',
  };
}

const SCRIPTS: Record<string, unknown> = {
  'api/main': 10,
  'api/functions': 11,
  'api/classes': 12,
  'tools/main': 20,
  'tools/analysis': 21,
  'tools/raster': 22,
  'tools/network': 23,
  start: 30,
};

function makeRules(sources: Record<string, Partial<SourceRule>>, complete: string[] = []): ProRules {
  return {
    product: 'desk',
    liveLines: ['2.0'],
    sources: Object.fromEntries(
      Object.entries(sources).map(([target, rule]) => [
        target,
        { title: target, sections: [], books: [], probeBook: 'api/functions', ...rule },
      ]),
    ),
    completeSections: complete,
    docfxExcludedBooks: [],
  };
}

function booksOf(rules: ProRules, target: string): Array<{ path: string; toc_script?: unknown }> {
  const entry = makeEntry();
  return proSourceBooks(entry, proCatalog(entry, '2.0'), rules).get(target) ?? [];
}

describe('proCatalog', () => {
  it('reads the books of one release and the script id of each', () => {
    const catalog = proCatalog(makeEntry(), '2.0');
    expect(catalog.books).toEqual([
      'api/main',
      'api/functions',
      'api/classes',
      'tools/main',
      'tools/analysis',
      'tools/raster',
      'tools/network',
      'start',
    ]);
    expect(catalog.scripts['tools/raster']).toBe(22);
  });

  it('fails for a release the research did not sample and for a missing or malformed id map', () => {
    expect(() => proCatalog(makeEntry(), '9.9')).toThrow(/no books at version 9.9/);
    const withoutIds = makeEntry();
    if (!Array.isArray(withoutIds.books)) delete withoutIds.books.toc_scripts;
    expect(() => proCatalog(withoutIds, '2.0')).toThrow(/toc_scripts is missing/);
    expect(() => proCatalog(makeEntry({ 'api/main': '10' }), '2.0')).toThrow(/not a script id/);
  });
});

describe('proSourceBooks', () => {
  it('lists a section through its main book and every other book by its own script', () => {
    const rules = makeRules({ 'dev/legacy': { sections: ['api'], books: 'rest' } });
    expect(booksOf(rules, 'dev/legacy')).toEqual([
      // `api/` publishes no listing of its own; its entry pages are in `api/main`.
      { path: 'api', toc_script: '/en/desk/{line}/api/main/10.js' },
      { path: 'api/functions', toc_script: '/en/desk/{line}/api/functions/11.js' },
      { path: 'api/classes', toc_script: '/en/desk/{line}/api/classes/12.js' },
    ]);
  });

  it('lists a section that is one book with that book own script', () => {
    const rules = makeRules({ 'desk/legacy': { sections: ['start'], probeBook: 'start' } });
    expect(booksOf(rules, 'desk/legacy')).toEqual([
      { path: 'start', toc_script: '/en/desk/{line}/start/30.js' },
    ]);
  });

  it('gives "rest" the books no other source lists', () => {
    const rules = makeRules(
      {
        'dev/tools': { sections: ['tools'], books: 'rest', probeBook: 'tools/analysis' },
        'dev/tools-extra': { books: ['tools/raster'], probeBook: 'tools/raster' },
      },
      ['tools'],
    );
    expect(booksOf(rules, 'dev/tools').map((book) => book.path)).toEqual([
      'tools',
      'tools/analysis',
      'tools/network',
    ]);
    expect(booksOf(rules, 'dev/tools-extra').map((book) => book.path)).toEqual(['tools/raster']);
  });

  it('rejects sections, books and probes the research does not list', () => {
    const run = (rules: ProRules): unknown => booksOf(rules, 'dev/legacy');
    expect(() => run(makeRules({ 'dev/legacy': { sections: ['nope'] } }))).toThrow(
      /no section "nope"/,
    );
    expect(() => run(makeRules({ 'dev/legacy': { books: ['api/nope'] } }))).toThrow(
      /no book "api\/nope"/,
    );
    expect(() =>
      run(makeRules({ 'dev/legacy': { books: ['api/classes'], probeBook: 'api/functions' } })),
    ).toThrow(/probes "api\/functions", which it does not list/);
  });

  it('rejects a book two sources list and a book of a complete section nobody lists', () => {
    const twice = makeRules({
      'dev/a': { books: ['api/functions'] },
      'dev/b': { books: ['api/functions'] },
    });
    expect(() => booksOf(twice, 'dev/a')).toThrow(/listed by dev\/a and dev\/b/);
    const forgotten = makeRules(
      { 'dev/tools': { sections: ['tools'], books: ['tools/analysis'], probeBook: 'tools' } },
      ['tools'],
    );
    expect(() => booksOf(forgotten, 'dev/tools')).toThrow(
      /no source lists tools\/raster, tools\/network/,
    );
    const unowned = makeRules({ 'dev/a': { books: ['api/functions'] } }, ['tools']);
    expect(() => booksOf(unowned, 'dev/a')).toThrow(/no source owns section "tools"/);
  });

  it('rejects a book without a script id: listing it would cost three requests, not one', () => {
    const entry = makeEntry({ ...SCRIPTS, 'api/classes': undefined });
    const scripts = Array.isArray(entry.books) ? {} : (entry.books.toc_scripts as object);
    delete (scripts as Record<string, unknown>)['api/classes'];
    const rules = makeRules({ 'dev/legacy': { sections: ['api'], books: 'rest' } });
    expect(() => proSourceBooks(entry, proCatalog(entry, '2.0'), rules)).toThrow(
      /book "api\/classes" has no table-of-contents script id/,
    );
  });

  it('rejects a source with more books than one index build can request', () => {
    const many = Array.from({ length: MAX_PRO_BOOKS_PER_SOURCE + 1 }, (_, i) => `tools/t${i}`);
    const entry = makeEntry(Object.fromEntries(many.map((path, i) => [path, 100 + i])));
    if (!Array.isArray(entry.books)) entry.books['2.0'] = { tools: many };
    const rules = makeRules({ 'dev/tools': { books: many, probeBook: 'tools/t0' } });
    expect(() => proSourceBooks(entry, proCatalog(entry, '2.0'), rules)).toThrow(
      /lists 28 books; an index build can request at most 27/,
    );
  });
});

describe('legacyHelpSource with a probe book', () => {
  it('probes the link list of a real book when the first book is a directory of books', () => {
    const entry = makeEntry();
    const source = legacyHelpSource({
      id: 'legacy',
      title: 'Desk reference, earlier versions',
      entry,
      books: [
        { path: 'api', toc_script: '/en/desk/{line}/api/main/10.js' },
        { path: 'api/functions', toc_script: '/en/desk/{line}/api/functions/11.js' },
      ],
      versions: ['2.0', '1.0'],
      liveVersions: ['2.0'],
      probeBook: 'api/functions',
    });
    expect(source.probe.url).toBe('https://pro.arcgis.com/en/desk/2.0/api/functions/flisting.htm');
    expect(source.config.books[0]).toEqual({
      path: 'api',
      tocScript: '/en/desk/{line}/api/main/10.js',
    });
    expect(source.lines).toEqual(['2.0', '1.0']);
    expect(source.config.lines).toEqual(['2.0']);
  });
});
