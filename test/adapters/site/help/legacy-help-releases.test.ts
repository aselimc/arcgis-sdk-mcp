import { describe, expect, it } from 'vitest';
import { legacyHelpAdapter } from '../../../../src/adapters/site/legacy-help.js';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import { makeDocPage, makeLine, makeProduct, makeSource } from '../../../support/builders.js';
import type { TestCtx } from '../../../support/make-ctx.js';
import { rendererOf } from '../contract.js';
import { PYTHON, proCtx, python, tools, withoutSiteIndex } from './docfx-setup.js';

/**
 * An earlier release of a product whose current release is documented on doc.esri.com. The
 * numbered release on pro.arcgis.com has pages but publishes no listing of them: no
 * table-of-contents script in its topics, no `flisting.htm`, no `sitemap.xml`.
 */
const RELEASE = 'https://pro.arcgis.com/en/widgets-pro/3.5/';
const BOOK = `${RELEASE}arcpy/`;
const earlier = makeSource(
  'legacy-help',
  {
    host: 'pro.arcgis.com',
    base: '/en/widgets-pro/{line}/',
    books: [{ path: 'arcpy' }],
    lines: ['3.5'],
    enumerate: 'on-demand',
  },
  {
    id: 'legacy',
    title: 'Python reference of earlier releases',
    kinds: ['api', 'guide'],
    floor: false,
    lines: ['3.5'],
    probe: {
      url: `${BOOK}functions/listwidgets.htm`,
      expect: 'html',
      family: 'legacy-help',
    },
  },
);
const release = makeLine({ id: '3.5', label: 'Pro 3.5', current: false });
const product = makeProduct({
  id: 'widgets-pro',
  name: 'Widgets Pro',
  languages: ['python'],
  lines: [makeLine(), release],
  sources: [python, earlier],
});
const bound = () => bindSource(product, earlier, release);
/** A context in which the release answers "not found" for every listing it could have. */
const ctxOf = (): TestCtx => {
  const ctx = proCtx();
  ctx.http.fail(/^https:\/\/pro\.arcgis\.com\/.*\/(?:flisting\.htm|sitemap\.xml)$/, 404);
  return ctx;
};

describe('legacy-help: a release that publishes no listing', () => {
  // Regression: every symbol lookup with such a version failed ("upstream failing ... retry"),
  // although the pages of the release exist and can be read by URL.
  it('lists the book from the current release, addressed in the release that was asked for', async () => {
    const ctx = ctxOf();
    const records = await legacyHelpAdapter.enumerate!(ctx, bound());

    expect(ctx.http.requests.map((request) => request.url)).toEqual([
      `${BOOK}flisting.htm`,
      `${BOOK}sitemap.xml`,
      `${PYTHON}toc.json`,
    ]);
    expect(records.every((record) => record.ref.startsWith(BOOK))).toBe(true);
    expect(records.every((record) => record.ref.endsWith('.htm'))).toBe(true);
    expect(records.find((record) => record.qualified === 'arcpy.da.WidgetCursor')).toEqual({
      ref: `${BOOK}data-access/widgetcursor-class.htm`,
      product: 'widgets-pro',
      source: 'legacy',
      line: '3.5',
      kind: 'api',
      title: 'WidgetCursor',
      breadcrumb: 'Data Access module > Classes',
      symbol: 'WidgetCursor',
      qualified: 'arcpy.da.WidgetCursor',
      symbolKind: 'class',
      language: 'python',
      license: product.licenseTier,
    });
    // A topic of the book is listed as a page, with its place in the table of contents.
    expect(records.find((record) => record.title === 'What is WidgetPy?')).toMatchObject({
      kind: 'api',
      ref: expect.stringMatching(
        /^https:\/\/pro\.arcgis\.com\/en\/widgets-pro\/3\.5\/arcpy\//,
      ) as unknown,
    });
    expect(records.filter((record) => record.symbol !== undefined)).toHaveLength(9);
  });

  it('reads a class of that release with its members', async () => {
    const ctx = ctxOf();
    const records = await legacyHelpAdapter.enumerate!(ctx, bound());
    const record = records.find((candidate) => candidate.qualified === 'arcpy.da.WidgetCursor')!;
    ctx.http.on(record.ref, { body: '<main><h1>WidgetCursor</h1></main>' });
    rendererOf(ctx).when('html', (rendered) =>
      makeDocPage({
        markdown: [
          '# WidgetCursor',
          '',
          '## Methods',
          '',
          '```',
          'next ()',
          '```',
          '',
          'Moves on.',
        ].join('\n'),
        url: rendered.meta.url.replace(/#.*$/, ''),
        ref: rendered.meta.url,
      }),
    );

    const page = await legacyHelpAdapter.read(ctx, bound(), {
      url: new URL(`${record.ref}#next`),
      record: { ...record, ref: `${record.ref}#next`, parent: 'arcpy.da.WidgetCursor' },
      select: { member: 'next' },
    });
    expect(page.members).toEqual([
      {
        id: 'method-next',
        name: 'next',
        kind: 'method',
        signature: 'next()',
        summary: 'Moves on.',
      },
    ]);
    expect(page.sections.map((section) => section.id)).toEqual(['method-next']);
    expect(page.ref).toBe(`${record.ref}#methods`);
  });

  it('fails as before when the product has no current release of the book, or may not read its index', async () => {
    const alone = makeProduct({ ...product, sources: [earlier] });
    await expect(
      legacyHelpAdapter.enumerate!(ctxOf(), bindSource(alone, earlier, release)),
    ).rejects.toMatchObject({ code: 'DOC_NOT_FOUND' });

    // A table of contents is a site-published index file.
    const ctx = withoutSiteIndex(ctxOf());
    await expect(legacyHelpAdapter.enumerate!(ctx, bound())).rejects.toMatchObject({
      code: 'DOC_NOT_FOUND',
    });
    expect(ctx.http.count(/toc\.json$/)).toBe(0);
  });

  it('fails with the first error when the current release cannot be listed either', async () => {
    const ctx = ctxOf();
    ctx.http.fail(`${PYTHON}toc.json`, 503);
    await expect(legacyHelpAdapter.enumerate!(ctx, bound())).rejects.toMatchObject({
      code: 'DOC_NOT_FOUND',
      details: { url: `${BOOK}flisting.htm` },
    });
  });
});

describe('legacy-help: a release that lists its own books', () => {
  // The registry names one book per directory of the reference, each with its script. Such
  // a listing has titles only: without the naming rule of the current release, no topic of
  // the earlier one is a symbol, and `arcpy.da.WidgetCursor` cannot be looked up in it.
  const SCRIPT = `${BOOK}data-access/1461.js`;
  const perDirectory = {
    ...earlier,
    config: {
      ...earlier.config,
      books: [
        {
          path: 'arcpy/data-access',
          tocScript: '/en/widgets-pro/{line}/arcpy/data-access/1461.js',
        },
      ],
    },
  };
  const node = (id: string, fields: Record<string, unknown>): string =>
    `treedata.data["${id}"] = ${JSON.stringify(fields)};`;
  const script = [
    'treedata = (window.treedata || {}); treedata.data = {};',
    node('root', { parent: '', children: ['1461_h0'] }),
    node('1461_h0', {
      parent: 'root',
      label: 'Data Access module',
      children: ['1461_1', '1461_h1', '1461_h2'],
    }),
    node('1461_1', {
      parent: '1461_h0',
      label: 'What is the Data Access module',
      url: '/en/widgets-pro/3.5/arcpy/data-access/what-is-the-data-access-module-.htm',
    }),
    node('1461_h1', { parent: '1461_h0', label: 'Classes', children: ['1461_2'] }),
    node('1461_2', {
      parent: '1461_h1',
      label: 'WidgetCursor',
      url: '/en/widgets-pro/3.5/arcpy/data-access/widgetcursor-class.htm',
    }),
    node('1461_h2', { parent: '1461_h0', label: 'Functions', children: ['1461_3'] }),
    node('1461_3', {
      parent: '1461_h2',
      label: 'Walk',
      url: '/en/widgets-pro/3.5/arcpy/data-access/walk.htm',
    }),
  ].join('\n');

  it('names the symbols of its topics by the rule of the current release, without a request for it', async () => {
    const ctx = proCtx();
    ctx.http.on(SCRIPT, { body: script });
    const src = bindSource({ ...product, sources: [python, perDirectory] }, perDirectory, release);
    const records = await legacyHelpAdapter.enumerate!(ctx, src);

    expect(ctx.http.requests.map((request) => request.url)).toEqual([SCRIPT]);
    expect(
      records.map((record) => [record.title, record.kind, record.qualified, record.symbolKind]),
    ).toEqual([
      ['What is the Data Access module', 'api', undefined, undefined],
      ['WidgetCursor', 'api', 'arcpy.da.WidgetCursor', 'class'],
      ['Walk', 'api', 'arcpy.da.Walk', 'function'],
    ]);
    expect(records[1]).toMatchObject({
      ref: `${BOOK}data-access/widgetcursor-class.htm`,
      line: '3.5',
      source: 'legacy',
      language: 'python',
      breadcrumb: 'Data Access module > Classes',
    });
  });

  it('lists plain topics when the product has no current release to take the rule from', async () => {
    const ctx = proCtx();
    ctx.http.on(SCRIPT, { body: script });
    const src = bindSource({ ...product, sources: [perDirectory] }, perDirectory, release);
    const records = await legacyHelpAdapter.enumerate!(ctx, src);
    expect(records).toHaveLength(3);
    expect(records.every((record) => record.symbol === undefined)).toBe(true);
  });

  // A toolbox book lists its toolsets at the top: nothing in its own tree says "toolbox",
  // which is what tells a tool from a topic in the table of contents of the whole reference.
  it('names the tools of a toolbox book', async () => {
    const TOOLBOX = `${RELEASE}tool-reference/shaping/`;
    const toolbox = {
      ...earlier,
      id: 'legacy-tools',
      config: {
        ...earlier.config,
        books: [
          {
            path: 'tool-reference/shaping',
            tocScript: '/en/widgets-pro/{line}/tool-reference/shaping/1484.js',
          },
        ],
      },
    };
    const tree = [
      'treedata = (window.treedata || {}); treedata.data = {};',
      node('root', { parent: '', children: ['1484_1', '1484_h0'] }),
      node('1484_1', {
        parent: 'root',
        label: 'An overview of the Shaping toolbox',
        url: '/en/widgets-pro/3.5/tool-reference/shaping/an-overview-of-the-shaping-toolbox.htm',
      }),
      node('1484_h0', { parent: 'root', label: 'Edges toolset', children: ['1484_2', '1484_h1'] }),
      node('1484_2', {
        parent: '1484_h0',
        label: 'Round Corners',
        url: '/en/widgets-pro/3.5/tool-reference/shaping/round-corners.htm',
      }),
      node('1484_h1', { parent: '1484_h0', label: 'Edges toolset concepts', children: ['1484_3'] }),
      node('1484_3', {
        parent: '1484_h1',
        label: 'How Round Corners works',
        url: '/en/widgets-pro/3.5/tool-reference/shaping/how-round-corners-works.htm',
      }),
    ].join('\n');
    const ctx = proCtx();
    ctx.http.on(`${TOOLBOX}1484.js`, { body: tree });
    const src = bindSource({ ...product, sources: [python, tools, toolbox] }, toolbox, release);
    const records = await legacyHelpAdapter.enumerate!(ctx, src);

    expect(records.map((record) => [record.title, record.qualified, record.symbolKind])).toEqual([
      ['An overview of the Shaping toolbox', undefined, undefined],
      ['Round Corners', 'arcpy.shaping.RoundCorners', 'tool'],
      ['How Round Corners works', undefined, undefined],
    ]);
    expect(records[1]).toMatchObject({
      ref: `${TOOLBOX}round-corners.htm`,
      kind: 'api',
      keywords: ['RoundCorners_shaping'],
      breadcrumb: 'Edges toolset',
    });
  });
});
