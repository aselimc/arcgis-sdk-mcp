import { describe, expect, it } from 'vitest';
import { createBodyIndex, MAX_BODY_SECTIONS } from '../../../src/services/index/body-index.js';
import { createHealthTracker, FAILING_SKIP_MS } from '../../../src/services/index/health.js';
import { buildCatalogIndex } from '../../../src/services/index/minisearch-index.js';
import { queryTerms } from '../../../src/services/index/query-terms.js';
import { kindMatches } from '../../../src/services/index/query.js';
import { buildSymbolMap, mergeSymbolMaps } from '../../../src/services/index/symbol-map.js';
import { makeDocPage, makeRecord } from '../../support/builders.js';
import { FakeClock } from '../../support/fake-clock.js';
import { makeCtx } from '../../support/make-ctx.js';
import { JS_RECORDS, KOTLIN_RECORDS, REST_RECORDS } from '../support/catalogue.js';

describe('queryTerms', () => {
  it('splits words, drops stop words and keeps camelCase parts', () => {
    expect(queryTerms('how to use queryFeatures with a FeatureLayer')).toEqual([
      { whole: 'use', parts: [], synonyms: [] },
      { whole: 'queryfeatures', parts: ['query', 'features'], synonyms: [] },
      { whole: 'featurelayer', parts: ['feature', 'layer'], synonyms: [] },
    ]);
  });

  it('keeps stop words when nothing else is left, and removes duplicates', () => {
    expect(queryTerms('how to').map((term) => term.whole)).toEqual(['how', 'to']);
    expect(queryTerms('map Map MAP').map((term) => term.whole)).toEqual(['map']);
    expect(queryTerms('  ')).toEqual([]);
  });

  it('attaches synonyms as word lists', () => {
    const synonyms = new Map([['popup', ['pop up', 'popups']]]);
    expect(queryTerms('popup', synonyms)[0]?.synonyms).toEqual([['pop', 'up'], ['popups']]);
  });
});

describe('catalogue index', () => {
  const index = buildCatalogIndex(JS_RECORDS);
  const titles = (text: string, mode: 'and' | 'or' | 'fuzzy' = 'and'): string[] =>
    index.search(queryTerms(text), mode).map((match) => match.record.title);

  it('ranks a title match above a description match', () => {
    expect(titles('cluster')[0]).toBe('Cluster points');
  });

  it('labels the best matching field', () => {
    const label = (text: string, title: string) =>
      index.search(queryTerms(text), 'and').find((match) => match.record.title === title)?.match;
    expect(label('queryFeatures', 'FeatureLayer.queryFeatures')).toBe('symbol');
    expect(label('points', 'Cluster points')).toBe('title');
    expect(label('pkce', 'Authentication')).toBe('heading');
    expect(label('identity', 'Authentication')).toBe('keyword');
    expect(label('earthquake', 'Point clustering sample')).toBe('description');
    expect(label('visualization', 'Cluster points')).toBe('keyword');
  });

  it('matches a camelCase name written as words, and the reverse', () => {
    expect(titles('query features')).toContain('FeatureLayer.queryFeatures');
    expect(titles('applyEdits')).toContain('Edit features');
  });

  it('needs every term in AND mode and any term in OR mode', () => {
    expect(titles('cluster zebra')).toEqual([]);
    expect(titles('cluster zebra', 'or')).toContain('Cluster points');
  });

  it('matches prefixes, and typos of longer words', () => {
    expect(titles('authent')).toContain('Authentication');
    expect(titles('authentcation')).toContain('Authentication');
    expect(titles('mpa')).not.toContain('MapView');
    expect(titles('edts', 'fuzzy')).toContain('Edit features');
  });

  it('applies the record filter and the record boost', () => {
    const only = index
      .search(queryTerms('feature'), 'and', (record) => record.kind === 'sample')
      .map((match) => match.record.kind);
    expect(new Set(only)).toEqual(new Set(['sample']));

    const boosted = buildCatalogIndex([
      makeRecord({ ref: 'https://developers.arcgis.com/widgets/a/', title: 'Widget basics' }),
      makeRecord({
        ref: 'https://developers.arcgis.com/widgets/b/',
        title: 'Widget basics',
        boost: 3,
      }),
    ]);
    expect(boosted.search(queryTerms('widget'), 'and')[0]?.record.ref).toMatch(/\/b\/$/);
    expect(index.search([], 'and')).toEqual([]);
  });

  it('counts named spec objects as API reference', () => {
    const spec = makeRecord({ kind: 'spec', symbol: 'operationalLayers' });
    expect(kindMatches(spec, 'api')).toBe(true);
    expect(kindMatches(makeRecord({ kind: 'spec' }), 'api')).toBe(false);
    expect(kindMatches(spec, 'guide')).toBe(false);
    expect(kindMatches(spec, undefined)).toBe(true);
  });
});

describe('symbol map', () => {
  const js = buildSymbolMap(JS_RECORDS);
  const names = (records: Array<{ qualified?: string }>): Array<string | undefined> =>
    records.map((record) => record.qualified);

  it('finds a qualified name exactly', () => {
    expect(names(js.exact('FeatureLayer.queryFeatures'))).toEqual(['FeatureLayer.queryFeatures']);
    expect(names(js.exact('rest.support.Query'))).toEqual(['rest.support.Query']);
  });

  it('finds a dotted suffix of a qualified name', () => {
    expect(names(js.exact('support.Query'))).toEqual(['rest.support.Query']);
    expect(js.exact('upport.Query')).toEqual([]);
  });

  it('finds a simple name, case-sensitively first', () => {
    expect(names(js.exact('goTo'))).toEqual(['MapView.goTo', 'SceneView.goTo']);
    expect(names(js.exact('Query'))).toEqual(['rest.support.Query']);
    expect(names(js.exact('goto'))).toEqual(['MapView.goTo', 'SceneView.goTo']);
    expect(names(js.exact('FEATURELAYER.QUERYFEATURES'))).toEqual(['FeatureLayer.queryFeatures']);
    expect(names(js.exact('SUPPORT.query'))).toEqual(['rest.support.Query']);
    expect(js.exact('nothingLikeThis')).toEqual([]);
  });

  it('lists the members of a type', () => {
    expect(js.members('FeatureLayer').map((record) => record.symbol)).toEqual([
      'queryFeatures',
      'applyEdits',
      'featureReduction',
    ]);
    expect(js.members('featurelayer')).toHaveLength(3);
    expect(js.members('Nope')).toEqual([]);
  });

  it('finds near names: prefixes first, then small edit distances, types before members', () => {
    expect(js.fuzzy('FeatureLaye', 3).map((record) => record.symbol)).toEqual([
      'FeatureLayer',
      'FeatureLayer',
    ]);
    expect(js.fuzzy('GraphicLayer', 1).map((record) => record.symbol)).toEqual(['GraphicsLayer']);
    expect(js.fuzzy('queryFeaturs', 1)[0]?.symbol).toBe('queryFeatures');
    expect(js.fuzzy('zzzzzz', 3)).toEqual([]);
    expect(js.fuzzy('', 3)).toEqual([]);
    expect(js.fuzzy('goTo', 0)).toEqual([]);
  });

  it('derives the simple name from the qualified one when a record has no symbol', () => {
    const map = buildSymbolMap([makeRecord({ qualified: 'arcpy.da.SearchCursor' }), makeRecord()]);
    expect(map.size()).toBe(1);
    expect(map.exact('SearchCursor')).toHaveLength(1);
  });

  it('merges several maps, keeping their order', () => {
    const merged = mergeSymbolMaps([
      buildSymbolMap(KOTLIN_RECORDS),
      js,
      buildSymbolMap(REST_RECORDS),
    ]);
    expect(merged.exact('FeatureLayer').map((record) => record.product)).toEqual([
      'kotlin-maps-sdk',
      'js-maps-sdk',
      'js-maps-sdk',
    ]);
    expect(merged.members('FeatureLayer')).toHaveLength(3);
    expect(merged.fuzzy('aplyEdits', 2).map((record) => record.product)).toEqual([
      'js-maps-sdk',
      'rest-api',
    ]);
    expect(merged.size()).toBe(js.size() + 2 + 5);
  });
});

describe('health tracker', () => {
  it('walks ok, degraded, failing and back', () => {
    const clock = new FakeClock();
    const health = createHealthTracker(clock);
    expect(health.get('p', 's')).toBeUndefined();
    expect(health.skip('p', 's')).toBe(false);

    health.ok('p', 's', 10, clock.now());
    expect(health.get('p', 's')).toMatchObject({ state: 'ok', records: 10, lastOk: clock.iso() });

    health.failed('p', 's', 'timeout');
    health.failed('p', 's', 'timeout');
    expect(health.get('p', 's')).toMatchObject({
      state: 'degraded',
      lastError: 'timeout',
      records: 10,
    });
    expect(health.skip('p', 's')).toBe(false);

    health.failed('p', 's', 'timeout');
    expect(health.get('p', 's')?.state).toBe('failing');
    expect(health.skip('p', 's')).toBe(true);
    health.degraded('p', 's', 'serving stale');
    expect(health.get('p', 's')).toMatchObject({ state: 'failing', stale: true });

    clock.advance(FAILING_SKIP_MS);
    expect(health.skip('p', 's')).toBe(false);
    health.ok('p', 's', 12, clock.now());
    expect(health.get('p', 's')?.state).toBe('ok');

    health.disabled('p', 's', 'capability off');
    expect(health.all()).toEqual([
      { product: 'p', source: 's', state: 'disabled', lastError: 'capability off' },
    ]);
  });

  it('keeps record counts when degrading without a new count', () => {
    const health = createHealthTracker(new FakeClock());
    health.degraded('p', 's', 'thin index', 3);
    expect(health.get('p', 's')).toMatchObject({ state: 'degraded', records: 3 });
  });
});

describe('body index', () => {
  const page = (url: string, markdown: string, overrides = {}) =>
    makeDocPage({ url, ref: url, markdown, ...overrides });
  const URL_A = 'https://developers.arcgis.com/widgets/a/';

  it('finds a section by its text and points at it', () => {
    const bodies = createBodyIndex(makeCtx());
    bodies.add(
      page(URL_A, '# Alpha\n\nIntro text.\n\n## Tuning\n\nSet the throttle interval carefully.'),
    );
    const [hit] = bodies.query({ text: 'throttle interval', products: ['widgets-sdk'], limit: 5 });
    expect(hit).toMatchObject({
      ref: `${URL_A}#tuning`,
      title: 'Alpha: Tuning',
      match: 'body',
      excerpt: 'Set the throttle interval carefully.',
      product: 'widgets-sdk',
    });
    expect(bodies.query({ text: 'intro', products: ['widgets-sdk'], limit: 5 })[0]?.ref).toBe(
      URL_A,
    );
    expect(bodies.query({ text: 'throttle', products: ['other'], limit: 5 })).toEqual([]);
    expect(
      bodies.query({ text: 'throttle', products: ['widgets-sdk'], kind: 'api', limit: 5 }),
    ).toEqual([]);
    expect(bodies.query({ text: '', products: ['widgets-sdk'], limit: 5 })).toEqual([]);
  });

  it('ignores pages without a product and link-only placeholders', () => {
    const bodies = createBodyIndex(makeCtx());
    const { product: _product, ...anonymous } = page(URL_A, '# A\n\nthrottle');
    bodies.add(anonymous);
    bodies.add(page(URL_A, '# A\n\nthrottle', { degraded: { level: 'link-only', reason: 'x' } }));
    bodies.add(page(URL_A, '', { sections: [] }));
    expect(bodies.size('widgets-sdk')).toBe(0);
  });

  it('indexes only the first 2,000 characters of a section', () => {
    const bodies = createBodyIndex(makeCtx());
    bodies.add(page(URL_A, `# A\n\n${'filler '.repeat(400)}needle`));
    expect(bodies.query({ text: 'needle', products: ['widgets-sdk'], limit: 5 })).toEqual([]);
    expect(bodies.query({ text: 'filler', products: ['widgets-sdk'], limit: 5 })).toHaveLength(1);
  });

  it('keeps earlier sections of a page when one section is read again', () => {
    const bodies = createBodyIndex(makeCtx());
    bodies.add(page(URL_A, '# A\n\nIntro.\n\n## One\n\nfirst words\n\n## Two\n\nsecond words'));
    bodies.add(page(URL_A, '## Two\n\nsecond words revised'));
    expect(bodies.size('widgets-sdk')).toBe(3);
    expect(bodies.query({ text: 'first', products: ['widgets-sdk'], limit: 5 })).toHaveLength(1);
    expect(bodies.query({ text: 'revised', products: ['widgets-sdk'], limit: 5 })).toHaveLength(1);
  });

  it('drops the least recently read pages beyond 3,000 sections', () => {
    const ctx = makeCtx();
    const bodies = createBodyIndex(ctx);
    const big = (name: string): string =>
      Array.from({ length: 1200 }, (_, i) => `## ${name} ${i}\n\n${name} body`).join('\n\n');
    for (const name of ['first', 'second', 'third']) {
      bodies.add(page(`https://developers.arcgis.com/widgets/${name}/`, big(name)));
      ctx.clock.advance(1000);
    }
    expect(bodies.size('widgets-sdk')).toBeLessThanOrEqual(MAX_BODY_SECTIONS);
    expect(bodies.query({ text: 'first', products: ['widgets-sdk'], limit: 5 })).toEqual([]);
    expect(
      bodies.query({ text: 'third', products: ['widgets-sdk'], limit: 5 }).length,
    ).toBeGreaterThan(0);
  });

  it('persists on flush and merges the stored index on load', async () => {
    const ctx = makeCtx();
    const first = createBodyIndex(ctx);
    first.add(page(URL_A, '# A\n\npersisted words'));
    await first.flush();
    await first.flush();
    expect(ctx.cache.writes.derived).toBe(1);

    const second = createBodyIndex(ctx);
    second.add(page('https://developers.arcgis.com/widgets/b/', '# B\n\nfresh words'));
    await second.load('widgets-sdk');
    await second.load('widgets-sdk');
    expect(second.query({ text: 'persisted', products: ['widgets-sdk'], limit: 5 })).toHaveLength(
      1,
    );
    expect(second.query({ text: 'fresh', products: ['widgets-sdk'], limit: 5 })).toHaveLength(1);
  });

  it('survives an unreadable or foreign cache entry', async () => {
    const ctx = makeCtx();
    await ctx.cache.putDerived('bodies', 'widgets-sdk', { v: 99, pages: [] });
    const bodies = createBodyIndex(ctx);
    await bodies.load('widgets-sdk');
    ctx.cache.getDerived = async () => {
      throw new Error('unreadable');
    };
    ctx.cache.putDerived = async () => {
      throw new Error('read-only');
    };
    await bodies.load('other-sdk');
    bodies.add(page(URL_A, '# A\n\nwords'));
    await bodies.flush();
    expect(ctx.logger.messages('warn')).toEqual([
      'body index could not be read',
      'body index could not be written',
    ]);
  });
});
