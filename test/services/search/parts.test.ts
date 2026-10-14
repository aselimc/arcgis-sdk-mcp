import { describe, expect, it } from 'vitest';
import { classifyQuery } from '../../../src/services/search/classify.js';
import {
  MAX_EXCERPT_CHARS,
  clip,
  excerptOf,
  plainText,
  stripHighlight,
} from '../../../src/services/search/excerpt.js';
import {
  BRIEF_WEIGHT,
  EXACT_TITLE_WEIGHT,
  LEGACY_WEIGHT,
  LINK_TIER_WEIGHT,
  OTHER_LINE_WEIGHT,
  WORKSPACE_WEIGHT,
  dedupe,
  multiplier,
  oneSlotPerPage,
  rerank,
  type RankContext,
} from '../../../src/services/search/rank.js';
import { SYNONYMS, synonymsOf } from '../../../src/services/search/synonyms.js';
import { indexNotes, scopeNote } from '../../../src/services/notes.js';
import { makeHit } from '../../support/builders.js';
import { aiAgents, arcObjects, jsSdk, kotlinSdk, linkProduct } from '../support/catalogue.js';

describe('classifyQuery', () => {
  it.each([
    ['FeatureLayer.queryFeatures', ['FeatureLayer.queryFeatures', 'queryFeatures']],
    ['new FeatureLayer()', ['FeatureLayer']],
    ['FeatureLayer#queryFeatures', ['FeatureLayer.queryFeatures', 'queryFeatures']],
    ['<arcgis-map>', ['arcgis-map']],
    ['arcpy.da.SearchCursor', ['arcpy.da.SearchCursor', 'SearchCursor']],
  ])('%s is a symbol', (query, names) => {
    expect(classifyQuery(query)).toEqual({ shape: 'symbol', names });
  });

  // Regression: "FeatureLayer queryFeatures" listed samples only; the member was not found.
  it.each([
    ['FeatureLayer queryFeatures', ['FeatureLayer.queryFeatures']],
    ['  MapView   goTo ', ['MapView.goTo']],
  ])('"%s" is a type and a member written with a space', (query, names) => {
    expect(classifyQuery(query)).toEqual({ shape: 'symbol', names });
  });

  it.each([
    'cluster points with popups',
    'offline',
    '5.1',
    '   ',
    'query layers',
    'Feature layers',
    'FeatureLayer query features',
    'display FeatureLayer',
  ])('"%s" is text', (query) => {
    expect(classifyQuery(query)).toEqual({ shape: 'text', names: [] });
  });
});

describe('synonyms', () => {
  it('expands in both directions between single words', () => {
    expect(synonymsOf('popup')).toEqual(['pop up', 'popups']);
    expect(synonymsOf('Popups')).toEqual(['popup', 'pop up']);
    expect(synonymsOf('upgrade')).toEqual(['migrate', 'migration']);
    expect(synonymsOf('zebra')).toEqual([]);
  });

  it('has only single-word keys, all lower-case', () => {
    for (const key of SYNONYMS.keys()) expect(key).toMatch(/^[a-z0-9]+$/);
  });
});

describe('plainText', () => {
  it('keeps link labels and drops emphasis, fence and block markers', () => {
    expect(plainText('See [the guide](https://example.org/a_(b)) and ![chart](c.png).')).toBe(
      'See the guide and chart.',
    );
    expect(plainText('**Note:** use *one* of these _words_.')).toBe(
      'Note: use one of these words.',
    );
    expect(plainText('## Heading\n> quoted\n- item\n2. step')).toBe('Heading\nquoted\nitem\nstep');
    expect(plainText('```python\nprint(1)\n```').trim()).toBe('print(1)');
  });

  it('leaves identifiers, inline code and arithmetic alone', () => {
    const text = 'Pass in_features and buffer_distance_or_field; `a_b` is 2 * 3 * 4.';
    expect(plainText(text)).toBe(text);
    expect(plainText('__init__ and **kwargs')).toBe('__init__ and **kwargs');
  });
});

describe('excerpts', () => {
  it('strips highlight markup and entities', () => {
    expect(
      stripHighlight('Call <b>applyEdits</b> on a &lt;layer&gt; &amp;  wait&nbsp;for it'),
    ).toBe('Call applyEdits on a <layer> & wait for it');
  });

  it('clips at a word boundary within the cap', () => {
    const long = 'word '.repeat(100);
    const clipped = clip(long);
    expect(clipped.length).toBeLessThanOrEqual(MAX_EXCERPT_CHARS);
    expect(clipped.endsWith('word…')).toBe(true);
    expect(clip('short  text\n here')).toBe('short text here');
    expect(clip('x'.repeat(300)).length).toBe(MAX_EXCERPT_CHARS);
  });

  it('turns nothing into nothing', () => {
    expect(excerptOf(undefined)).toBeUndefined();
    // Regression: a hit from the text of a page already read showed fence and emphasis
    // markers, and a description spent its 240 characters on one link's URL.
    expect(
      excerptOf('_Method_ ```ts refresh (gauge?: Gauge): Promise<TideSet> ``` Reloads a gauge.'),
    ).toBe('Method refresh (gauge?: Gauge): Promise<TideSet> Reloads a gauge.');
    expect(
      excerptOf(
        'Whether to update the [location](https://developers.arcgis.com/widgets/references/tide-popup/#location) when the [index](https://developers.arcgis.com/widgets/references/tide-popup/#index "Index") changes.',
      ),
    ).toBe('Whether to update the location when the index changes.');
    expect(excerptOf('   ')).toBeUndefined();
    expect(excerptOf(' a ')).toBe('a');
  });
});

describe('multipliers', () => {
  const context = (overrides: Partial<RankContext> = {}): RankContext => ({
    query: 'cluster points',
    versionGiven: false,
    lines: new Map([
      ['js-maps-sdk', 'latest'],
      ['kotlin-maps-sdk', 'latest'],
    ]),
    products: new Map(
      [jsSdk, kotlinSdk, arcObjects, linkProduct, aiAgents].map((product) => [product.id, product]),
    ),
    workspace: new Set(),
    ...overrides,
  });
  const hit = (overrides = {}) =>
    makeHit({ product: 'js-maps-sdk', title: 'Something', ...overrides });

  it('leaves an ordinary current-line hit alone', () => {
    expect(multiplier(hit(), context())).toBe(1);
    expect(multiplier(hit({ product: 'unknown-product' }), context())).toBe(1);
  });

  it('down-weights other version lines unless a version was asked for', () => {
    const lts = hit({ product: 'kotlin-maps-sdk', line: 'v200' });
    expect(multiplier(lts, context())).toBe(OTHER_LINE_WEIGHT);
    expect(multiplier(lts, context({ versionGiven: true }))).toBe(1);
    expect(multiplier(hit({ line: '' }), context())).toBe(1);
  });

  it('applies tier, status, workspace, exact-title and brief weights', () => {
    expect(multiplier(hit({ product: 'cityengine' }), context())).toBe(LINK_TIER_WEIGHT);
    expect(multiplier(hit({ product: 'arcobjects' }), context())).toBe(LEGACY_WEIGHT);
    expect(multiplier(hit(), context({ workspace: new Set(['js-maps-sdk']) }))).toBe(
      WORKSPACE_WEIGHT,
    );
    expect(multiplier(hit({ title: 'Cluster Points!' }), context())).toBe(EXACT_TITLE_WEIGHT);
    expect(multiplier(hit({ product: 'ai-agents', kind: 'brief' }), context())).toBe(BRIEF_WEIGHT);
    expect(multiplier(hit({ kind: 'brief' }), context())).toBe(1);
  });

  it('multiplies weights that apply together and re-sorts', () => {
    const ranked = rerank(
      [
        hit({ ref: 'https://developers.arcgis.com/a/', score: 1 }),
        hit({ ref: 'https://developers.arcgis.com/b/', score: 0.6, title: 'cluster points' }),
        hit({ ref: 'https://desktop.arcgis.com/c/', score: 2, product: 'arcobjects' }),
      ],
      context({ workspace: new Set(['js-maps-sdk']) }),
    );
    expect(ranked.map((entry) => entry.ref.slice(-3))).toEqual(['/b/', '/a/', '/c/']);
    expect(ranked[0]?.score).toBeCloseTo(0.6 * EXACT_TITLE_WEIGHT * WORKSPACE_WEIGHT);
  });

  it('de-duplicates on the canonical URL and keeps member anchors apart', () => {
    const kept = dedupe([
      hit({ ref: 'https://developers.arcgis.com/x/?utm_source=a' }),
      hit({ ref: 'https://developers.arcgis.com/x/' }),
      hit({ ref: 'https://developers.arcgis.com/x/#member' }),
      hit({ ref: 'brief:ai/overview' }),
      hit({ ref: 'brief:ai/overview' }),
    ]);
    expect(kept.map((entry) => entry.ref)).toEqual([
      'https://developers.arcgis.com/x/?utm_source=a',
      'https://developers.arcgis.com/x/#member',
      'brief:ai/overview',
    ]);
  });

  // Regression: a web component listed by the site reference and by its Custom Elements
  // Manifest was reported under whichever of the two ranked higher (js-maps-sdk/core or
  // js-maps-sdk/components), so one page changed source from one query to the next.
  it('reports a page listed by two sources of a product under the primary one', () => {
    const page =
      'https://developers.arcgis.com/javascript/latest/references/map-components/arcgis-map/';
    const primary = (product: string, source: string, other: string): boolean =>
      product === 'js-maps-sdk' && source === 'components' && other === 'core';
    const coreFirst = dedupe(
      [
        hit({ ref: page, source: 'core', score: 3, title: 'Map' }),
        hit({ ref: 'https://developers.arcgis.com/other/', score: 2 }),
        hit({ ref: page, source: 'components', score: 1, title: 'arcgis-map' }),
      ],
      primary,
    );
    expect(coreFirst.map((entry) => [entry.ref, entry.source, entry.score])).toEqual([
      [page, 'components', 3],
      ['https://developers.arcgis.com/other/', 'guide', 2],
    ]);
    expect(coreFirst[0]?.title).toBe('arcgis-map');

    const componentsFirst = dedupe(
      [
        hit({ ref: page, source: 'components', score: 3 }),
        hit({ ref: page, source: 'core', score: 1 }),
      ],
      primary,
    );
    expect(componentsFirst.map((entry) => [entry.source, entry.score])).toEqual([
      ['components', 3],
    ]);

    // Without the relation, or across products, the best hit stays as it was.
    expect(
      dedupe([hit({ ref: page, source: 'core' }), hit({ ref: page, source: 'components' })]),
    ).toHaveLength(1);
    expect(
      dedupe(
        [
          hit({ ref: page, source: 'core' }),
          hit({ ref: page, product: 'other', source: 'components' }),
        ],
        primary,
      )[0]?.source,
    ).toBe('core');
  });

  // Regression: "add a feature layer to a map" listed the tutorial from the catalogue and,
  // further down, one of its sections from the body index.
  it('gives a page one place: body sections of a listed page are left out', () => {
    const page = 'https://developers.arcgis.com/x/tutorials/add-a-layer/';
    const kept = oneSlotPerPage([
      hit({ ref: page, match: 'title' }),
      hit({ ref: 'https://developers.arcgis.com/x/Layer/#visible', match: 'symbol' }),
      hit({ ref: `${page}#add-a-line-layer`, match: 'body' }),
      hit({ ref: 'https://developers.arcgis.com/x/Layer/#title', match: 'symbol' }),
      hit({ ref: 'https://developers.arcgis.com/x/other/#intro', match: 'body' }),
      hit({ ref: 'https://developers.arcgis.com/x/other/#steps', match: 'body' }),
    ]);
    expect(kept.map((entry) => entry.ref)).toEqual([
      page,
      'https://developers.arcgis.com/x/Layer/#visible',
      'https://developers.arcgis.com/x/Layer/#title',
      'https://developers.arcgis.com/x/other/#intro',
    ]);
  });
});

describe('notes', () => {
  const state = (
    source: string,
    value: 'ready' | 'stale' | 'building' | 'partial' | 'unavailable',
  ) => ({
    product: 'p',
    source,
    line: 'latest',
    state: value,
    records: 0,
  });

  it('describes every state that is not ready', () => {
    const notes = indexNotes(
      [
        state('a', 'ready'),
        state('b', 'building'),
        state('c', 'stale'),
        state('d', 'partial'),
        state('e', 'unavailable'),
        state('f', 'unavailable'),
      ],
      (_product, source) => (source === 'c' || source === 'e' ? 'timeout' : undefined),
    );
    expect(notes).toEqual([
      'not searched yet: p/b (index is building, retry)',
      'degraded: p/c answered from an older index snapshot: timeout',
      'degraded: p/d has no index, only its entry links were used',
      'not searched: p/e: timeout',
      'not searched: p/f (not available in this configuration)',
    ]);
  });

  it('summarises long lists', () => {
    const many = Array.from({ length: 7 }, (_, i) => state(`s${i}`, 'building'));
    const notes = indexNotes(many, () => undefined);
    expect(notes).toHaveLength(5);
    expect(notes.at(-1)).toBe('... and 3 more sources in the same state');
  });

  it('explains a scope the caller did not choose', () => {
    expect(scopeNote('argument', ['a'])).toBeUndefined();
    expect(scopeNote('none', [])).toBeUndefined();
    expect(scopeNote('workspace', ['a'])).toContain('detected in the project');
    expect(scopeNote('query', ['a'])).toContain('named by the query');
    expect(scopeNote('router', ['a', 'b'])).toContain('a, b (most likely products');
  });
});
