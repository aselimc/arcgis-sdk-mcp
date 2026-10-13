import { describe, expect, it } from 'vitest';
import { newBudget } from '../../src/core/async.js';
import type { Capability, Product, WorkspaceSdk } from '../../src/core/types.js';
import { createVersionService } from '../../src/versions/index.js';
import { REGISTRIES } from './cassettes-registries.js';
import { SITES } from './cassettes-sites.js';
import {
  LINE_200,
  dotnetProduct,
  javaProduct,
  jsProduct,
  pythonProduct,
  restJsProduct,
} from './products.js';
import { HOUR, MINUTE } from '../support/fake-clock.js';
import { FakeGithub } from '../support/fake-github.js';
import { makeCall, makeCtx, type TestCtx } from '../support/make-ctx.js';

const D = 'https://developers.arcgis.com';
const PRODUCTS = [jsProduct, pythonProduct, restJsProduct, dotnetProduct, javaProduct];

function setup(
  options: { workspace?: WorkspaceSdk[]; capabilities?: Capability[]; products?: Product[] } = {},
): TestCtx {
  return makeCtx({
    cassette: { interactions: [...REGISTRIES.interactions, ...SITES.interactions] },
    products: options.products ?? PRODUCTS,
    github: new FakeGithub({
      'Esri/arcgis-python-api': { release: { tag: 'v2.4.4', publishedAt: '2026-09-22T18:04:00Z' } },
    }),
    ...(options.workspace === undefined ? {} : { workspace: options.workspace }),
    ...(options.capabilities === undefined
      ? {}
      : { config: { capabilities: new Set(options.capabilities) } }),
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
    const project = {
      product: 'js-maps-sdk',
      package: '@arcgis/core',
      version: '4.33.1',
      file: 'package.json',
    };
    const ctx = setup({ workspace: [project] });
    const { entry } = await reportOne(ctx, '@arcgis/core');
    expect(entry.facts.map((fact) => `${fact.role} ${fact.value}`)).toEqual([
      'documented 5.1',
      'installable 5.1.27',
      'prerelease 5.2.0-next.145',
      'prerelease 6.0.0-next.6',
    ]);
    expect(entry.mismatches).toEqual([]);
    expect(entry.project).toEqual(project);
    expect(entry.compatibility).toContainEqual({
      with: 'Enterprise',
      value: '12.2',
      unreleased: false,
      source: `${D}/javascript/latest/version-matrix/`,
    });
    expect(entry.compatibility.filter((row) => row.unreleased).map((row) => row.value)).toEqual([
      'October 2026 (with JS SDK 5.2.*)',
      '5.2.* (with JS SDK 5.2.*)',
    ]);
    expect(entry.releaseNotes).toEqual([
      { version: '5.1', ref: `${D}/javascript/latest/release-notes/` },
    ]);
    expect(entry.notices).toEqual([
      'Deprecation: Widgets in arcgis maps sdk for javascript (https://support.esri.com/en-us/knowledge-base/deprecation-widgets-in-arcgis-maps-sdk-for-javascript-000040437)',
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
      'ArcGIS Maps SDK for Java is deprecated; Final release 200.6; successor: ArcGIS Maps SDK for .NET (dotnet-maps-sdk).',
      `Version 200.6 is a registry value as of ${javaProduct.verifiedOn}, not read live.`,
    ]);
    expect(entry.facts.filter((fact) => fact.role === 'lifecycle').map((fact) => fact.tag)).toEqual(
      ['ga', 'retirement'],
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
  const arcgis = {
    product: 'python-api',
    package: 'arcgis',
    version: '',
    file: 'requirements.txt',
  };

  it('reports every detected SDK when no product is named', async () => {
    const ctx = setup({
      workspace: [core, { ...core, package: '@arcgis/map-components' }, arcgis],
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
    const ctx = setup({ workspace: [core] });
    const report = await createVersionService(ctx).report({ version: '7.0' }, makeCall(ctx));
    expect(report.products[0]?.notices.join(' ')).toMatch(/7\.0 is newer than the current version/);
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

  it('falls back to the static registry value without any request', async () => {
    const ctx = setup();
    const [line] = javaProduct.lines;
    expect(await createVersionService(ctx).label(javaProduct, line!)).toBe('200.6');
    expect(ctx.http.count()).toBe(0);
  });
});
