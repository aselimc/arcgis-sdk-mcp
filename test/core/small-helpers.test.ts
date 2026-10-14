import { describe, expect, it } from 'vitest';
import { attribution, ESRI_TERMS_URL } from '../../src/core/attribution.js';
import { stepFence } from '../../src/core/fences.js';
import { sha256Hex, shortHash } from '../../src/core/hash.js';
import { TOOL_ORDER, TOOLS } from '../../src/core/names.js';
import { rrf } from '../../src/core/rrf.js';
import { levenshtein, nearest } from '../../src/core/text-distance.js';
import { LICENSE_TIERS, type SearchHit } from '../../src/core/types.js';
import { makeHit } from '../support/builders.js';

describe('hash', () => {
  it('produces the standard SHA-256 digest', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('shortHash is the stable 16-character prefix', () => {
    expect(shortHash('abc')).toBe('ba7816bf8f01cfea');
    expect(shortHash('abc')).toBe(shortHash('abc'));
    expect(shortHash('abd')).not.toBe(shortHash('abc'));
  });

  it('hashes non-ASCII text as UTF-8', () => {
    expect(sha256Hex('é')).toBe(sha256Hex(Buffer.from([0xc3, 0xa9]).toString('utf8')));
  });
});

describe('levenshtein', () => {
  it.each([
    ['kitten', 'sitting', 3],
    ['flaw', 'lawn', 2],
    ['same', 'same', 0],
    ['', 'abc', 3],
    ['abc', '', 3],
    ['queryFeatures', 'queryFeature', 1],
  ])('distance(%s, %s) = %i', (a, b, expected) => {
    expect(levenshtein(a, b, 10)).toBe(expected);
  });

  it('returns max + 1 as soon as the bound cannot hold', () => {
    expect(levenshtein('abcdef', 'uvwxyz', 2)).toBe(3);
    // Length difference alone exceeds the bound.
    expect(levenshtein('a', 'abcdefgh', 2)).toBe(3);
    // Distance 3 with bound 2, equal lengths, differences at the end.
    expect(levenshtein('abcxyz', 'abcuvw', 2)).toBe(3);
  });

  it('caps an in-bound row scan that ends over the bound', () => {
    expect(levenshtein('ab', 'ba', 1)).toBe(2);
  });
});

describe('nearest', () => {
  const ids = ['js-maps-sdk', 'kotlin-maps-sdk', 'swift-maps-sdk', 'arcpy', 'rest-api', 'rest-js'];

  it('ranks exact, prefix, substring, then edit distance', () => {
    expect(nearest('rest', ['unrest', 'rest-api', 'rest', 'rset'], 4)).toEqual([
      'rest',
      'rest-api',
      'unrest',
      'rset',
    ]);
  });

  it('suggests ids for a typo and ignores case', () => {
    expect(nearest('Kotlin-Map-SDK', ids, 2)[0]).toBe('kotlin-maps-sdk');
    expect(nearest('arcpi', ids, 1)).toEqual(['arcpy']);
  });

  it('leaves out candidates that are too far and honours n', () => {
    expect(nearest('zzzzzzzz', ids, 5)).toEqual([]);
    expect(nearest('maps', ids, 2)).toHaveLength(2);
  });

  it('returns nothing for empty input or n <= 0 and de-duplicates candidates', () => {
    expect(nearest('  ', ids, 3)).toEqual([]);
    expect(nearest('rest', ids, 0)).toEqual([]);
    expect(nearest('arcpy', ['arcpy', 'arcpy'], 5)).toEqual(['arcpy']);
  });
});

describe('rrf', () => {
  const a = makeHit({ ref: 'https://h/a', title: 'A', match: 'symbol' });
  const b = makeHit({ ref: 'https://h/b', title: 'B' });
  const c = makeHit({ ref: 'https://h/c', title: 'C' });

  it('sums reciprocal ranks across lists', () => {
    const fused = rrf([
      [a, b],
      [b, c],
    ]);
    expect(fused.map((hit) => hit.title)).toEqual(['B', 'A', 'C']);
    expect(fused[0]?.score).toBeCloseTo(1 / 62 + 1 / 61, 10);
    expect(fused[1]?.score).toBeCloseTo(1 / 61, 10);
  });

  it('keeps the first list’s copy and fills gaps from later ones', () => {
    const later = makeHit({
      ref: a.ref,
      title: 'A from body index',
      match: 'body',
      excerpt: 'An excerpt',
      breadcrumb: 'Guide > A',
      version: '5.1',
    });
    const [hit] = rrf([[a], [later]]);
    expect(hit).toMatchObject({
      title: 'A',
      match: 'symbol',
      excerpt: 'An excerpt',
      breadcrumb: 'Guide > A',
      version: '5.1',
    });
  });

  it('does not overwrite fields the first copy already has', () => {
    const first = makeHit({ ref: a.ref, excerpt: 'first', breadcrumb: 'one', version: '1' });
    const second = makeHit({ ref: a.ref, excerpt: 'second', breadcrumb: 'two', version: '2' });
    expect(rrf([[first], [second]])[0]).toMatchObject({
      excerpt: 'first',
      breadcrumb: 'one',
      version: '1',
    });
  });

  it('counts a ref once per list, keeps first-seen order on ties and leaves inputs alone', () => {
    const fused = rrf([[a, a, b]], 1);
    expect(fused.map((hit) => hit.title)).toEqual(['A', 'B']);
    expect(fused[1]?.score).toBeCloseTo(1 / 3, 10);
    expect(rrf([[a], [b]]).map((hit) => hit.title)).toEqual(['A', 'B']);
    expect(a.score).toBe(1);
    expect(rrf([])).toEqual([]);
  });

  it('takes the identity of a preferred copy and keeps score, match and excerpt', () => {
    const site = makeHit({ ref: a.ref, source: 'core', title: 'A', match: 'symbol', excerpt: 'x' });
    const twin = makeHit({ ref: a.ref, source: 'components', title: 'a-el', match: 'title' });
    const prefer = (candidate: SearchHit): boolean => candidate.source === 'components';

    // Within one list the copy does not vote twice, but still names the hit.
    const [same] = rrf([[site, twin, b]], 1, prefer);
    expect(same).toMatchObject({
      source: 'components',
      title: 'a-el',
      match: 'symbol',
      excerpt: 'x',
    });
    expect(same?.score).toBeCloseTo(1 / 2, 10);

    const [across] = rrf([[site], [twin]], 60, prefer);
    expect(across).toMatchObject({ source: 'components', match: 'symbol' });
    expect(across?.score).toBeCloseTo(2 / 61, 10);
    expect(site.source).toBe('core');

    expect(rrf([[site], [twin]])[0]?.source).toBe('core');
  });
});

describe('attribution', () => {
  const input = {
    url: 'https://developers.arcgis.com/widgets/get-started/',
    retrievedAt: '2026-10-13T12:00:00.000Z',
    cache: 'miss' as const,
  };

  it('writes the website line with retrieval date and cache state', () => {
    expect(attribution('esri-website-terms', input)).toBe(
      `Source: Esri, ${input.url} (retrieved 2026-10-13). Copyright (c) Esri. Use subject to Esri's terms: ${ESRI_TERMS_URL}`,
    );
    expect(attribution('esri-website-terms', { ...input, cache: 'hit' })).toContain(
      '(retrieved 2026-10-13, cached)',
    );
    expect(attribution('esri-website-terms', { ...input, cache: 'revalidated' })).toContain(
      '(retrieved 2026-10-13, cached)',
    );
    expect(attribution('esri-website-terms', { ...input, cache: 'stale' })).toContain(
      '(retrieved 2026-10-13, cached, stale)',
    );
  });

  it('writes the Apache line with the source URL', () => {
    const url = 'https://github.com/Esri/example/blob/main/README.md';
    expect(attribution('apache-2.0', { ...input, url })).toBe(
      `Copyright Esri. Licensed under the Apache License, Version 2.0. Source: ${url}`,
    );
  });

  it('writes the Master License Agreement line from the package or, failing that, the URL', () => {
    expect(
      attribution('esri-ma', { ...input, packageName: '@arcgis/core', version: '5.1.0' }),
    ).toBe(
      'From @arcgis/core 5.1.0. Copyright Esri. Licensed under the Esri Master License Agreement.',
    );
    expect(attribution('esri-ma', { ...input, packageName: '@arcgis/core' })).toContain(
      'From @arcgis/core. ',
    );
    expect(attribution('esri-ma', input)).toContain(`From ${input.url}. `);
  });

  it('writes the CC BY-ND and unlicensed lines', () => {
    expect(attribution('cc-by-nd', { ...input, specName: 'Example Spec' })).toBe(
      `Example Spec, Copyright Esri, CC BY-ND, ${input.url}`,
    );
    expect(attribution('cc-by-nd', input)).toContain('Esri specification, Copyright Esri');
    expect(attribution('unlicensed', input)).toBe(
      `Source: ${input.url}. Copyright Esri / respective authors.`,
    );
  });

  it('gives no line for project-authored content and one line for every other tier', () => {
    expect(attribution('project', input)).toBe('');
    for (const tier of LICENSE_TIERS.filter((candidate) => candidate !== 'project')) {
      const line = attribution(tier, input);
      expect(line, tier).toContain('Esri');
      expect(line, tier).not.toContain('\n');
    }
  });
});

describe('stepFence', () => {
  it('opens on a fence line and reports following lines as fenced', () => {
    expect(stepFence('text', undefined)).toEqual({ open: undefined, fenced: false });
    expect(stepFence('```ts', undefined)).toEqual({ open: '```', fenced: true });
    expect(stepFence('# not a heading', '```')).toEqual({ open: '```', fenced: true });
  });

  it('closes only on a matching bare fence of at least the same length', () => {
    expect(stepFence('```', '```').open).toBeUndefined();
    expect(stepFence('`````', '```').open).toBeUndefined();
    expect(stepFence('```', '````').open).toBe('````');
    expect(stepFence('~~~', '```').open).toBe('```');
    expect(stepFence('```js', '```').open).toBe('```');
    expect(stepFence('   ~~~~', '~~~').open).toBeUndefined();
  });

  it('ignores fences indented as code', () => {
    expect(stepFence('    ```', undefined)).toEqual({ open: undefined, fenced: false });
  });
});

describe('names', () => {
  it('lists the six tools in registration order with the shared prefix', () => {
    expect(TOOL_ORDER).toEqual([
      'arcgis_docs_list_products',
      'arcgis_docs_get_versions',
      'arcgis_docs_search',
      'arcgis_docs_read',
      'arcgis_docs_lookup_symbol',
      'arcgis_docs_find_samples',
    ]);
    expect(new Set(Object.values(TOOLS))).toEqual(new Set(TOOL_ORDER));
  });
});
