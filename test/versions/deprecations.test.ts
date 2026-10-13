import { describe, expect, it } from 'vitest';
import {
  KB_SITEMAP_URL,
  createNoticeMatcher,
  deprecationNotices,
  listDeprecations,
  noticeConcerns,
  noticeLine,
  noticesFromUrls,
  slugWords,
  titleOfArticle,
} from '../../src/versions/deprecations.js';
import { SITES } from './cassettes-sites.js';
import { javaProduct, jsProduct } from './products.js';
import { makeProduct } from '../support/builders.js';
import { DAY, HOUR } from '../support/fake-clock.js';
import { makeCall, makeCtx } from '../support/make-ctx.js';

const KB = 'https://support.esri.com/en-us/knowledge-base';

const notice = (subject: string) => {
  const [found] = noticesFromUrls([`${KB}/deprecation-${subject}-000012345`]);
  if (found === undefined) throw new Error(`not a notice slug: ${subject}`);
  return found;
};

describe('noticesFromUrls', () => {
  it('keeps the formal notices, without the prefix and the article id', () => {
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
        url: `${KB}/deprecation-arcgis-geoevent-server-000041462`,
        truncated: false,
      },
      {
        subject: 'arcgis-runtime-sdk-for-android-and-a',
        url: `${KB}/deprecation-notice-arcgis-runtime-sdk-for-android-and-a-000030115`,
        truncated: true,
      },
    ]);
  });

  it('marks a slug the site cut off with an ellipsis', () => {
    expect(slugWords(notice('arcgis-geoevent-server'))).toBe('Arcgis geoevent server');
    expect(slugWords(notice('arcgis-experience-builder-custom-widgets-bu'))).toBe(
      'Arcgis experience builder custom widgets bu…',
    );
  });
});

describe('noticeConcerns', () => {
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

// Regression: an active SDK was reported with seven deprecation notices of other products,
// because the pub package name `arcgis_maps` became the phrase `arcgis-maps`, and the alias
// "arcgis geoanalytics" claimed the notice of the unrelated server role.
describe('createNoticeMatcher: notices of other products', () => {
  const flutter = makeProduct({
    id: 'flutter-maps-sdk',
    name: 'ArcGIS Maps SDK for Flutter',
    aliases: ['flutter', 'dart', 'arcgis_maps', 'arcgis maps sdk for flutter'],
    packages: [{ registry: 'pub', name: 'arcgis_maps', license: 'esri-ma', primary: true }],
  });
  const dotnet = makeProduct({
    id: 'dotnet-maps-sdk',
    name: 'ArcGIS Maps SDK for .NET',
    aliases: ['net', 'dotnet', 'Esri.ArcGISRuntime'],
  });
  const engine = makeProduct({
    id: 'geoanalytics-engine',
    name: 'ArcGIS GeoAnalytics Engine',
    aliases: ['geoanalytics', 'gae', 'geoanalytics engine', 'arcgis geoanalytics'],
  });
  const server = makeProduct({
    id: 'geoanalytics-server',
    name: 'ArcGIS GeoAnalytics Server',
    aliases: [],
  });
  const pro = makeProduct({ id: 'arcgis-pro', name: 'ArcGIS Pro', aliases: ['pro'] });
  const proSdk = makeProduct({
    id: 'arcgis-pro-sdk',
    name: 'ArcGIS Pro SDK for .NET',
    aliases: ['pro sdk'],
  });
  const products = [flutter, dotnet, javaProduct, jsProduct, engine, server, pro, proSdk];
  const matcher = createNoticeMatcher(products);
  const owners = (subject: string): string[] =>
    products.filter((product) => matcher.concerns(notice(subject), product)).map((p) => p.id);

  /** Slugs in the shape of the Knowledge Base, with the products each one names. */
  const RECORDED: Array<[subject: string, concerns: string[]]> = [
    ['arcgis-maps-for-sharepoint-classic-deprecat', []],
    ['arcgis-maps-for-adobe-creative-cloud-functi', []],
    ['arcgis-maps-sdk-for-local-server', []],
    ['arcgis-maps-sdks-for-native-apps-arcgis-run', []],
    ['arcgis-maps-sdk-for-java', ['java-maps-sdk']],
    ['arcgis-maps-sdk-for-net', ['dotnet-maps-sdk']],
    ['widgets-in-arcgis-maps-sdk-for-javascript', ['js-maps-sdk']],
    ['arcgis-geoanalytics-server', ['geoanalytics-server']],
    ['arcgis-geoanalytics-engine-on-old-runtimes', ['geoanalytics-engine']],
    // The longer name claims its own notice; the shorter one keeps the rest.
    ['arcgis-pro-sdk-for-net-framework', ['arcgis-pro-sdk']],
    ['arcgis-pro-python-2-environments', ['arcgis-pro']],
  ];

  it.each(RECORDED)('%s concerns %j', (subject, expected) => {
    expect(owners(subject)).toEqual(expected);
  });

  it('attaches none of them to a product that only shares a package name with their wording', () => {
    for (const [subject] of RECORDED) {
      expect(matcher.concerns(notice(subject), flutter), subject).toBe(false);
    }
  });
});

describe('notice lines', () => {
  it('reads the title of an article page', () => {
    expect(
      titleOfArticle('<html><head><title> Support for  X &amp; Y in &#8220;Z&#8221; </title>'),
    ).toBe('Support for X & Y in “Z”');
    expect(titleOfArticle('<html><head></head><body>no title</body></html>')).toBeUndefined();
    expect(titleOfArticle('<title>   </title>')).toBeUndefined();
  });

  it('quotes the article title, and without one says that only the address is known', () => {
    const found = notice('arcgis-maps-sdk-for-net');
    expect(noticeLine(found, 'Support for .NET Framework in the SDK')).toBe(
      `Deprecation notice (Esri Knowledge Base): "Support for .NET Framework in the SDK" (${found.url})`,
    );
    const fallback = noticeLine(found, undefined);
    expect(fallback).toBe(
      `Deprecation notice (Esri Knowledge Base) whose address names this product: "Arcgis maps sdk for net" (${found.url}). The address does not say what is deprecated; it may be one platform or feature. Read the article.`,
    );
    // Regression: "Deprecation: Arcgis maps sdk for net" read as "the SDK is deprecated".
    expect(fallback).not.toMatch(/^Deprecation: /);
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
  const WIDGETS = `${KB}/deprecation-widgets-in-arcgis-maps-sdk-for-javascript-000040437`;
  const JAVA = `${KB}/deprecation-arcgis-maps-sdk-for-java-000032164`;
  const sites = () => makeCtx({ cassette: SITES, products: [jsProduct, javaProduct] });

  it('returns the notices of one product with the title of each article', async () => {
    const ctx = sites();
    expect(await deprecationNotices(ctx, jsProduct, makeCall(ctx))).toEqual({
      lines: [
        `Deprecation notice (Esri Knowledge Base): "Widgets in ArcGIS Maps SDK for JavaScript & their component replacements" (${WIDGETS})`,
      ],
      complete: true,
    });
    // The address names only the SDK; the title says what is deprecated.
    expect(await deprecationNotices(ctx, javaProduct, undefined)).toEqual({
      lines: [
        `Deprecation notice (Esri Knowledge Base): "Support for 32-bit platforms in ArcGIS Maps SDK for Java" (${JAVA})`,
      ],
      complete: true,
    });
  });

  it('remembers a title: the article is read once', async () => {
    const ctx = sites();
    await deprecationNotices(ctx, jsProduct, makeCall(ctx));
    ctx.clock.advance(2 * DAY);
    await deprecationNotices(ctx, jsProduct, makeCall(ctx));
    expect(ctx.http.count(WIDGETS)).toBe(1);
  });

  it('falls back to the address when the article cannot be read, and is not final then', async () => {
    const ctx = sites();
    ctx.http.fail(JAVA, 503);
    const result = await deprecationNotices(ctx, javaProduct, makeCall(ctx));
    expect(result.complete).toBe(false);
    expect(result.lines).toEqual([
      `Deprecation notice (Esri Knowledge Base) whose address names this product: "Arcgis maps sdk for java" (${JAVA}). The address does not say what is deprecated; it may be one platform or feature. Read the article.`,
    ]);
  });

  it('reads nothing with the website capability off', async () => {
    const ctx = makeCtx({
      cassette: SITES,
      config: { capabilities: new Set(['registries'] as const) },
    });
    expect(await deprecationNotices(ctx, jsProduct, undefined)).toEqual({
      lines: [],
      complete: true,
    });
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
