import { afterEach, describe, expect, it } from 'vitest';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import { npmJsonAdapter } from '../../../../src/adapters/reference/npm/json.js';
import type { RendererInputs } from '../../../../src/core/ports.js';
import type { SourceDef } from '../../../../src/core/types.js';
import { describeAdapterContract } from '../../../support/adapter-contract.js';
import { makeLine } from '../../../support/builders.js';
import { readFixture, readJsonFixture } from '../../../support/fixtures.js';
import {
  cdnFile,
  distTags,
  functionsSource,
  makeProject,
  npmCtx,
  productOf,
  profilesSource,
  removeProjects,
  resolved,
} from './helpers.js';

interface Category {
  id: string;
  title: string;
  items: unknown[];
}
interface Profile {
  id?: string;
  name: string;
}

const NAME = '@arcgis/script-components';
const API_FILE = functionsSource.config.file;
const PROFILES_FILE = profilesSource.config.file;
const REFERENCE = 'https://developers.arcgis.com/widgets-script/function-reference/';
const TEXT_PAGE = `${REFERENCE}text_functions/`;
const PROFILES_REF = `https://cdn.jsdelivr.net/npm/${NAME}/${PROFILES_FILE}`;
const product = productOf(functionsSource, profilesSource);
const bindTo = (source: SourceDef<'npm-json'>, version?: string) =>
  bindSource(product, source, makeLine(), version);
const functions = (version?: string) => bindTo(functionsSource, version);
const profiles = (version?: string) => bindTo(profilesSource, version);
const api = readJsonFixture<Category[]>('cassettes', 'reference', 'npm', 'script-api.json');
const profileList = readJsonFixture<Profile[]>(
  'cassettes',
  'reference',
  'npm',
  'script-profiles.json',
);
const textCategory = api.find((category) => category.id === 'text_functions');

afterEach(removeProjects);

describeAdapterContract('npm-json (arcade-api)', () => ({
  adapter: npmJsonAdapter,
  product,
  source: functionsSource,
  ctx: () => npmCtx({ cassette: 'arcade.json' }),
  allowedHosts: ['developers.arcgis.com'],
  minRecords: 8,
  readRef: `${TEXT_PAGE}#shout`,
}));

describeAdapterContract('npm-json (arcade-profiles)', () => ({
  adapter: npmJsonAdapter,
  product,
  source: profilesSource,
  ctx: () => npmCtx({ cassette: 'arcade.json' }),
  allowedHosts: ['cdn.jsdelivr.net'],
  minRecords: 2,
  readRef: `${PROFILES_REF}#row-label`,
}));

describe('npm-json enumerate, mapper arcade-api', () => {
  it('lists every category page and every function with its anchor', async () => {
    const ctx = npmCtx({ cassette: 'arcade.json' });
    const records = await npmJsonAdapter.enumerate!(ctx, functions());
    expect(records.map((record) => record.ref.slice(REFERENCE.length))).toEqual([
      'constants/',
      'constants/#tau',
      'text_functions/',
      'text_functions/#shout',
      'text_functions/#glue1',
      'text_functions/#glue2',
      'geometry_functions/',
      'geometry_functions/#span',
    ]);
    expect(ctx.http.requests.map((request) => request.url)).toEqual([
      distTags(NAME),
      cdnFile(NAME, '7.2.4', API_FILE),
    ]);
  });

  it('describes a function as a global symbol with its signature', async () => {
    const records = await npmJsonAdapter.enumerate!(
      npmCtx({ cassette: 'arcade.json' }),
      functions(),
    );
    expect(records[3]).toEqual({
      ref: `${TEXT_PAGE}#shout`,
      product: 'widgets-sdk',
      source: 'functions',
      line: 'latest',
      kind: 'api',
      title: 'Shout',
      symbol: 'Shout',
      qualified: 'Shout',
      symbolKind: 'function',
      breadcrumb: 'Text functions',
      description:
        'Shout(inputText) -> Text - Returns the text in upper case with an exclamation mark.',
      keywords: ['core'],
      locator: { category: 'text_functions', anchor: 'shout' },
      license: 'esri-ma',
    });
    expect(records[1]).toMatchObject({ title: 'Tau', symbolKind: 'constant' });
    // Overloads share a name and differ by anchor and signature.
    expect(records[4]).toMatchObject({ symbol: 'Glue', locator: { anchor: 'glue1' } });
    expect(records[5]).toMatchObject({
      symbol: 'Glue',
      description: 'Glue(first, second) -> Text - Joins two texts.',
    });
    expect(records.every((record) => record.parent === undefined)).toBe(true);
  });

  it('describes a category as a page and derives missing links from the documentation root', async () => {
    const records = await npmJsonAdapter.enumerate!(
      npmCtx({ cassette: 'arcade.json' }),
      functions(),
    );
    expect(records[2]).toEqual({
      ref: TEXT_PAGE,
      product: 'widgets-sdk',
      source: 'functions',
      line: 'latest',
      kind: 'api',
      title: 'Text functions',
      locator: { category: 'text_functions' },
      license: 'esri-ma',
    });
    expect(records[7]).toMatchObject({
      ref: `${REFERENCE}geometry_functions/#span`,
      locator: { category: 'geometry_functions', anchor: 'span' },
    });
  });

  it('addresses entries by file URL when there is neither a link nor a documentation root', async () => {
    const { docUrl: _docUrl, ...config } = functionsSource.config;
    const source: SourceDef<'npm-json'> = { ...functionsSource, config };
    const ctx = npmCtx();
    ctx.http.on(distTags(NAME), { json: { latest: '7.2.4' } });
    ctx.http.on(cdnFile(NAME, '7.2.4', API_FILE), {
      json: [{ id: 'misc', title: 'Misc', items: [{ name: 'noop' }, { type: 'function' }, 7] }],
    });
    const records = await npmJsonAdapter.enumerate!(ctx, bindTo(source));
    const file = `https://cdn.jsdelivr.net/npm/${NAME}/${API_FILE}`;
    expect(records.map((record) => record.ref)).toEqual([`${file}#misc`, `${file}#noop`]);
    expect(records[1]).toMatchObject({ title: 'noop', symbolKind: 'function' });
    expect(records[1]?.description).toBeUndefined();

    const page = await npmJsonAdapter.read(ctx, bindTo(source), { url: new URL(`${file}#noop`) });
    expect(page.ref).toBe(`${file}#noop`);
    expect(ctx.render.calls[0]?.opts).toEqual({ select: { member: 'noop' } });
    await npmJsonAdapter.read(ctx, bindTo(source), { url: new URL(`${file}#misc`) });
    expect(ctx.render.calls[1]?.meta.url).toBe(`${file}#misc`);
    // The fragment is the address of the category, so nothing is selected inside it.
    expect(ctx.render.calls[1]?.opts).toBeUndefined();
  });

  it.each([
    ['an object instead of a list', { categories: [] }],
    ['categories without items', [{ id: 'text_functions', title: 'Text', functions: [] }]],
  ])('fails without retry for %s', async (_name, json) => {
    const ctx = npmCtx();
    ctx.http.on(distTags(NAME), { json: { latest: '7.2.4' } });
    ctx.http.on(cdnFile(NAME, '7.2.4', API_FILE), { json });
    await expect(npmJsonAdapter.enumerate!(ctx, functions())).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      details: { retryable: false, host: 'cdn.jsdelivr.net' },
    });
  });

  it('returns nothing for an empty reference', async () => {
    const ctx = npmCtx();
    ctx.http.on(distTags(NAME), { json: { latest: '7.2.4' } });
    ctx.http.on(cdnFile(NAME, '7.2.4', API_FILE), { json: [] });
    expect(await npmJsonAdapter.enumerate!(ctx, functions())).toEqual([]);
  });

  it.each([
    [404, 'DOC_NOT_FOUND'],
    ['html', 'DOC_NOT_FOUND'],
    ['truncated', 'UPSTREAM_UNAVAILABLE'],
    ['oversized', 'UPSTREAM_UNAVAILABLE'],
    [503, 'UPSTREAM_UNAVAILABLE'],
  ] as const)('fails with a typed error when the file answers %s', async (fault, code) => {
    const ctx = npmCtx({ cassette: 'arcade.json' });
    ctx.http.fail(cdnFile(NAME, '7.2.4', API_FILE), fault);
    await expect(npmJsonAdapter.enumerate!(ctx, functions())).rejects.toMatchObject({ code });
  });

  it('survives a registry outage by asking the CDN for the current version', async () => {
    const ctx = npmCtx({ cassette: 'arcade.json' });
    ctx.http.fail(distTags(NAME), 503);
    ctx.http.on(resolved(NAME, 'latest'), { json: { version: '7.2.4' } });
    expect(await npmJsonAdapter.enumerate!(ctx, functions())).toHaveLength(8);
    expect(ctx.http.count()).toBe(npmJsonAdapter.maxEnumerateRequests);
  });
});

describe('npm-json read, mapper arcade-api', () => {
  it('renders the category page a URL names', async () => {
    const ctx = npmCtx({ cassette: 'arcade.json' });
    const page = await npmJsonAdapter.read(ctx, functions(), { url: new URL(TEXT_PAGE) });
    const [call] = ctx.render.calls;
    expect(call?.kind).toBe('arcade');
    expect(call?.input).toEqual({ item: textCategory });
    expect(call?.opts).toBeUndefined();
    expect(call?.meta).toMatchObject({
      url: TEXT_PAGE,
      version: '7.2.4',
      kind: 'api',
      license: 'esri-ma',
      packageName: NAME,
    });
    expect(page).toMatchObject({
      ref: TEXT_PAGE,
      version: '7.2.4',
      attribution:
        'From @arcgis/script-components 7.2.4. Copyright Esri. Licensed under the Esri Master License Agreement.',
      notices: [],
    });
  });

  it('selects the function a fragment names on its category page', async () => {
    const ctx = npmCtx({ cassette: 'arcade.json' });
    const page = await npmJsonAdapter.read(ctx, functions(), {
      url: new URL(`${TEXT_PAGE.slice(0, -1)}#glue2`),
      detail: 'summary',
    });
    expect(ctx.render.calls[0]?.input).toEqual({ item: textCategory });
    expect(ctx.render.calls[0]?.opts).toEqual({ select: { member: 'glue2' }, detail: 'summary' });
    expect(page.ref).toBe(`${TEXT_PAGE}#glue2`);
  });

  it('keeps an explicit selector and an unknown fragment as they are', async () => {
    const ctx = npmCtx({ cassette: 'arcade.json' });
    await npmJsonAdapter.read(ctx, functions(), {
      url: new URL(`${TEXT_PAGE}#shout`),
      select: { section: 'glue1' },
    });
    expect(ctx.render.calls[0]?.opts).toEqual({ select: { section: 'glue1' } });
    const page = await npmJsonAdapter.read(ctx, functions(), {
      url: new URL(`${TEXT_PAGE}#nothing`),
    });
    // An unknown member leaves the page whole; the renderer decides, not the adapter.
    expect(ctx.render.calls[1]?.opts).toEqual({ select: { member: 'nothing' } });
    expect(page.ref).toBe(TEXT_PAGE);
  });

  it('uses the record that led here', async () => {
    const ctx = npmCtx({ cassette: 'arcade.json' });
    const records = await npmJsonAdapter.enumerate!(ctx, functions());
    await npmJsonAdapter.read(ctx, functions(), {
      url: new URL('https://developers.arcgis.com/elsewhere/'),
      record: records[5]!,
    });
    expect(ctx.render.calls[0]?.opts).toEqual({ select: { member: 'glue2' } });
    expect(ctx.render.calls[0]?.meta.url).toBe(`${TEXT_PAGE}#glue2`);
  });

  it.each([REFERENCE, `${REFERENCE}unknown_functions/`, `${REFERENCE}empty_functions/`])(
    'answers DOC_NOT_FOUND with a search call for %s',
    async (url) => {
      const ctx = npmCtx({ cassette: 'arcade.json' });
      await expect(
        npmJsonAdapter.read(ctx, functions(), { url: new URL(url) }),
      ).rejects.toMatchObject({
        code: 'DOC_NOT_FOUND',
        details: {
          url,
          next: 'arcgis_docs_search({"query":"Arcade functions","product":"widgets-sdk"})',
        },
      });
    },
  );

  it('reads the requested version and says so', async () => {
    const ctx = npmCtx({ cassette: 'arcade.json' });
    ctx.http.on(resolved(NAME, '6'), { json: { version: '6.9.1' } });
    ctx.http.on(cdnFile(NAME, '6.9.1', API_FILE), { json: api });
    const page = await npmJsonAdapter.read(ctx, functions('6'), { url: new URL(TEXT_PAGE) });
    expect(page.version).toBe('6.9.1');
    expect(page.notices).toHaveLength(1);
  });

  it('reads the installed package without any request', async () => {
    const { projectDir } = makeProject({
      [NAME]: {
        version: '7.1.9',
        files: { [API_FILE]: readFixture('cassettes', 'reference', 'npm', 'script-api.json') },
      },
    });
    const ctx = npmCtx({ projectDir });
    const page = await npmJsonAdapter.read(ctx, functions(), { url: new URL(TEXT_PAGE) });
    expect(ctx.http.count()).toBe(0);
    expect(page.version).toBe('7.1.9');
  });
});

describe('npm-json symbol, mapper arcade-api', () => {
  it('renders one function on a page of its own', async () => {
    const ctx = npmCtx({ cassette: 'arcade.json' });
    const records = await npmJsonAdapter.enumerate!(ctx, functions());
    const page = await npmJsonAdapter.symbol!(ctx, functions(), records[3]!, 'signature');
    expect(ctx.render.calls[0]?.input).toEqual({ item: textCategory?.items[0] });
    expect(ctx.render.calls[0]?.opts).toEqual({ detail: 'signature' });
    expect(page.ref).toBe(`${TEXT_PAGE}#shout`);
  });

  it('renders the overloads of a function together', async () => {
    const ctx = npmCtx({ cassette: 'arcade.json' });
    const records = await npmJsonAdapter.enumerate!(ctx, functions());
    const page = await npmJsonAdapter.symbol!(ctx, functions(), records[5]!, 'full');
    expect(ctx.render.calls[0]?.input).toEqual({ item: textCategory?.items[1] });
    expect(page.ref).toBe(`${TEXT_PAGE}#glue2`);
  });

  it('falls back to the page for a record that names no function', async () => {
    const ctx = npmCtx({ cassette: 'arcade.json' });
    const records = await npmJsonAdapter.enumerate!(ctx, functions());
    await npmJsonAdapter.symbol!(ctx, functions(), records[2]!, 'summary');
    expect(ctx.render.calls[0]?.input).toEqual({ item: textCategory });
    expect(ctx.render.calls[0]?.opts).toEqual({ detail: 'summary' });
  });
});

describe('npm-json, mapper arcade-profiles', () => {
  it('lists one record per profile, addressed by file URL and profile id', async () => {
    const ctx = npmCtx({ cassette: 'arcade.json' });
    const records = await npmJsonAdapter.enumerate!(ctx, profiles());
    expect(records).toEqual([
      {
        ref: `${PROFILES_REF}#minimal`,
        product: 'widgets-sdk',
        source: 'profiles',
        line: 'latest',
        kind: 'api',
        title: 'Minimal profile',
        symbol: 'minimal',
        qualified: 'minimal',
        symbolKind: 'profile',
        description: 'Function bundles: core',
        keywords: ['Minimal', 'core'],
        locator: { profile: 'minimal' },
        license: 'esri-ma',
      },
      {
        ref: `${PROFILES_REF}#row-label`,
        product: 'widgets-sdk',
        source: 'profiles',
        line: 'latest',
        kind: 'api',
        title: 'Row label profile',
        symbol: 'row-label',
        qualified: 'row-label',
        symbolKind: 'profile',
        description: 'Profile variables: $row, $panel. Function bundles: core, geometry',
        keywords: ['Row label', '$row', '$panel', 'core', 'geometry'],
        locator: { profile: 'row-label' },
        license: 'esri-ma',
      },
    ]);
    expect(ctx.http.requests.at(-1)?.url).toBe(cdnFile(NAME, '7.2.4', PROFILES_FILE));
  });

  it('uses profile pages when the source declares a documentation root', async () => {
    const source: SourceDef<'npm-json'> = {
      ...profilesSource,
      config: { ...profilesSource.config, docUrl: '/widgets-script/profiles' },
    };
    const ctx = npmCtx({ cassette: 'arcade.json' });
    const records = await npmJsonAdapter.enumerate!(ctx, bindTo(source));
    const ref = 'https://developers.arcgis.com/widgets-script/profiles/row-label/';
    expect(records[1]?.ref).toBe(ref);
    const page = await npmJsonAdapter.read(ctx, bindTo(source), { url: new URL(ref) });
    expect(page.ref).toBe(ref);
  });

  it('renders the profile a fragment names, whole', async () => {
    const ctx = npmCtx({ cassette: 'arcade.json' });
    const page = await npmJsonAdapter.read(ctx, profiles(), {
      url: new URL(`${PROFILES_REF}#row-label`),
    });
    const [call] = ctx.render.calls;
    expect(call?.kind).toBe('arcade');
    expect(call?.input as RendererInputs['arcade']).toEqual({
      item: profileList[1],
      profile: true,
    });
    // The fragment names the profile, so it is not passed on as a member selector.
    expect(call?.opts).toBeUndefined();
    expect(page).toMatchObject({ ref: `${PROFILES_REF}#row-label`, version: '7.2.4' });
  });

  it('passes an explicit selector and the detail on', async () => {
    const ctx = npmCtx({ cassette: 'arcade.json' });
    await npmJsonAdapter.read(ctx, profiles(), {
      url: new URL(`${PROFILES_REF}#row-label`),
      select: { member: '$row' },
      detail: 'summary',
    });
    expect(ctx.render.calls[0]?.opts).toEqual({ select: { member: '$row' }, detail: 'summary' });
  });

  it('reads a profile by record through symbol()', async () => {
    const ctx = npmCtx({ cassette: 'arcade.json' });
    const [record] = await npmJsonAdapter.enumerate!(ctx, profiles());
    const page = await npmJsonAdapter.symbol!(ctx, profiles(), record!, 'full');
    expect(ctx.render.calls[0]?.input).toMatchObject({ item: profileList[0], profile: true });
    expect(ctx.render.calls[0]?.opts).toEqual({ detail: 'full' });
    expect(page.ref).toBe(`${PROFILES_REF}#minimal`);
  });

  it.each([PROFILES_REF, `${PROFILES_REF}#unknown`, 'https://developers.arcgis.com/elsewhere/'])(
    'answers DOC_NOT_FOUND with the profiles that exist for %s',
    async (url) => {
      const ctx = npmCtx({ cassette: 'arcade.json' });
      await expect(
        npmJsonAdapter.read(ctx, profiles(), { url: new URL(url) }),
      ).rejects.toMatchObject({
        code: 'DOC_NOT_FOUND',
        details: { candidates: [`${PROFILES_REF}#minimal`, `${PROFILES_REF}#row-label`] },
      });
    },
  );

  it.each([
    ['an object instead of a list', { profiles: [] }],
    ['profiles without ids', [{ name: 'Minimal' }, { name: 'Row label' }]],
  ])('fails without retry for %s', async (_name, json) => {
    const ctx = npmCtx();
    ctx.http.on(distTags(NAME), { json: { latest: '7.2.4' } });
    ctx.http.on(cdnFile(NAME, '7.2.4', PROFILES_FILE), { json });
    await expect(npmJsonAdapter.enumerate!(ctx, profiles())).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      details: { retryable: false },
    });
  });

  it('returns nothing for an empty profile list', async () => {
    const ctx = npmCtx();
    ctx.http.on(distTags(NAME), { json: { latest: '7.2.4' } });
    ctx.http.on(cdnFile(NAME, '7.2.4', PROFILES_FILE), { json: [] });
    expect(await npmJsonAdapter.enumerate!(ctx, profiles())).toEqual([]);
  });
});
