import { describe, expect, it } from 'vitest';
import {
  javadocLegacyRecords,
  javadocMemberRecords,
  javadocTypeRecords,
  packageModules,
  parseSearchIndex,
} from '../../../../src/adapters/reference/javadoc-index.js';
import { javadocAdapter } from '../../../../src/adapters/reference/javadoc.js';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import { newBudget } from '../../../../src/core/async.js';
import { makeLine, makeProduct, makeSource } from '../../../support/builders.js';
import { loadCassette } from '../../../support/fixtures.js';
import { makeCtx, type TestCtx } from '../../../support/make-ctx.js';
import { describeReferenceContract, rendererOf, replaceResponses } from './contract.js';

const BASE = 'https://developers.arcgis.com/widgets/api-reference/java/';
const PACKAGES = `${BASE}package-search-index.js`;
const TYPES = `${BASE}type-search-index.js`;
const MEMBERS = `${BASE}member-search-index.js`;
const WIDGET = `${BASE}com.example.widgets/com/example/widgets/Widget.html`;

const source = makeSource(
  'javadoc',
  { base: '/widgets/api-reference/java/' },
  {
    id: 'api',
    title: 'API reference',
    kinds: ['api'],
    floor: false,
    probe: { url: TYPES, expect: 'text', mustContain: 'typeSearchIndex', minRecords: 3 },
  },
);
const product = makeProduct({ sources: [source] });
const cassette = () => loadCassette('cassettes', 'reference', 'docs', 'javadoc.json');
const ctxOf = (): TestCtx => makeCtx({ cassette: cassette() });
const bound = () => bindSource(product, source, makeLine());

describeReferenceContract('javadoc (search indexes)', () => ({
  adapter: javadocAdapter,
  product,
  source,
  ctx: ctxOf,
  allowedHosts: ['developers.arcgis.com'],
  minRecords: 9,
  readRef: WIDGET,
  siteIndexFiles: [PACKAGES, TYPES, MEMBERS],
  failures: {
    renamedField: {
      arrange: (ctx) =>
        replaceResponses(ctx, cassette(), {
          [TYPES]: { body: 'typeSearchIndex = [{"package":"com.example","label":"Widget"}];' },
        }),
      outcome: 'typed-failure',
      codes: ['UPSTREAM_UNAVAILABLE'],
    },
    missingFile: {
      arrange: (ctx) => ctx.http.fail(TYPES, 404),
      outcome: 'typed-failure',
      codes: ['DOC_NOT_FOUND'],
    },
    emptyIndex: {
      arrange: (ctx) =>
        replaceResponses(ctx, cassette(), { [TYPES]: { body: 'typeSearchIndex = [];' } }),
      outcome: 'typed-failure',
      codes: ['UPSTREAM_UNAVAILABLE'],
    },
    htmlInsteadOfJson: {
      arrange: (ctx) => ctx.http.fail(PACKAGES, 'html'),
      outcome: 'typed-failure',
      codes: ['DOC_NOT_FOUND'],
    },
    oversizedBody: {
      // The member index is by far the largest file; the types are listed without it.
      arrange: (ctx) => ctx.http.fail(MEMBERS, 'oversized'),
      outcome: 'degraded',
      minRecords: 3,
    },
    secondary5xx: {
      arrange: (ctx) => ctx.http.fail(MEMBERS, 503),
      outcome: 'degraded',
      minRecords: 3,
    },
  },
}));

describe('javadoc: enumerate', () => {
  it('composes page URLs with the module directory and member anchors', async () => {
    const ctx = ctxOf();
    const records = await javadocAdapter.enumerate!(ctx, bound());

    expect(records.map((record) => [record.title, record.symbolKind, record.ref.slice(BASE.length)]))
      .toEqual([
        ['Widget', 'type', 'com.example.widgets/com/example/widgets/Widget.html'],
        ['Widget.Builder', 'type', 'com.example.widgets/com/example/widgets/Widget.Builder.html'],
        ['Part', 'type', 'com.example.widgets/com/example/widgets/parts/Part.html'],
        ['Widget.ROUND', 'field', 'com.example.widgets/com/example/widgets/Widget.html#ROUND'],
        [
          'Widget.Widget(int)',
          'constructor',
          'com.example.widgets/com/example/widgets/Widget.html#%3Cinit%3E(int)',
        ],
        [
          'Widget.resize(int, int)',
          'method',
          'com.example.widgets/com/example/widgets/Widget.html#resize(int,int)',
        ],
        ['Widget.resize(int)', 'method', 'com.example.widgets/com/example/widgets/Widget.html#resize(int)'],
        [
          'Widget.Builder.build()',
          'method',
          'com.example.widgets/com/example/widgets/Widget.Builder.html#build()',
        ],
        ['Part.Part()', 'constructor', 'com.example.widgets/com/example/widgets/parts/Part.html#%3Cinit%3E()'],
      ]);
    expect(ctx.http.requests.map((request) => request.url)).toEqual([PACKAGES, TYPES, MEMBERS]);
  });

  it('qualifies members with their class and nested types with their outer type', async () => {
    const records = await javadocAdapter.enumerate!(ctxOf(), bound());
    const byTitle = new Map(records.map((record) => [record.title, record]));

    expect(byTitle.get('Widget')).toMatchObject({
      symbol: 'Widget',
      qualified: 'com.example.widgets.Widget',
      breadcrumb: 'com.example.widgets',
    });
    expect(byTitle.get('Widget')?.parent).toBeUndefined();
    expect(byTitle.get('Widget.Builder')).toMatchObject({
      symbol: 'Builder',
      qualified: 'com.example.widgets.Widget.Builder',
      parent: 'com.example.widgets.Widget',
    });
    expect(byTitle.get('Widget.resize(int, int)')).toMatchObject({
      symbol: 'resize',
      qualified: 'com.example.widgets.Widget.resize',
      parent: 'com.example.widgets.Widget',
      breadcrumb: 'com.example.widgets > Widget',
    });
    expect(byTitle.get('Widget.Builder.build()')?.parent).toBe('com.example.widgets.Widget.Builder');
  });

  it('lists the types when the member index is unavailable', async () => {
    const ctx = ctxOf();
    ctx.http.fail(MEMBERS, 404);
    const records = await javadocAdapter.enumerate!(ctx, bound());

    expect(records.map((record) => record.title)).toEqual(['Widget', 'Widget.Builder', 'Part']);
    expect(ctx.logger.entries.some((entry) => entry.msg.includes('member index'))).toBe(true);
  });

  it('does not present a partial catalogue when the request budget ran out', async () => {
    const ctx = ctxOf();
    const src = bindSource(product, source, makeLine(), undefined, newBudget(2, 60_000, ctx.clock));
    await expect(javadocAdapter.enumerate!(ctx, src)).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
    });
  });

  it('fails when a script assigns no array', async () => {
    const ctx = ctxOf();
    replaceResponses(ctx, cassette(), { [PACKAGES]: { body: 'var nothing = 1;' } });
    await expect(javadocAdapter.enumerate!(ctx, bound())).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      details: { url: PACKAGES },
    });
  });
});

describe('javadoc: read, symbol and probe', () => {
  it('reads a class page with the javadoc family hint', async () => {
    const ctx = ctxOf();
    await javadocAdapter.read(ctx, bound(), { url: new URL(WIDGET) });
    expect(rendererOf(ctx).calls[0]).toMatchObject({ kind: 'html', input: { familyHint: 'javadoc' } });
  });

  it('selects a member by the decoded anchor of its ref', async () => {
    const ctx = ctxOf();
    const records = await javadocAdapter.enumerate!(ctx, bound());
    const constructor = records.find((record) => record.title === 'Widget.Widget(int)')!;
    const overload = records.find((record) => record.title === 'Widget.resize(int, int)')!;
    await javadocAdapter.symbol!(ctx, bound(), constructor, 'summary');
    await javadocAdapter.symbol!(ctx, bound(), overload, 'summary');
    const calls = rendererOf(ctx).calls;

    expect(calls[0]?.opts).toEqual({ select: { member: '<init>(int)' }, detail: 'summary' });
    expect(calls[1]?.opts).toEqual({ select: { member: 'resize(int,int)' }, detail: 'summary' });
    expect(calls[1]?.meta.url).toBe(`${WIDGET}#resize(int,int)`);
    expect(ctx.http.count(WIDGET)).toBe(2);
  });

  it('probes the type index and counts its entries', async () => {
    expect(await javadocAdapter.probe(ctxOf(), bound())).toMatchObject({ ok: true, records: 5 });
  });
});

describe('javadoc index readers', () => {
  it('extracts the array of a search-index script without evaluating it', () => {
    expect(parseSearchIndex('x = [{"l":"A"},{"l":"B"}];updateSearchResults();')).toEqual([
      { l: 'A' },
      { l: 'B' },
    ]);
    expect(parseSearchIndex('x = [];')).toEqual([]);
    expect(parseSearchIndex('x = [alert(1)];')).toBeUndefined();
    expect(parseSearchIndex('x = {"l":"A"};')).toBeUndefined();
    expect(parseSearchIndex('] broken [')).toBeUndefined();
  });

  it('builds URLs without a module directory for a site without modules', () => {
    const modules = packageModules([{ l: 'All Packages', u: 'allpackages-index.html' }, { l: 'pkg' }]);
    const types = javadocTypeRecords(bound(), [{ p: 'pkg.sub', l: 'Thing' }, { p: '<Unnamed>', l: 'Loose' }], modules);
    const members = javadocMemberRecords(bound(), [{ p: '<Unnamed>', c: 'Loose', l: 'run()' }, null], modules);

    expect(modules.size).toBe(0);
    expect(types.map((record) => [record.ref, record.qualified])).toEqual([
      [`${BASE}pkg/sub/Thing.html`, 'pkg.sub.Thing'],
      [`${BASE}Loose.html`, 'Loose'],
    ]);
    expect(types[1]?.breadcrumb).toBeUndefined();
    expect(members[0]).toMatchObject({ ref: `${BASE}Loose.html#run()`, parent: 'Loose', qualified: 'Loose.run' });
  });

  it('uses the explicit URL of a type entry', () => {
    const [record] = javadocTypeRecords(bound(), [{ p: 'pkg', l: 'Odd', u: 'elsewhere/Odd.html' }], new Map());
    expect(record?.ref).toBe(`${BASE}elsewhere/Odd.html`);
  });
});

const LEGACY_BASE = 'https://developers.arcgis.com/widgets-server/api-reference/java/';
const CLASS_LIST = `${LEGACY_BASE}allclasses-noframe.html`;
const GADGET = `${LEGACY_BASE}com/example/widgets/server/Gadget.html`;
const legacy = makeSource(
  'javadoc',
  { base: '/widgets-server/api-reference/java/', legacy: true },
  {
    id: 'java-api',
    title: 'Java API reference',
    kinds: ['api'],
    floor: false,
    probe: { url: CLASS_LIST, expect: 'html', minChars: 200, minRecords: 4 },
  },
);
const legacyProduct = makeProduct({ id: 'widgets-server', sources: [legacy] });
const legacyCassette = () => loadCassette('cassettes', 'reference', 'docs', 'javadoc-legacy.json');
const legacyCtx = (): TestCtx => makeCtx({ cassette: legacyCassette() });
const legacyBound = () => bindSource(legacyProduct, legacy, makeLine());

describeReferenceContract('javadoc (JDK 8 class list)', () => ({
  adapter: javadocAdapter,
  product: legacyProduct,
  source: legacy,
  ctx: legacyCtx,
  allowedHosts: ['developers.arcgis.com'],
  minRecords: 4,
  readRef: GADGET,
  siteIndexFiles: [CLASS_LIST],
  hasMembers: false,
  failures: {
    renamedField: {
      arrange: (ctx) =>
        replaceResponses(ctx, legacyCassette(), {
          [CLASS_LIST]: { body: '<html><body><ul><li><a href="Gadget.html">Gadget</a></li></ul></body></html>' },
        }),
      outcome: 'typed-failure',
      codes: ['UPSTREAM_UNAVAILABLE'],
    },
    missingFile: {
      arrange: (ctx) => ctx.http.fail(CLASS_LIST, 404),
      outcome: 'typed-failure',
      codes: ['DOC_NOT_FOUND'],
    },
    emptyIndex: {
      arrange: (ctx) =>
        replaceResponses(ctx, legacyCassette(), { [CLASS_LIST]: { body: '<html><body></body></html>' } }),
      outcome: 'typed-failure',
      codes: ['UPSTREAM_UNAVAILABLE'],
    },
    htmlInsteadOfJson: {
      // The class list is HTML itself, so a catch-all page reads as a list without classes.
      arrange: (ctx) => ctx.http.fail(CLASS_LIST, 'html'),
      outcome: 'typed-failure',
      codes: ['UPSTREAM_UNAVAILABLE'],
    },
    oversizedBody: {
      arrange: (ctx) => ctx.http.fail(CLASS_LIST, 'oversized'),
      outcome: 'typed-failure',
      codes: ['UPSTREAM_UNAVAILABLE'],
    },
    secondary5xx: { notApplicable: 'the class list is the only index of a JDK 8 site' },
  },
}));

describe('javadoc: JDK 8 class list', () => {
  it('lists types with the kind and package the links state', async () => {
    const ctx = legacyCtx();
    const records = await javadocAdapter.enumerate!(ctx, legacyBound());

    expect(records.map((record) => [record.title, record.symbolKind, record.qualified])).toEqual([
      ['Gadget', 'class', 'com.example.widgets.server.Gadget'],
      ['GadgetException', 'class', 'com.example.widgets.server.GadgetException'],
      ['IGadgetServer', 'interface', 'com.example.widgets.server.IGadgetServer'],
      ['gadgetFormat', 'enum', 'com.example.widgets.server.gadgetFormat'],
    ]);
    expect(records[0]).toMatchObject({ ref: GADGET, breadcrumb: 'com.example.widgets.server' });
    expect(ctx.http.count()).toBe(1);
  });

  it('reads pages with the legacy family hint', async () => {
    const ctx = legacyCtx();
    await javadocAdapter.read(ctx, legacyBound(), { url: new URL(GADGET) });
    expect(rendererOf(ctx).calls[0]?.input).toMatchObject({ familyHint: 'javadoc-legacy' });
  });

  it('probes the class list as a page and counts its links', async () => {
    const ctx = legacyCtx();
    rendererOf(ctx).family = 'javadoc-legacy';
    expect(await javadocAdapter.probe(ctx, legacyBound())).toMatchObject({
      ok: true,
      records: 5,
      family: 'javadoc-legacy',
    });
  });

  it('ignores links that leave the site', () => {
    const html = '<a href="../other/Thing.html" title="class in other">Thing</a>';
    expect(javadocLegacyRecords(legacyBound(), html)).toEqual([]);
  });
});
