import { describe, expect, it } from 'vitest';
import { newBudget } from '../../src/core/async.js';
import type { Capability, Product } from '../../src/core/types.js';
import { createVersionService } from '../../src/versions/index.js';
import { REGISTRIES } from './cassettes-registries.js';
import { SITES } from './cassettes-sites.js';
import {
  LINE_200,
  LINE_300,
  dotnetProduct,
  javaProduct,
  jsProduct,
  pythonProduct,
  restJsProduct,
} from './products.js';
import { HOUR, MINUTE } from '../support/fake-clock.js';
import { FakeGithub } from '../support/fake-github.js';
import { makeSource } from '../support/builders.js';
import { makeCall, makeCtx, type TestCtx } from '../support/make-ctx.js';
import { useProjects } from '../workspace/project.js';

const D = 'https://developers.arcgis.com';
const KB = 'https://support.esri.com/en-us/knowledge-base';
const PRODUCTS = [jsProduct, pythonProduct, restJsProduct, dotnetProduct, javaProduct];

const project = useProjects();
const packageJson = (dependencies: Record<string, string>): Record<string, string> => ({
  'package.json': JSON.stringify({ dependencies }),
});

function setup(
  options: {
    /** Manifests of the user's project; the service reads them from disk. */
    files?: Record<string, string>;
    capabilities?: Capability[];
    products?: Product[];
  } = {},
): TestCtx {
  return makeCtx({
    cassette: { interactions: [...REGISTRIES.interactions, ...SITES.interactions] },
    products: options.products ?? PRODUCTS,
    github: new FakeGithub({
      'Esri/arcgis-python-api': { release: { tag: 'v2.4.4', publishedAt: '2026-09-22T18:04:00Z' } },
    }),
    config: {
      ...(options.files === undefined ? {} : { projectDir: project(options.files) }),
      ...(options.capabilities === undefined
        ? {}
        : { capabilities: new Set(options.capabilities) }),
    },
  });
}

async function reportOne(ctx: TestCtx, product: string, version?: string) {
  const service = createVersionService(ctx);
  const report = await service.report(
    version === undefined ? { product } : { product, version },
    makeCall(ctx),
  );
  const [entry] = report.products;
  if (entry === undefined) throw new Error('the report has no product');
  return { report, entry, service };
}

describe('version report: the two cases of the design', () => {
  it('reports Python as documented 2.4.4 and installable 2.4.3, with a mismatch line', async () => {
    const ctx = setup();
    const { report, entry } = await reportOne(ctx, 'python');
    expect(report.asOf).toBe('2026-10-13');
    expect(entry.product.id).toBe('python-api');
    expect(entry.facts.map((fact) => [fact.role, fact.oracle, fact.value, fact.date])).toEqual([
      ['documented', 'page-regex', '2.4.4', '2026-09-22'],
      // The GitHub release is declared as release-date evidence for the documented version.
      ['documented', 'github-release', '2.4.4', '2026-09-22'],
      ['installable', 'pypi', '2.4.3', '2026-04-21'],
    ]);
    expect(entry.mismatches).toEqual([
      'Documented and installable versions differ: the documentation describes 2.4.4 (2026-09-22), but pypi arcgis serves 2.4.3 (2026-04-21). APIs new in 2.4.4 may not be installable from pypi yet.',
    ]);
    expect(entry.releaseNotes[0]).toEqual({
      version: '2.4.4',
      ref: `${D}/python/latest/guide/release-notes-244/`,
    });
    expect(ctx.http.unrecorded).toEqual([]);
    expect(report.notes).toEqual([]);
  });

  it('reports REST JS with the long-term support version as current and a mismatch line', async () => {
    const ctx = setup();
    const { entry } = await reportOne(ctx, 'rest-js');
    expect(entry.facts.map((fact) => [fact.role, fact.tag, fact.value])).toEqual([
      ['installable', 'lts-v4.x', '4.11.1'],
      ['installable', 'latest', '4.11.0'],
    ]);
    expect(entry.mismatches).toEqual([
      'npm @esri/arcgis-rest-request: dist-tag "latest" is 4.11.0, but "lts-v4.x" serves the newer 4.11.1. Install 4.11.1 explicitly to get the newest release.',
    ]);
    expect(entry.releaseNotes).toEqual([
      { version: '4.11.1', ref: `${D}/arcgis-rest-js/release-notes/` },
    ]);
  });
});

describe('version report: content', () => {
  it('joins facts, compatibility, release notes, deprecations and the project version', async () => {
    const ctx = setup({ files: packageJson({ '@arcgis/core': '4.33.1' }) });
    const { entry } = await reportOne(ctx, '@arcgis/core');
    expect(entry.facts.map((fact) => `${fact.role} ${fact.value}`)).toEqual([
      'documented 5.1',
      'installable 5.1.27',
      'prerelease 5.2.0-next.145',
      'prerelease 6.0.0-next.6',
    ]);
    expect(entry.mismatches).toEqual([]);
    expect(entry.project).toEqual({
      product: 'js-maps-sdk',
      package: '@arcgis/core',
      version: '4.33.1',
      file: 'package.json',
    });
    expect(entry.compatibility).toContainEqual({
      with: 'Enterprise',
      value: '12.2',
      unreleased: false,
      source: `${D}/javascript/latest/version-matrix/`,
    });
    expect(entry.compatibility.filter((row) => row.unreleased).map((row) => row.value)).toEqual([
      '5.2.* (with JS SDK 5.2.*)',
    ]);
    expect(entry.releaseNotes).toEqual([
      { version: '5.1', ref: `${D}/javascript/latest/release-notes/` },
    ]);
    expect(entry.notices).toEqual([
      `Deprecation notice (Esri Knowledge Base): "Widgets in ArcGIS Maps SDK for JavaScript & their component replacements" (${KB}/deprecation-widgets-in-arcgis-maps-sdk-for-javascript-000040437)`,
      'The project uses @arcgis/core 4.33.1 (package.json); the current version is 5.1. Read documentation for 4.33.1, not for the current version.',
    ]);
  });

  it('reports a requested line with its own facts only', async () => {
    const ctx = setup();
    const { entry } = await reportOne(ctx, 'dotnet-maps-sdk', 'v200');
    expect(entry.facts.map((fact) => [fact.role, fact.value])).toEqual([
      ['documented', '200.8.3'],
      ['installable', '200.8.3'],
    ]);
    expect(entry.notices).toContain(
      'Line "200.x LTS" is not the current line of ArcGIS Maps SDK for .NET; the current line is "300.x".',
    );
    expect(entry.releaseNotes).toEqual([
      { version: 'v200', ref: `${D}/net/v200/release-notes/release-notes-for-200-8/` },
      { version: '200.8.3', ref: `${D}/net/v200/release-notes/` },
      {
        version: '200.7',
        ref: `${D}/net/v200/release-notes/prior-releases/release-notes-for-200-7/`,
      },
    ]);
    expect(ctx.http.count(`${D}/net/v200/`)).toBe(1);
    expect(ctx.http.count(`${D}/net/`)).toBe(0);
  });

  it('relates a requested version to the current one', async () => {
    const older = await reportOne(setup(), 'js-maps-sdk', '4.33');
    expect(older.entry.notices).toContain(
      'ArcGIS Maps SDK for JavaScript has no documentation line for "4.33"; lines: latest (Current). The facts below describe the current line.',
    );
    expect(older.entry.notices).toContain('4.33 is older than the current version 5.1.');
    expect(older.entry.compatibility).toContainEqual(
      expect.objectContaining({ with: 'Enterprise', value: '12.0', unreleased: false }),
    );

    const preview = await reportOne(setup(), 'js-maps-sdk', '5.2');
    expect(preview.entry.notices).toContain(
      '5.2 is a pre-release (tag "rc": 5.2.0-next.145), not a generally available version.',
    );
    const future = await reportOne(setup(), 'js-maps-sdk', '7.0');
    expect(future.entry.notices).toContain(
      '7.0 is newer than the current version 5.1: it is not released yet or not known here.',
    );
  });

  it('labels a deprecated product and its static registry value', async () => {
    const ctx = setup();
    const { entry } = await reportOne(ctx, 'java');
    expect(entry.notices.slice(0, 2)).toEqual([
      'ArcGIS Maps SDK for Java is deprecated and retires on 2028-11-25. Final release 200.6. Successor: ArcGIS Maps SDK for .NET (dotnet-maps-sdk).',
      `Version 200.6 is a registry value as of ${javaProduct.verifiedOn}, not read live.`,
    ]);
    expect(entry.facts.filter((fact) => fact.role === 'lifecycle').map((fact) => fact.tag)).toEqual(
      ['ga', 'retirement'],
    );
  });

  // Regression: "is retired; Retires 2027-09-01" next to a retirement date still ahead, and
  // "is retired; Retired; build new apps ..." for a note that states the status itself.
  describe('the standing of a product that is not active', () => {
    const standing = async (overrides: Partial<Product>): Promise<string | undefined> => {
      const product: Product = { ...javaProduct, id: 'old-sdk', name: 'Old SDK', ...overrides };
      const { successor: _dropped, ...withoutSuccessor } = product;
      const ctx = setup({
        products: [...PRODUCTS, 'successor' in overrides ? product : withoutSuccessor],
      });
      return (await reportOne(ctx, 'old-sdk')).entry.notices[0];
    };
    const dates = (options: Record<string, string>): Product['oracles'] => [
      { type: 'static', options, provides: ['lifecycle'] },
    ];

    it('is in mature support until the retirement date, whatever the registry status says', async () => {
      expect(
        await standing({
          status: 'retired',
          statusNote: 'Successors by platform: swift-maps-sdk, kotlin-maps-sdk',
          oracles: dates({ mature: '2025-09-01', retirement: '2027-09-01' }),
        }),
      ).toBe(
        'Old SDK is in mature support and retires on 2027-09-01. Successors by platform: swift-maps-sdk, kotlin-maps-sdk.',
      );
    });

    it('was retired once the date has passed', async () => {
      expect(
        await standing({
          status: 'retired',
          statusNote: 'Its documentation is no longer hosted',
          oracles: dates({ retirement: '2024-07-01' }),
        }),
      ).toBe('Old SDK was retired on 2024-07-01. Its documentation is no longer hosted.');
    });

    it('does not state the status twice when the note states it', async () => {
      expect(
        await standing({
          status: 'retired',
          statusNote: 'Retired; build new apps with the new builder.',
          successor: 'dotnet-maps-sdk',
          oracles: [],
        }),
      ).toBe(
        'Old SDK: Retired; build new apps with the new builder. Successor: ArcGIS Maps SDK for .NET (dotnet-maps-sdk).',
      );
      expect(await standing({ status: 'beta', oracles: [] })).toBe(
        'Old SDK is beta. Final release 200.6.',
      );
    });
  });

  // Regression: the web map specification said "unknown" for itself while the matrix it
  // reads has a column with its version.
  it('documents a product without oracles at the version a matrix states for it', async () => {
    const spec: Product = {
      ...jsProduct,
      id: 'calcite-spec',
      name: 'Calcite specification',
      aliases: [],
      packages: [],
      oracles: [],
    };
    const { releaseNotes: _none, ...product } = spec;
    const ctx = setup({ products: [...PRODUCTS, product] });
    const { entry } = await reportOne(ctx, 'calcite-spec');
    // The 5.2 row is dated this month: not yet called released.
    expect(entry.facts).toEqual([
      {
        role: 'documented',
        value: '5.1',
        oracle: 'page-regex',
        url: `${D}/javascript/latest/version-matrix/`,
      },
    ]);
    expect(entry.compatibility).toContainEqual(
      expect.objectContaining({ with: 'JS SDK', value: '5.1.*', unreleased: false }),
    );
  });

  it('rejects an unknown product with the registry error', async () => {
    const ctx = setup();
    await expect(
      createVersionService(ctx).report({ product: 'no-such-product' }, makeCall(ctx)),
    ).rejects.toMatchObject({ code: 'UNKNOWN_PRODUCT' });
  });
});

describe('version report: the project', () => {
  const core = {
    product: 'js-maps-sdk',
    package: '@arcgis/core',
    version: '5.1.20',
    file: 'package.json',
  };
  const coreManifest = packageJson({ '@arcgis/core': '5.1.20' });

  it('reports every detected SDK when no product is named', async () => {
    const ctx = setup({
      files: {
        ...packageJson({ '@arcgis/core': '5.1.20', '@arcgis/map-components': '5.1.20' }),
        'requirements.txt': 'arcgis\n',
      },
    });
    const call = makeCall(ctx, { budget: newBudget(20, MINUTE, ctx.clock) });
    const report = await createVersionService(ctx).report({}, call);
    expect(report.products.map((entry) => entry.product.id)).toEqual(['js-maps-sdk', 'python-api']);
    expect(report.products[0]?.project).toEqual(core);
    // 5.1.20 is the current minor version: nothing to remark.
    expect(report.products[0]?.notices.some((notice) => notice.startsWith('The project'))).toBe(
      false,
    );
    expect(report.products[1]?.notices).toContain(
      'The project uses arcgis (requirements.txt) without stating a version.',
    );
    expect(report.notes).toEqual([]);
  });

  it('says so when nothing is detected, and ignores a version without a product', async () => {
    const ctx = setup();
    const report = await createVersionService(ctx).report({ version: '5.1' }, makeCall(ctx));
    expect(report.products).toEqual([]);
    expect(report.notes).toEqual([
      'No Esri SDK was detected in the current project. Pass "product" to report on one.',
      '"version" (5.1) was ignored: pass "product" together with it.',
    ]);
    expect(ctx.http.count()).toBe(0);
  });

  it('applies a version to the single detected product', async () => {
    const ctx = setup({ files: coreManifest });
    const report = await createVersionService(ctx).report({ version: '7.0' }, makeCall(ctx));
    expect(report.products[0]?.notices.join(' ')).toMatch(/7\.0 is newer than the current version/);
  });

  // Regression: the project version came from a scan made once per process, so after an
  // upgrade the report kept the old version while its retired-package warnings were fresh.
  it('sees an upgraded SDK within a minute, together with the rest of the manifest', async () => {
    const ctx = setup({ files: packageJson({ '@arcgis/core': '4.33.0' }) });
    const service = createVersionService(ctx);
    const before = await service.report({ product: 'js-maps-sdk' }, makeCall(ctx));
    expect(before.products[0]?.project?.version).toBe('4.33.0');

    project.write(
      ctx.config.projectDir,
      packageJson({ '@arcgis/core': '5.1.4', 'esri-loader': '3.7.0' }),
    );
    ctx.clock.advance(2 * MINUTE);
    const after = await service.report({ product: 'js-maps-sdk' }, makeCall(ctx));
    expect(after.products[0]?.project?.version).toBe('5.1.4');
    expect(after.products[0]?.notices.join(' ')).toContain('esri-loader@3.7.0');
  });

  // Regression: `^5.0.4` was reported as "the project uses 5.0.4 ... read documentation for
  // 5.0.4", although a fresh install of that range resolves to the current release.
  it('reports a range as a range, not as the installed version', async () => {
    const ctx = setup({ files: packageJson({ '@arcgis/core': '^5.0.4' }) });
    const { entry } = await reportOne(ctx, 'js-maps-sdk');
    expect(entry.project).toEqual({ ...core, version: '^5.0.4' });
    expect(entry.notices.at(-1)).toBe(
      'The project declares @arcgis/core ^5.0.4 (package.json): a range, and no lock file states the installed version. It is at least 5.0.4 and may be as new as the current 5.1. Documentation lookups assume 5.0.4; pass "version" when another one is installed.',
    );
  });

  it('takes the installed version from the lock file when there is one', async () => {
    const ctx = setup({
      files: {
        ...packageJson({ '@arcgis/core': '^5.0.4' }),
        'package-lock.json': JSON.stringify({
          lockfileVersion: 3,
          packages: { 'node_modules/@arcgis/core': { version: '5.1.27' } },
        }),
      },
    });
    const { entry } = await reportOne(ctx, 'js-maps-sdk');
    expect(entry.project).toEqual({ ...core, version: '5.1.27', file: 'package-lock.json' });
    expect(entry.notices.some((notice) => notice.startsWith('The project'))).toBe(false);
  });
});

// Regression: `version: ""` (what hosts send for an unused optional argument) produced the
// ref ".../release-notes-/" and stored it under the key of the report without a version.
describe('version report: a blank version', () => {
  const templated: Product = {
    ...pythonProduct,
    releaseNotes: {
      pattern: `${D}/python/latest/guide/release-notes-{compact}/`,
      sitemapFilter: '/guide/release-notes-\\d+/',
    },
  };
  const refsOf = (report: Awaited<ReturnType<typeof reportOne>>['report']): string[] =>
    report.products.flatMap((entry) => entry.releaseNotes.map((note) => note.ref));

  it.each(['', '   '])('treats %j as no version', async (version) => {
    const ctx = setup({ products: [templated] });
    const service = createVersionService(ctx);
    const blank = await service.report({ product: 'python-api', version }, makeCall(ctx));
    const plain = await service.report({ product: 'python-api' }, makeCall(ctx));
    for (const report of [blank, plain]) {
      expect(refsOf(report)[0]).toBe(`${D}/python/latest/guide/release-notes-244/`);
      expect(refsOf(report).join(' ')).not.toContain('release-notes-/');
      expect(report.products[0]?.releaseNotes.map((note) => note.version)).not.toContain('');
    }
    expect(blank.products[0]?.notices).toEqual(plain.products[0]?.notices);
  });

  it('treats a blank product as no product: the project decides, not an error', async () => {
    const ctx = setup({ files: packageJson({ '@arcgis/core': '5.1.20' }) });
    const report = await createVersionService(ctx).report({ product: ' ' }, makeCall(ctx));
    expect(report.products.map((entry) => entry.product.id)).toEqual(['js-maps-sdk']);
  });

  it('never answers one request with the cached report of another', async () => {
    const ctx = setup({ products: [templated] });
    const service = createVersionService(ctx);
    const plain = await service.report({ product: 'python-api' }, makeCall(ctx));
    const older = await service.report({ product: 'python-api', version: '2.4.3' }, makeCall(ctx));
    expect(older.products[0]?.notices).toContain('2.4.3 is older than the current version 2.4.4.');
    expect(plain.products[0]?.notices).not.toContain(
      '2.4.3 is older than the current version 2.4.4.',
    );
    // In the opposite order, too: the report of 2.4.3 is not what a plain call gets.
    const again = await service.report({ product: 'python-api' }, makeCall(ctx));
    expect(again.products[0]?.notices).toEqual(plain.products[0]?.notices);
  });

  it('lists no page for a version the sitemap does not have, and says so', async () => {
    const ctx = setup({ products: [templated] });
    const { entry } = await reportOne(ctx, 'python-api', '9.9.9');
    expect(entry.releaseNotes.map((note) => note.ref)).not.toContain(
      `${D}/python/latest/guide/release-notes-999/`,
    );
    expect(entry.releaseNotes[0]?.ref).toBe(`${D}/python/latest/guide/release-notes-244/`);
    expect(entry.notices).toContain(
      'No release-notes page is listed for 9.9.9; the refs are the pages that exist.',
    );
  });
});

describe('version report: degradation', () => {
  it('names switched-off capabilities and issues no request for them', async () => {
    const ctx = setup({ capabilities: ['website'] });
    const { report, entry } = await reportOne(ctx, 'python-api');
    expect(entry.facts.map((fact) => fact.role)).toEqual(['documented']);
    expect(report.notes).toEqual([
      'Package registries are switched off (capability "registries"): installable versions are not reported.',
      'GitHub is switched off (capability "github"): release tags are not reported.',
    ]);
    expect(ctx.http.hosts()).not.toContain('pypi.org');
    expect(ctx.github.count()).toBe(0);
  });

  it('falls back from the registry to the banner, and to "unknown" with the release-notes ref', async () => {
    const ctx = setup();
    ctx.http.fail(/registry\.npmjs\.org/, 503);
    const degraded = await reportOne(ctx, 'js-maps-sdk');
    expect(degraded.entry.facts.map((fact) => fact.role)).toEqual(['documented']);

    ctx.http.fail(`${D}/javascript/latest/`, 404);
    const unknown = await reportOne(ctx, 'js-maps-sdk');
    expect(unknown.entry.facts).toEqual([]);
    expect(unknown.entry.notices).toContain(
      `The current version of ArcGIS Maps SDK for JavaScript is unknown (UPSTREAM_UNAVAILABLE, DOC_NOT_FOUND); check ${D}/javascript/latest/release-notes/.`,
    );
    expect(unknown.entry.releaseNotes).toEqual([
      { version: 'current', ref: `${D}/javascript/latest/release-notes/` },
    ]);
  });

  it('survives a missing Knowledge Base sitemap and an unreadable compatibility page', async () => {
    const ctx = setup();
    ctx.http.fail(/support\.esri\.com/, 503).fail(/version-matrix/, 'timeout');
    const { entry } = await reportOne(ctx, 'js-maps-sdk');
    expect(entry.facts).toHaveLength(4);
    expect(entry.compatibility).toEqual([]);
    expect(entry.notices).toEqual([
      `Compatibility table "Version matrix" could not be read (UPSTREAM_UNAVAILABLE): ${D}/javascript/latest/version-matrix/`,
    ]);
  });

  it('says when the request budget ran out and does not cache the partial answer', async () => {
    const ctx = setup();
    const service = createVersionService(ctx);
    const tight = makeCall(ctx, { budget: newBudget(1, MINUTE, ctx.clock) });
    const partial = await service.report({ product: 'js-maps-sdk' }, tight);
    expect(partial.notes).toEqual([
      'The request budget of this call was spent before every fact was read. Call again to continue: the responses read so far are cached.',
    ]);
    const complete = await service.report({ product: 'js-maps-sdk' }, makeCall(ctx));
    expect(complete.notes).toEqual([]);
    expect(complete.products[0]?.facts).toHaveLength(4);
  });
});

describe('version report: cache', () => {
  it('reuses a report for six hours and joins the project freshly each time', async () => {
    const ctx = setup();
    const service = createVersionService(ctx);
    const first = await service.report({ product: 'rest-js' }, makeCall(ctx));
    const requests = ctx.http.count();
    ctx.clock.advance(5 * HOUR);
    const second = await service.report({ product: 'rest-js' }, makeCall(ctx));
    expect(ctx.http.count()).toBe(requests);
    expect(second.products[0]?.facts).toEqual(first.products[0]?.facts);
    // The facts are five hours old and the report says so.
    expect(second.asOf).toBe('2026-10-13');

    ctx.clock.advance(2 * HOUR);
    await service.report({ product: 'rest-js' }, makeCall(ctx));
    expect(ctx.http.count()).toBeGreaterThan(requests);
  });

  it('does not cache a report with a transient failure', async () => {
    const ctx = setup();
    const service = createVersionService(ctx);
    ctx.http.fail(/registry\.npmjs\.org/, 503, { times: 1 });
    const first = await service.report({ product: 'rest-js' }, makeCall(ctx));
    expect(first.products[0]?.facts).toEqual([]);
    const second = await service.report({ product: 'rest-js' }, makeCall(ctx));
    expect(second.products[0]?.facts).toHaveLength(2);
  });
});

describe('version label', () => {
  it('is the documented version, read with one request and then remembered', async () => {
    const ctx = setup();
    const service = createVersionService(ctx);
    const [line] = jsProduct.lines;
    expect(await service.label(jsProduct, line!)).toBe('5.1');
    // The banner is asked first; the registry is not needed once it answered.
    expect(ctx.http.requests.map((request) => request.url)).toEqual([`${D}/javascript/latest/`]);
    expect(await service.label(jsProduct, line!)).toBe('5.1');
    expect(ctx.http.count()).toBe(1);

    // A second service instance finds the label in the cache.
    expect(await createVersionService(ctx).label(jsProduct, line!)).toBe('5.1');
    expect(ctx.http.count()).toBe(1);
  });

  it('shares one lookup between concurrent callers', async () => {
    const ctx = setup();
    const service = createVersionService(ctx);
    const [line] = jsProduct.lines;
    const labels = await Promise.all([
      service.label(jsProduct, line!),
      service.label(jsProduct, line!),
    ]);
    expect(labels).toEqual(['5.1', '5.1']);
    expect(ctx.http.count()).toBe(1);
  });

  it('shortens a registry version to the documentation line', async () => {
    const ctx = setup();
    const [line] = restJsProduct.lines;
    expect(await createVersionService(ctx).label(restJsProduct, line!)).toBe('4.11');
  });

  it('answers per version line', async () => {
    const ctx = setup();
    expect(await createVersionService(ctx).label(dotnetProduct, LINE_200)).toBe('200.8.3');
  });

  it('remembers a missing label for an hour, then asks again', async () => {
    const ctx = setup();
    const service = createVersionService(ctx);
    const [line] = jsProduct.lines;
    ctx.http.fail(/./, 503);
    expect(await service.label(jsProduct, line!)).toBeUndefined();
    const requests = ctx.http.count();
    ctx.http.heal();
    expect(await service.label(jsProduct, line!)).toBeUndefined();
    expect(ctx.http.count()).toBe(requests);
    ctx.clock.advance(HOUR + MINUTE);
    expect(await service.label(jsProduct, line!)).toBe('5.1');
  });

  // Regression: the ArcGIS Enterprise release number was printed on hosted location
  // services, which have no version. An oracle can be limited to the sources it describes.
  describe('for one source of a product made of independent references', () => {
    const enterprise = makeSource('gatsby', { base: '/net/' }, { id: 'services-enterprise' });
    const hosted = makeSource(
      'gatsby',
      { base: '/net/places/' },
      { id: 'location-services', floor: false },
    );
    const rest: Product = {
      ...dotnetProduct,
      id: 'rest-widgets',
      lines: [LINE_300],
      sources: [enterprise, hosted],
      oracles: [
        {
          type: 'page-regex',
          options: { url: `${D}/net/`, sources: 'services-enterprise' },
          provides: ['documented'],
        },
      ],
    };

    it('labels the sources an oracle speaks for and leaves the others without a version', async () => {
      const ctx = setup({ products: [rest] });
      const service = createVersionService(ctx);
      const label = service.label as (
        product: Product,
        line: typeof LINE_300,
        source?: typeof hosted,
      ) => Promise<string | undefined>;
      expect(await label(rest, LINE_300, enterprise)).toBe('300.1');
      expect(await label(rest, LINE_300, hosted)).toBeUndefined();
      // Nothing was requested for the source that no oracle describes.
      expect(ctx.http.count()).toBe(1);
      // Without a source the product answers as before.
      expect(await label(rest, LINE_300)).toBe('300.1');
    });

    it('shares one label between the sources of a product whose oracles are not limited', async () => {
      const ctx = setup();
      const service = createVersionService(ctx);
      const label = service.label as (
        product: Product,
        line: typeof LINE_300,
        source?: typeof hosted,
      ) => Promise<string | undefined>;
      const [line] = jsProduct.lines;
      expect(await label(jsProduct, line!, enterprise)).toBe('5.1');
      expect(await label(jsProduct, line!, hosted)).toBe('5.1');
      expect(ctx.http.count()).toBe(1);
    });
  });

  it('falls back to the static registry value without any request', async () => {
    const ctx = setup();
    const [line] = javaProduct.lines;
    expect(await createVersionService(ctx).label(javaProduct, line!)).toBe('200.6');
    expect(ctx.http.count()).toBe(0);
  });
});
