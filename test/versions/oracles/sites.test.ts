import { describe, expect, it } from 'vitest';
import { ORACLES } from '../../../src/versions/oracles/index.js';
import { visibleText } from '../../../src/versions/oracles/page-regex.js';
import { LIFECYCLE } from '../cassettes-registries.js';
import { SITES } from '../cassettes-sites.js';
import { LINE_200, dotnetProduct, javaProduct, jsProduct, spec } from '../products.js';
import { makeProduct, makeSource } from '../../support/builders.js';
import { makeCtx } from '../../support/make-ctx.js';

const D = 'https://developers.arcgis.com';
const sites = () => makeCtx({ cassette: SITES });
const at = (path: string) => makeProduct({ homepage: `${D}${path}` });

describe('page-regex: home banner', () => {
  it.each([
    ['/javascript/latest/', '5.1', '2026-06'],
    ['/net/', '300.1', '2026-08'],
    ['/python/latest/', '2.4.4', '2026-09-22'],
    ['/experience-builder/', '1.21', '2026-07'],
    ['/calcite-design-system/', '5.1', '2026-05'],
  ])('reads the banner of %s', async (path, value, date) => {
    const ctx = sites();
    const facts = await ORACLES['page-regex'].read(ctx, at(path), spec('page-regex'));
    expect(facts).toEqual([
      { role: 'documented', value, date, oracle: 'page-regex', url: `${D}${path}` },
    ]);
    expect(ctx.http.unrecorded).toEqual([]);
  });

  it('ignores versions in scripts and comments, so a page without a banner has no answer', async () => {
    const ctx = sites();
    expect(await ORACLES['page-regex'].read(ctx, at('/no-banner/'), spec('page-regex'))).toEqual([]);
  });

  it('follows the version line when the spec names the home page', async () => {
    const ctx = sites();
    const [banner] = dotnetProduct.oracles;
    const facts = await ORACLES['page-regex'].read(ctx, dotnetProduct, banner!, { line: LINE_200 });
    expect(facts[0]).toMatchObject({ value: '200.8.3', date: '2026-09', url: `${D}/net/v200/` });
  });

  it('strips markup, entities and hidden content', () => {
    expect(
      visibleText('<p>A&nbsp;&amp; B &#8211; C</p><style>p{}</style><!-- hidden --><b>D</b>'),
    ).toBe('A & B - C D');
  });
});

describe('page-regex: custom patterns', () => {
  it('builds the version from several groups of a markup pattern', async () => {
    const ctx = sites();
    const facts = await ORACLES['page-regex'].read(
      ctx,
      makeProduct(),
      spec('page-regex', {
        url: `${D}/arcade/guide/release-notes/`,
        pattern: '<h2[^>]*\\bid="version-(\\d)(\\d+)"',
        match: 'html',
        format: '$1.$2',
      }),
    );
    // Group 2 is part of the version here, not a date.
    expect(facts).toEqual([
      {
        role: 'documented',
        value: '1.38',
        oracle: 'page-regex',
        url: `${D}/arcade/guide/release-notes/`,
      },
    ]);
  });

  it('reads markup when the pattern contains a tag, without being told to', async () => {
    const ctx = sites();
    const facts = await ORACLES['page-regex'].read(
      ctx,
      makeProduct(),
      spec('page-regex', {
        url: '/rest/whats-new/',
        pattern: '<h2[^>]*>\\s*(\\d+(?:\\.\\d+)+)\\s*<',
      }),
    );
    expect(facts[0]?.value).toBe('12.1');
  });

  it('takes the date from the group the spec names', async () => {
    const ctx = sites();
    const facts = await ORACLES['page-regex'].read(
      ctx,
      makeProduct(),
      spec('page-regex', {
        url: `${D}/experience-builder/`,
        pattern: 'Version (\\d+\\.\\d+) · (\\w+ \\d{4})',
        dateGroup: '2',
      }),
    );
    expect(facts[0]).toMatchObject({ value: '1.21', date: '2026-07' });
  });

  it('reads a JSON document as text', async () => {
    const ctx = sites();
    const facts = await ORACLES['page-regex'].read(
      ctx,
      makeProduct(),
      spec('page-regex', {
        url: 'https://api.example.arcgis.com/apidocs.json',
        pattern: '"version"\\s*:\\s*"([^"]+)"',
      }),
    );
    expect(facts[0]?.value).toBe('2.7.1');
    expect(ctx.http.requests[0]?.expect).toBe('json');
  });

  it('has no answer for a pattern that does not compile', async () => {
    const ctx = sites();
    const broken = spec('page-regex', { url: `${D}/javascript/latest/`, pattern: '([unclosed' });
    expect(await ORACLES['page-regex'].read(ctx, makeProduct(), broken)).toEqual([]);
  });
});

describe('sitemap-slug', () => {
  it('reports the highest release-notes slug of the product sitemap', async () => {
    const ctx = sites();
    const facts = await ORACLES['sitemap-slug'].read(ctx, dotnetProduct, spec('sitemap-slug'));
    expect(facts).toEqual([
      {
        role: 'documented',
        value: '300.1',
        oracle: 'sitemap-slug',
        url: `${D}/net/release-notes/release-notes-for-300-1/`,
      },
    ]);
  });

  it('reads run-together digits when the spec says so', async () => {
    const ctx = sites();
    const facts = await ORACLES['sitemap-slug'].read(
      ctx,
      at('/python/latest/'),
      spec('sitemap-slug', { slug: 'compact', filter: '/guide/release-notes-\\d+/' }),
    );
    expect(facts[0]).toMatchObject({
      value: '2.4.4',
      url: `${D}/python/latest/guide/release-notes-244/`,
    });
  });

  it('treats a date-named release as its own release date', async () => {
    const ctx = sites();
    const facts = await ORACLES['sitemap-slug'].read(
      ctx,
      makeProduct(),
      spec('sitemap-slug', {
        sitemap: `${D}/arcgis-urban-api/sitemap-0.xml`,
        filter: '/release-notes/',
      }),
    );
    expect(facts[0]).toMatchObject({ value: '2026-07-21', date: '2026-07-21' });
  });

  it('follows a sitemap index into its first child', async () => {
    const ctx = sites();
    const facts = await ORACLES['sitemap-slug'].read(ctx, at('/indexed/'), spec('sitemap-slug'));
    expect(facts[0]?.value).toBe('2.4.0');
    expect(ctx.http.count()).toBe(2);
  });

  it('has no answer when the sitemap is gone', async () => {
    const ctx = sites();
    ctx.http.fail(/sitemap-0\.xml$/, 404);
    const outcome = await ORACLES['sitemap-slug'].attempt(ctx, dotnetProduct, spec('sitemap-slug'));
    expect(outcome.facts).toEqual([]);
    expect(outcome.error?.code).toBe('DOC_NOT_FOUND');
  });
});

describe('meta-refresh-target', () => {
  it('reads the version from where the gateway landed', async () => {
    const ctx = sites();
    const facts = await ORACLES['meta-refresh-target'].read(
      ctx,
      dotnetProduct,
      spec('meta-refresh-target'),
    );
    expect(facts).toEqual([
      {
        role: 'documented',
        value: '300.1',
        oracle: 'meta-refresh-target',
        url: `${D}/net/release-notes/release-notes-for-300-1/`,
      },
    ]);
  });

  it('reads the stub itself when the hop was not followed', async () => {
    const ctx = sites();
    const facts = await ORACLES['meta-refresh-target'].read(
      ctx,
      makeProduct(),
      spec('meta-refresh-target', { url: 'https://location.arcgis.com/help/release-notes/' }),
    );
    expect(facts[0]).toMatchObject({
      value: '2026-07',
      date: '2026-07',
      url: 'https://location.arcgis.com/help/release-notes/2026-07/',
    });
  });

  it('has no answer for a page that is not a stub', async () => {
    const ctx = sites();
    const plain = spec('meta-refresh-target', { url: `${D}/no-banner/` });
    expect(await ORACLES['meta-refresh-target'].read(ctx, makeProduct(), plain)).toEqual([]);
  });
});

describe('docesri-sitemap', () => {
  it('reports the highest version segment and ignores "latest"', async () => {
    const ctx = sites();
    const facts = await ORACLES['docesri-sitemap'].read(
      ctx,
      makeProduct(),
      spec('docesri-sitemap', { slug: 'arcgis-pro' }),
    );
    expect(facts).toEqual([
      {
        role: 'documented',
        value: '3.7',
        oracle: 'docesri-sitemap',
        url: 'https://doc.esri.com/arcgis-pro/sitemap.xml',
      },
    ]);
  });

  it('takes the slug from the product source when the spec has none', async () => {
    const ctx = sites();
    const product = makeProduct({
      sources: [makeSource('docfx-esri', { slug: 'arcgis-pro', toc: 'arcpy/toc.json' })],
    });
    const facts = await ORACLES['docesri-sitemap'].read(ctx, product, spec('docesri-sitemap'));
    expect(facts[0]?.value).toBe('3.7');
    expect(await ORACLES['docesri-sitemap'].read(ctx, makeProduct(), spec('docesri-sitemap'))).toEqual(
      [],
    );
  });
});

describe('static', () => {
  it('reports the registry values without any request', async () => {
    const ctx = makeCtx();
    const [oracle] = javaProduct.oracles;
    const facts = await ORACLES.static.read(ctx, javaProduct, oracle!);
    expect(facts).toEqual([
      { role: 'documented', value: '200.6', oracle: 'static', url: `${D}/java/v200/` },
      {
        role: 'lifecycle',
        value: '2024-11-25',
        date: '2024-11-25',
        tag: 'ga',
        oracle: 'static',
        url: `${D}/java/v200/`,
      },
      {
        role: 'lifecycle',
        value: '2028-11-25',
        date: '2028-11-25',
        tag: 'retirement',
        oracle: 'static',
        url: `${D}/java/v200/`,
      },
    ]);
    expect(ctx.http.count()).toBe(0);
  });

  it('falls back to the version in the status note', async () => {
    const ctx = makeCtx();
    expect(await ORACLES.static.read(ctx, javaProduct, spec('static'))).toEqual([
      expect.objectContaining({ value: '200.6' }),
    ]);
    expect(await ORACLES.static.read(ctx, jsProduct, spec('static'))).toEqual([]);
  });
});

describe('plc', () => {
  const lifecycleSpec = spec('plc', {
    category: 'Foundational',
    productName: 'Widgets Desktop',
    platform: 'NA',
  });
  const withLifecycle = () =>
    makeCtx({
      cassette: LIFECYCLE,
      config: {
        capabilities: new Set(['website', 'registries', 'github', 'lifecycle-api'] as const),
      },
    });

  it('is off unless the lifecycle-api capability is enabled', async () => {
    const ctx = makeCtx({ cassette: LIFECYCLE });
    const outcome = await ORACLES.plc.attempt(ctx, makeProduct(), lifecycleSpec);
    expect(outcome).toEqual({ facts: [], skipped: 'lifecycle-api' });
    expect(ctx.http.count()).toBe(0);
  });

  it('reports the dates of the newest released minor version, ignoring patches and future releases', async () => {
    const ctx = withLifecycle();
    const facts = await ORACLES.plc.read(ctx, makeProduct(), lifecycleSpec);
    expect(facts.map((fact) => [fact.tag, fact.value])).toEqual([
      ['ga', '2026-05-14'],
      ['mature', '2028-06-01'],
      ['retirement', '2029-06-01'],
    ]);
    expect(facts.every((fact) => fact.role === 'lifecycle' && fact.oracle === 'plc')).toBe(true);
    // Only whitelisted fields leave the oracle.
    expect(JSON.stringify(facts)).not.toMatch(/internal|intranet/);
  });

  it('reports the requested version, and nothing for an unreleased one', async () => {
    const ctx = withLifecycle();
    const older = await ORACLES.plc.read(ctx, makeProduct(), lifecycleSpec, { version: '3.6.4' });
    expect(older.find((fact) => fact.tag === 'ga')?.value).toBe('2025-11-13');
    expect(await ORACLES.plc.read(ctx, makeProduct(), lifecycleSpec, { version: '3.8' })).toEqual(
      [],
    );
  });

  it('needs a category', async () => {
    const ctx = withLifecycle();
    expect(await ORACLES.plc.read(ctx, makeProduct(), spec('plc'))).toEqual([]);
    expect(ctx.http.count()).toBe(0);
  });
});
