import { describe, expect, it } from 'vitest';
import { makeLine, makeProduct, makeSource } from '../../support/builders.js';
import {
  floorViolations,
  hostViolations,
  identityViolations,
  sourceViolations,
  wordingViolations,
} from './invariants.js';

/**
 * The invariant checks guard the data files, so each one is shown to fire on a product
 * that breaks it. A check that could not fail would make the data tests meaningless.
 */
describe('registry invariant checks', () => {
  it('accept a well-formed product', () => {
    const products = [makeProduct()];
    expect(floorViolations(products)).toEqual([]);
    expect(hostViolations(products)).toEqual([]);
    expect(sourceViolations(products)).toEqual([]);
    expect(identityViolations(products)).toEqual([]);
    expect(wordingViolations(products)).toEqual([]);
  });

  it('INV-1: report missing, duplicate and unsuitable floor sources', () => {
    const gatsby = { base: '/widgets/' };
    const none = makeProduct({ sources: [makeSource('gatsby', gatsby, { floor: false })] });
    const two = makeProduct({
      sources: [makeSource('gatsby', gatsby), makeSource('gatsby', gatsby, { id: 'second' })],
    });
    const wrongAdapter = makeProduct({ sources: [makeSource('sphinx', gatsby)] });
    const wrongCapability = makeProduct({
      sources: [makeSource('gatsby', gatsby, { capability: 'package-cdn' })],
    });
    const empty = makeProduct({ sources: [] });
    expect(floorViolations([none])).toEqual(['widgets-sdk: 0 floor sources']);
    expect(floorViolations([two])).toEqual(['widgets-sdk: 2 floor sources']);
    expect(floorViolations([wrongAdapter])).toEqual(['widgets-sdk/guide: floor adapter sphinx']);
    expect(floorViolations([wrongCapability])).toEqual([
      'widgets-sdk/guide: floor capability package-cdn',
    ]);
    expect(floorViolations([empty])).toEqual(['widgets-sdk: no sources but not retired']);
    expect(floorViolations([{ ...empty, status: 'retired' }])).toEqual([]);
  });

  it('INV-2: report unknown hosts, disallowed paths, plain http and foreign GitHub owners', () => {
    const check = (homepage: string): string[] => hostViolations([makeProduct({ homepage })]);
    expect(check('https://docs.example.com/widgets/')).toEqual([
      'widgets-sdk homepage: host not in HOSTS: https://docs.example.com/widgets/',
    ]);
    expect(check('https://support.esri.com/en-us/downloads/')).toEqual([
      'widgets-sdk homepage: path not allowed on support.esri.com: https://support.esri.com/en-us/downloads/',
    ]);
    expect(check('http://developers.arcgis.com/widgets/')[0]).toMatch(/not https/);
    expect(check('not a url')[0]).toMatch(/not a URL/);
    expect(check('https://github.com/someone-else/widgets')[0]).toMatch(/GitHub owner not allowed/);
    expect(check('https://github.com/Esri/widgets')).toEqual([]);
    expect(check('https://api.github.com/repos/koopjs/koop')).toEqual([]);

    const foreignRepo = makeProduct({
      sources: [
        makeSource('github-repo', { repo: 'someone-else/widgets', preset: 'markdown-docs' }),
      ],
    });
    expect(hostViolations([foreignRepo]).join('\n')).toMatch(/repo owner of someone-else\/widgets/);
  });

  it('INV-2: look at source bases, probes, oracles and start-here links too', () => {
    const product = makeProduct({
      sources: [
        makeSource(
          'gatsby',
          { base: 'https://a.example.com/' },
          { probe: { url: 'https://b.example.com/sitemap-0.xml', expect: 'xml' } },
        ),
      ],
      oracles: [
        {
          type: 'page-regex',
          options: { url: 'https://c.example.com/' },
          provides: ['documented'],
        },
      ],
      startHere: [
        { title: 'Start', ref: 'https://d.example.com/' },
        { title: 'Brief', ref: 'brief:widgets/overview' },
      ],
    });
    const hosts = hostViolations([product]).map(
      (violation) => /\/\/([a-d])\.example/.exec(violation)?.[1],
    );
    expect(hosts.sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('INV-3 and INV-5: report bad patterns, unknown lines, duplicate ids and hash-named URLs', () => {
    const gatsby = { base: '/widgets/' };
    const badPattern = makeProduct({
      sources: [makeSource('gatsby', { ...gatsby, exclude: ['^(unclosed/'] })],
    });
    const unknownLine = makeProduct({ sources: [makeSource('gatsby', gatsby, { lines: ['v9'] })] });
    const duplicate = makeProduct({
      sources: [makeSource('gatsby', gatsby), makeSource('gatsby', gatsby, { floor: false })],
    });
    const hashed = makeProduct({
      homepage: 'https://developers.arcgis.com/widgets/0123456789abcdef0123456789abcdef.store.json',
    });
    const unknownFallback = makeProduct({
      sources: [makeSource('gatsby', gatsby, { fallbacks: ['typings'] })],
    });
    const placeholder = makeProduct({
      lines: [makeLine()],
      sources: [
        makeSource('gatsby', gatsby, {
          probe: { url: 'https://developers.arcgis.com/{prefix}sitemap-0.xml', expect: 'xml' },
        }),
      ],
    });
    expect(sourceViolations([badPattern])[0]).toMatch(/pattern does not compile/);
    expect(sourceViolations([unknownLine])).toEqual(['widgets-sdk/guide: unknown line v9']);
    expect(sourceViolations([duplicate])).toEqual(['widgets-sdk: duplicate source id']);
    expect(sourceViolations([hashed])[0]).toMatch(/hash-named URL/);
    expect(sourceViolations([unknownFallback])).toEqual([
      'widgets-sdk/guide: unknown fallback typings',
    ]);
    expect(sourceViolations([placeholder])[0]).toMatch(/unexpanded placeholder/);
  });

  it('INV-4: report clashing names, missing or extra current lines and dangling references', () => {
    const first = makeProduct();
    const sameAlias = makeProduct({ id: 'gadgets-sdk', aliases: ['widgets'] });
    expect(identityViolations([first, sameAlias])).toEqual([
      '"widgets" is used by widgets-sdk and gadgets-sdk',
    ]);
    expect(identityViolations([first], new Set(['widgets']))).toEqual([
      '"widgets" of widgets-sdk is another product\'s id',
    ]);
    const noCurrent = makeProduct({ lines: [makeLine({ current: false })] });
    const twoCurrent = makeProduct({ lines: [makeLine(), makeLine({ id: 'v2' })] });
    expect(identityViolations([noCurrent])).toEqual(['widgets-sdk: 0 current lines']);
    expect(identityViolations([twoCurrent])).toEqual(['widgets-sdk: 2 current lines']);
    const dangling = makeProduct({ successor: 'gone', related: ['widgets-sdk', 'known'] });
    expect(identityViolations([dangling], new Set(['known']))).toEqual([
      'widgets-sdk: refers to itself',
      'widgets-sdk: unknown product gone',
    ]);
  });

  it('report wording over the limits', () => {
    const product = makeProduct({
      summary: 'x'.repeat(161),
      pitfalls: ['1', '2', '3', '4', '5'],
      verifiedOn: 'October 2026',
      keywords: [],
    });
    expect(wordingViolations([product])).toEqual([
      'widgets-sdk: summary over 160 characters',
      'widgets-sdk: more than four pitfalls',
      'widgets-sdk: verifiedOn',
      'widgets-sdk: no keywords',
    ]);
  });
});
