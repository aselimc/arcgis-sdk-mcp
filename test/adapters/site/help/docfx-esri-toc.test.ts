import { describe, expect, it } from 'vitest';
import {
  GP_TOOLBOX_ALIASES,
  arcpySymbol,
  gpToolName,
  gpToolSymbol,
  gpToolboxAlias,
  parseToc,
  pythonSignature,
  tocBooks,
  type TocEntry,
} from '../../../../src/adapters/site/docfx-esri-toc.js';
import { readFixture, readJsonFixture } from '../../../support/fixtures.js';

const fixture = (name: string): unknown => readJsonFixture('cassettes', 'site', 'help', name);
const toolsToc = () => parseToc(fixture('docfx-tools-toc.json')) ?? [];
const entry = (title: string, ...ancestors: string[]): TocEntry => ({ title, ancestors });
const inToolbox = (title: string) => entry(title, 'Geoprocessing tools', 'Shaping toolbox');

describe('parseToc', () => {
  it('flattens the tree in document order with the groups above each entry', () => {
    const entries = toolsToc();
    expect(entries[0]).toEqual({
      title: 'Widget tool reference',
      href: 'main/widget-tool-reference.html',
      ancestors: [],
    });
    expect(entries.find((candidate) => candidate.title === 'Wide Bevel')).toEqual({
      title: 'Wide Bevel',
      href: 'shaping/bevel-2.html',
      ancestors: ['Geoprocessing tools', 'Shaping toolbox', 'Edges toolset'],
    });
    // Groups are entries too, without a page of their own.
    expect(entries.find((candidate) => candidate.title === 'Edges toolset')).toEqual({
      title: 'Edges toolset',
      ancestors: ['Geoprocessing tools', 'Shaping toolbox'],
    });
  });

  it('skips entries without a name and values that are not entries', () => {
    const titles = toolsToc().map((candidate) => candidate.title);
    expect(titles).toHaveLength(21);
    expect(titles.at(-1)).toBe('Community');
  });

  it('descends through a group without a name without adding a breadcrumb level', () => {
    const entries = parseToc({
      items: [{ items: [{ name: 'Inner', href: 'inner.html' }] }, { name: '  ', href: 'x.html' }],
    });
    expect(entries).toEqual([{ title: 'Inner', href: 'inner.html', ancestors: [] }]);
  });

  it('reports a document of another shape as unreadable rather than empty', () => {
    expect(parseToc({ children: [] })).toBeUndefined();
    expect(parseToc({ items: 'none' })).toBeUndefined();
    expect(parseToc(null)).toBeUndefined();
    expect(parseToc('text')).toBeUndefined();
    expect(parseToc({ items: [] })).toEqual([]);
  });

  it('stops descending in a file nested deeper than any table of contents', () => {
    let nested: { name: string; items?: unknown[] } = { name: 'leaf' };
    for (let depth = 0; depth < 40; depth += 1) nested = { name: `level ${depth}`, items: [nested] };
    const entries = parseToc({ items: [nested] }) ?? [];
    expect(entries.length).toBeLessThan(40);
    expect(entries.length).toBeGreaterThan(20);
  });
});

describe('tocBooks', () => {
  it('lists the JSON twin of every book the root file names', () => {
    const root = {
      items: [
        { name: 'Install', href: 'install/a.html', tocHref: 'install/toc.html' },
        { name: 'SDK', href: 'sdk/' },
        { name: 'Odd', tocHref: 'odd/contents.html' },
        { tocHref: 'nameless/toc.html' },
        7,
      ],
    };
    expect(tocBooks(root)).toEqual([{ title: 'Install', toc: 'install/toc.json' }]);
    expect(tocBooks({})).toEqual([]);
  });
});

describe('gpToolName', () => {
  it.each([
    ['Buffer', 'buffer.html', 'Buffer'],
    ['Split Line at Point', 'split-line-at-point.html', 'SplitLineAtPoint'],
    ['Add Fields (multiple)', 'add-fields.html', 'AddFields'],
    ['Cul-De-Sac Masks', 'cul-de-sac-masks.html', 'CulDeSacMasks'],
    ['Add Data To BIS', 'add-data-to-bis.html', 'AddDataToBIS'],
    ["Bivariate Association (Lee's L)", 'bivariate-association.html', 'BivariateAssociation'],
    ['80-20 Analysis', 'eighty-twenty-analysis.html', 'EightyTwentyAnalysis'],
  ])('derives the call name of "%s"', (title, slug, expected) => {
    expect(gpToolName(title, slug)).toBe(expected);
  });

  it('gives up when neither the title nor the slug starts with a letter', () => {
    expect(gpToolName('3 x 3', '3x3.html')).toBeUndefined();
  });
});

describe('gpToolboxAlias', () => {
  it('prefers a verified alias, then the known one, then the bare directory name', () => {
    expect(gpToolboxAlias('data-management')).toBe('management');
    expect(gpToolboxAlias('3d-analyst')).toBe('ddd');
    expect(gpToolboxAlias('brand-new-toolbox')).toBe('brandnewtoolbox');
    expect(
      gpToolboxAlias('data-management', { aliases: { 'data-management': 'mgmt' }, names: {} }),
    ).toBe('mgmt');
  });

  it('knows only aliases that are Python identifiers', () => {
    for (const alias of Object.values(GP_TOOLBOX_ALIASES)) expect(alias).toMatch(/^[a-z]+$/);
  });
});

describe('gpToolSymbol', () => {
  it('names a tool from its toolbox directory and title', () => {
    expect(gpToolSymbol(inToolbox('Count Widgets'), 'data-management/count-widgets.html')).toEqual({
      symbol: 'CountWidgets',
      qualified: 'arcpy.management.CountWidgets',
      symbolKind: 'tool',
      keywords: ['CountWidgets_management', 'data-management'],
    });
    // The directory is no extra keyword when it is the alias itself.
    expect(gpToolSymbol(inToolbox('Buffer'), 'analysis/buffer.html')?.keywords).toEqual([
      'Buffer_analysis',
    ]);
  });

  it('finds the tools of the fixture and nothing else but title-cased topics', () => {
    const tools = toolsToc().flatMap((candidate) => {
      const symbol =
        candidate.href === undefined ? undefined : gpToolSymbol(candidate, candidate.href);
      return symbol === undefined ? [] : [symbol.qualified];
    });
    expect(tools).toEqual([
      'arcpy.shaping.RoundCorners',
      'arcpy.shaping.SplitWidgetAtSeam',
      'arcpy.shaping.BevelEdges',
      'arcpy.shaping.WideBevel',
      'arcpy.management.CountWidgets',
      'arcpy.management.EightyTwentySorting',
      'arcpy.management.OpenWidgetExplorer',
      // The same page linked a second time, with a fragment; the adapter lists it once.
      'arcpy.shaping.RoundCorners',
    ]);
  });

  it.each([
    ['a topic title', inToolbox('Branch versioning support'), 'shaping/branch-versioning.html'],
    ['an overview', inToolbox('An overview of the Shaping toolbox'), 'shaping/overview.html'],
    ['an introduction', inToolbox('Introduction to Space Cubes'), 'shaping/intro.html'],
    ['a toolbox history page', inToolbox('Shaping toolbox history'), 'shaping/history.html'],
    [
      'a page of a concepts group',
      entry('How Bevel Works', 'Shaping toolbox', 'Edges toolset concepts'),
      'shaping/how-bevel-works.html',
    ],
    ['a page outside any toolbox', entry('Cell Size', 'Environments'), 'environments/cell.html'],
    ['a page at another depth', inToolbox('Round Corners'), 'shaping/sub/round-corners.html'],
    ['a page without a directory', inToolbox('Round Corners'), 'round-corners.html'],
    ['a name that cannot be derived', inToolbox('3 X 3'), 'shaping/3x3.html'],
  ])('does not take %s for a tool', (_what, candidate, path) => {
    expect(gpToolSymbol(candidate, path)).toBeUndefined();
  });

  it('applies what the pages said: a corrected name, a learned alias, a page that is no tool', () => {
    const verified = {
      aliases: { shaping: 'shape' },
      names: {
        'shaping/bevel-2.html': 'arcpy.shape.Bevel2',
        'shaping/open-explorer.html': null,
      },
    };
    expect(gpToolSymbol(inToolbox('Wide Bevel'), 'shaping/bevel-2.html', verified)).toEqual({
      symbol: 'Bevel2',
      qualified: 'arcpy.shape.Bevel2',
      symbolKind: 'tool',
      keywords: ['Bevel2_shape', 'shaping'],
    });
    expect(
      gpToolSymbol(inToolbox('Round Corners'), 'shaping/round-corners.html', verified)?.qualified,
    ).toBe('arcpy.shape.RoundCorners');
    expect(
      gpToolSymbol(inToolbox('Open Explorer'), 'shaping/open-explorer.html', verified),
    ).toBeUndefined();
    // A verified name never turns a topic into a tool.
    expect(
      gpToolSymbol(
        entry('How Bevel Works', 'Shaping toolbox', 'Edges toolset concepts'),
        'shaping/bevel-2.html',
        verified,
      ),
    ).toBeUndefined();
  });
});

describe('arcpySymbol', () => {
  it.each([
    ['ListWidgets', ['ArcPy functions', 'Listing data'], 'functions/listwidgets.html', 'arcpy.ListWidgets', 'function'],
    ['WidgetShape', ['ArcPy classes', 'Geometry'], 'classes/widgetshape.html', 'arcpy.WidgetShape', 'class'],
    ['SearchCursor', ['Data Access module', 'Classes'], 'data-access/searchcursor-class.html', 'arcpy.da.SearchCursor', 'class'],
    ['Walk', ['Data Access module', 'Functions'], 'data-access/walk.html', 'arcpy.da.Walk', 'function'],
    ['Route', ['Network Analyst module', 'Classes'], 'network-analyst/route.html', 'arcpy.nax.Route', 'class'],
    ['RouteShapeType', ['Network Analyst module', 'Classes', 'Enumerations'], 'network-analyst/routeshapetype.html', 'arcpy.nax.RouteShapeType', 'class'],
    ['GetSolverProperties', ['Network Analyst module', 'Legacy', 'Functions'], 'network-analyst/getsolverproperties.html', 'arcpy.na.GetSolverProperties', 'function'],
    ['GadgetDraft', ['Gadget module'], 'gadget-kit/gadgetdraft-class.html', 'arcpy.gadget_kit.GadgetDraft', 'class'],
    ['Extent', ['Gadget module'], 'gadget-kit/extent-object.html', 'arcpy.gadget_kit.Extent', 'class'],
    ['MakeGadget', ['Gadget module'], 'gadget-kit/makegadget.html', 'arcpy.gadget_kit.MakeGadget', 'function'],
  ])('qualifies %s', (title, ancestors, path, qualified, symbolKind) => {
    expect(arcpySymbol({ title, ancestors }, path)).toEqual({ symbol: title, qualified, symbolKind });
  });

  it('leaves topics alone', () => {
    expect(arcpySymbol(entry('Widget properties', 'ArcPy functions'), 'functions/w.html')).toBeUndefined();
    expect(arcpySymbol(entry('// (Integer Division) operator'), 'image-analyst/op.html')).toBeUndefined();
    expect(arcpySymbol(entry('ListWidgets'), 'listwidgets.html')).toBeUndefined();
    expect(arcpySymbol(entry('ListWidgets'), 'a/b/listwidgets.html')).toBeUndefined();
  });
});

describe('pythonSignature', () => {
  it('takes the name from the syntax line and the alias from the spelling that is valid Python', () => {
    const html = readFixture('cassettes', 'site', 'help', 'docfx-tool-page.html');
    expect(pythonSignature(html)).toEqual({ name: 'Bevel2', alias: 'shape' });
  });

  it('reads converted Markdown as well, escaped parenthesis included', () => {
    expect(pythonSignature('`arcpy.analysis.Buffer(in_features, out)`')).toEqual({
      name: 'Buffer',
      alias: 'analysis',
    });
    expect(pythonSignature('arcpy.sa.Aspect\\(in_raster\\)')).toEqual({ name: 'Aspect', alias: 'sa' });
  });

  it('prefers the more frequent alias and the earlier one on a tie', () => {
    const page = 'arcpy.old.Clip(a) arcpy.new.Clip(a) arcpy.new.Clip(b) arcpy.da.Walk(x)';
    expect(pythonSignature(page)).toEqual({ name: 'Clip', alias: 'new' });
    expect(pythonSignature('arcpy.first.Clip(a) arcpy.second.Clip(a)')?.alias).toBe('first');
  });

  it('reports a name without an alias when no spelling is valid, and nothing without a call', () => {
    expect(pythonSignature('arcpy.3d.Viewshed2(in_raster)')).toEqual({ name: 'Viewshed2' });
    expect(pythonSignature('import arcpy; arcpy.env.workspace = "x"; arcpy.ListFields(t)')).toBeUndefined();
  });
});
