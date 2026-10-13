import { describe, expect, it } from 'vitest';
import {
  KB_SITEMAP_URL,
  deprecationNotices,
  listDeprecations,
  noticeConcerns,
  noticesFromUrls,
} from '../../src/versions/deprecations.js';
import { SITES } from './cassettes-sites.js';
import { javaProduct, jsProduct } from './products.js';
import { makeProduct } from '../support/builders.js';
import { DAY, HOUR } from '../support/fake-clock.js';
import { makeCall, makeCtx } from '../support/make-ctx.js';

const KB = 'https://support.esri.com/en-us/knowledge-base';

describe('noticesFromUrls', () => {
  it('keeps the formal notices and derives a title from the slug', () => {
    const notices = noticesFromUrls([
      `${KB}/how-to-do-something-unrelated-000012345`,
      `${KB}/deprecation-arcgis-geoevent-server-000041462`,
      `${KB}/deprecation-notice-arcgis-runtime-sdk-for-android-and-a-000030115`,
      `${KB}/problem-deprecated-function-warning-000055555`,
      `${KB}/deprecation-000099999`,
    ]);
    expect(notices).toEqual([
      {
        subject: 'arcgis-geoevent-server',
        title: 'Deprecation: Arcgis geoevent server',
        url: `${KB}/deprecation-arcgis-geoevent-server-000041462`,
        truncated: false,
      },
      {
        subject: 'arcgis-runtime-sdk-for-android-and-a',
        title: 'Deprecation: Arcgis runtime sdk for android and a',
        url: `${KB}/deprecation-notice-arcgis-runtime-sdk-for-android-and-a-000030115`,
        truncated: true,
      },
    ]);
  });
});

describe('noticeConcerns', () => {
  const notice = (subject: string) => {
    const [found] = noticesFromUrls([`${KB}/deprecation-${subject}-000012345`]);
    if (found === undefined) throw new Error(`not a notice slug: ${subject}`);
    return found;
  };

  it('matches a product by its name on word boundaries', () => {
    const widgets = notice('widgets-in-arcgis-maps-sdk-for-javascript');
    expect(noticeConcerns(widgets, jsProduct)).toBe(true);
    // "for-java" is a prefix of "for-javascript", not the same product.
    expect(noticeConcerns(widgets, javaProduct)).toBe(false);
    expect(noticeConcerns(notice('arcgis-maps-sdk-for-java'), javaProduct)).toBe(true);
    expect(noticeConcerns(notice('arcgis-maps-sdk-for-java'), jsProduct)).toBe(false);
  });

  it('never matches on short aliases', () => {
    const product = makeProduct({ name: 'Widgets SDK', aliases: ['js', 'net'] });
    expect(noticeConcerns(notice('arcgis-maps-sdk-for-net'), product)).toBe(false);
  });

  it('matches a slug that was cut off inside the product name', () => {
    const product = makeProduct({
      name: 'ArcGIS Experience Builder branch version management',
      aliases: [],
    });
    expect(noticeConcerns(notice('arcgis-experience-builder-branch-version-ma'), product)).toBe(
      true,
    );
    expect(noticeConcerns(notice('arcgis-experience'), product)).toBe(false);
  });
});

describe('listDeprecations', () => {
  it('reads the Knowledge Base sitemap once a day', async () => {
    const ctx = makeCtx({ cassette: SITES });
    expect(await listDeprecations(ctx, makeCall(ctx))).toHaveLength(4);
    ctx.clock.advance(23 * HOUR);
    await listDeprecations(ctx, makeCall(ctx));
    expect(ctx.http.count(KB_SITEMAP_URL)).toBe(1);
    ctx.clock.advance(DAY);
    await listDeprecations(ctx, makeCall(ctx));
    expect(ctx.http.count(KB_SITEMAP_URL)).toBe(2);
    expect(ctx.http.requests[0]).toMatchObject({ expect: 'xml' });
  });
});

describe('deprecationNotices', () => {
  it('returns the notices of one product as title and ref', async () => {
    const ctx = makeCtx({ cassette: SITES });
    expect(await deprecationNotices(ctx, jsProduct, makeCall(ctx))).toEqual([
      `Deprecation: Widgets in arcgis maps sdk for javascript (${KB}/deprecation-widgets-in-arcgis-maps-sdk-for-javascript-000040437)`,
    ]);
    expect(await deprecationNotices(ctx, javaProduct, undefined)).toEqual([
      `Deprecation: Arcgis maps sdk for java (${KB}/deprecation-arcgis-maps-sdk-for-java-000032164)`,
    ]);
  });

  it('reads nothing with the website capability off', async () => {
    const ctx = makeCtx({
      cassette: SITES,
      config: { capabilities: new Set(['registries'] as const) },
    });
    expect(await deprecationNotices(ctx, jsProduct, undefined)).toEqual([]);
    expect(ctx.http.count()).toBe(0);
  });

  it('rejects with the upstream error, which the report turns into a missing extra', async () => {
    const ctx = makeCtx({ cassette: SITES });
    ctx.http.fail(KB_SITEMAP_URL, 503);
    await expect(deprecationNotices(ctx, jsProduct, undefined)).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
    });
  });
});
