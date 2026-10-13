import { describe, expect, it } from 'vitest';
import { attribution } from '../../src/core/attribution.js';
import type { RenderMeta } from '../../src/core/ports.js';
import { pageProvenance } from '../../src/core/provenance.js';
import { FAKE_NOW_ISO, makeResponse } from '../support/builders.js';

const URL_WITH_FRAGMENT = 'https://developers.arcgis.com/widgets/api/Widget/#render';

describe('pageProvenance', () => {
  it('takes time, cache state and redirects from the response', () => {
    const res = makeResponse({
      fetchedAt: '2026-10-01T08:00:00.000Z',
      cache: 'stale',
      aliasChain: ['https://developers.arcgis.com/widgets/old/'],
    });
    const meta: RenderMeta = {
      url: URL_WITH_FRAGMENT,
      product: 'widgets-sdk',
      source: 'api',
      line: 'latest',
      version: '5.1',
      kind: 'api',
      license: 'esri-website-terms',
      res,
    };
    const provenance = pageProvenance(meta);
    expect(provenance).toEqual({
      ref: URL_WITH_FRAGMENT,
      url: 'https://developers.arcgis.com/widgets/api/Widget/',
      product: 'widgets-sdk',
      source: 'api',
      line: 'latest',
      version: '5.1',
      kind: 'api',
      license: 'esri-website-terms',
      attribution: attribution('esri-website-terms', {
        url: URL_WITH_FRAGMENT,
        retrievedAt: '2026-10-01T08:00:00.000Z',
        cache: 'stale',
      }),
      retrievedAt: '2026-10-01T08:00:00.000Z',
      cache: 'stale',
      redirectedFrom: ['https://developers.arcgis.com/widgets/old/'],
    });
    expect(provenance.attribution).toContain('(retrieved 2026-10-01, cached, stale)');
    // The page must not alias the response: one is cached, the other handed to presenters.
    expect(provenance.redirectedFrom).not.toBe(res.aliasChain);
  });

  it('describes content that was not fetched as a miss at the time the caller states', () => {
    const provenance = pageProvenance({
      url: 'brief:ai/overview',
      kind: 'brief',
      license: 'project',
      retrievedAt: FAKE_NOW_ISO,
    });
    expect(provenance).toEqual({
      ref: 'brief:ai/overview',
      url: 'brief:ai/overview',
      kind: 'brief',
      license: 'project',
      attribution: '',
      retrievedAt: FAKE_NOW_ISO,
      cache: 'miss',
      redirectedFrom: [],
    });
    expect(provenance).not.toHaveProperty('product');
    expect(provenance).not.toHaveProperty('version');
  });

  it('prefers an explicit retrieval time over the response and is empty without either', () => {
    const base = { url: URL_WITH_FRAGMENT, kind: 'api', license: 'unlicensed' } as const;
    expect(
      pageProvenance({ ...base, res: makeResponse(), retrievedAt: '2026-01-02T00:00:00.000Z' })
        .retrievedAt,
    ).toBe('2026-01-02T00:00:00.000Z');
    expect(pageProvenance(base).retrievedAt).toBe('');
  });

  it('names the package or specification where the licence tier asks for it', () => {
    const base = { url: URL_WITH_FRAGMENT, kind: 'api', retrievedAt: FAKE_NOW_ISO } as const;
    expect(
      pageProvenance({
        ...base,
        license: 'esri-ma',
        packageName: '@example/widgets',
        version: '5.1.0',
      }).attribution,
    ).toContain('From @example/widgets 5.1.0. ');
    expect(
      pageProvenance({ ...base, license: 'cc-by-nd', specName: 'Example Scene Spec' }).attribution,
    ).toMatch(/^Example Scene Spec, /);
  });
});
