import { describe, expect, it } from 'vitest';
import { emptyIndex } from '../../../../src/adapters/site/gatsby/discovery.js';
import { gatsbyAdapter } from '../../../../src/adapters/site/gatsby/index.js';
import { fuseSymbols } from '../../../../src/adapters/site/gatsby/symbols-fuse.js';
import {
  parseLabelTitle,
  parseOperationTitle,
  restSymbols,
} from '../../../../src/adapters/site/gatsby/symbols-rest.js';
import { typedocSymbols } from '../../../../src/adapters/site/gatsby/symbols-typedoc.js';
import type { SymbolInput } from '../../../../src/adapters/site/gatsby/symbols.js';
import type { CatalogRecord } from '../../../../src/core/types.js';
import {
  D,
  apiref,
  documentation,
  engine,
  openapi,
  pythonApi,
  recordAt,
  rest,
  typedoc,
  type Site,
} from './sites.js';

async function recordsOf(site: Site): Promise<CatalogRecord[]> {
  if (gatsbyAdapter.enumerate === undefined) throw new Error('the adapter must enumerate');
  const ctx = site.ctx();
  const records = await gatsbyAdapter.enumerate(ctx, site.bound());
  expect(ctx.http.unrecorded).toEqual([]);
  return records;
}

/** Members must name their owner, a qualified name and a kind (the contract of the catalogue). */
function expectMembersComplete(records: readonly CatalogRecord[]): void {
  for (const record of records.filter((candidate) => candidate.parent !== undefined)) {
    expect(record.qualified, record.ref).toBeDefined();
    expect(record.symbolKind, record.ref).toBeDefined();
  }
}

function input(overrides: Partial<SymbolInput>): SymbolInput {
  return {
    site: { base: `${D}/x/`, prefix: `${D}/x/` },
    config: { base: '/x/' },
    index: emptyIndex(),
    pages: [],
    nav: [],
    ...overrides,
  };
}

describe('symbols: rest-operations', () => {
  it('turns operation titles into operation symbols on their pages', async () => {
    const records = await recordsOf(rest());
    expect(recordAt(records, '/apply-changes-gadget-service/')).toMatchObject({
      title: '/applyChanges: Apply Changes (Gadget Service)',
      symbol: 'applyChanges',
      qualified: 'GadgetService.applyChanges',
      symbolKind: 'operation',
      kind: 'api',
    });
    expect(recordAt(records, '/query-gadget-layer/').qualified).toBe('GadgetLayer.query');
    const bare = recordAt(records, '/find-gadget-candidates/');
    expect(bare.symbol).toBe('findGadgetCandidates');
    expect(bare.qualified).toBeUndefined();
  });

  it('names a labelled resource page after its label and leaves prose pages alone', async () => {
    const records = await recordsOf(rest());
    expect(recordAt(records, '/gadget-service/')).toMatchObject({
      symbol: 'gadgetService',
      symbolKind: 'resource',
    });
    expect(recordAt(records, '/whats-new/').symbol).toBeUndefined();
    // The path heuristic still classifies a what's-new page of an API source.
    expect(recordAt(records, '/whats-new/').kind).toBe('release-notes');
  });

  it.each([
    ['/applyEdits: Apply Edits (Feature Service)', 'applyEdits', 'FeatureService.applyEdits'],
    ['/findAddressCandidates', 'findAddressCandidates', undefined],
    ['/content/users/{userName}/addItem', 'addItem', 'content.users.addItem'],
    ['/items/{itemId}', 'items', undefined],
    ['/query: Query (Map Service/Layer)', 'query', 'MapServiceLayer.query'],
    ['/export: Export Map', 'export', undefined],
    // Titles without the leading slash (regression: `search: Search` had no symbol).
    ['search: Search', 'search', undefined],
    ['applyEdits: Apply Edits (Gadget Service)', 'applyEdits', 'GadgetService.applyEdits'],
    ['invitations: User Invitations', 'invitations', undefined],
    // Parameters in brackets (regression: the portal's `/[runID]/delete` had no symbol).
    ['/[runID]/delete: Delete Run', 'delete', undefined],
    ['/[taskID]/runs: Runs for Task', 'runs', undefined],
  ])('parses %s', (title, symbol, qualified) => {
    expect(parseOperationTitle(title)).toEqual(
      qualified === undefined ? { symbol } : { symbol, qualified },
    );
  });

  it.each(['Feature Service', 'What is new', '/', '/{id}', 'a/b: c', 'note: Read this first'])(
    'does not take "%s" for an operation',
    (title) => {
      expect(parseOperationTitle(title)).toBeUndefined();
    },
  );

  // Sites that title pages with a label instead of a path (regression: `applyEdits` was not
  // found in the services reference, whose titles are all of this form).
  it.each([
    [
      'Apply Changes (Gadget Service/Layer)',
      ['Catalog', 'Gadget Service'],
      'applyChanges',
      'GadgetServiceLayer.applyChanges',
    ],
    [
      'Query Related Records',
      ['Catalog', 'Gadget Service', 'Layer'],
      'queryRelatedRecords',
      'Layer.queryRelatedRecords',
    ],
    ['Unregister - Machine', ['Site', 'Machines', 'Machine'], 'unregister', 'Machine.unregister'],
    ['HTML Popup (Gadget Service/Layer)', ['Catalog'], 'htmlPopup', 'GadgetServiceLayer.htmlPopup'],
    ['CreateWatersheds', ['Tasks'], 'CreateWatersheds', 'Tasks.CreateWatersheds'],
    ['Query', [], 'query', undefined],
  ])('derives a name from the label "%s"', (title, crumbs, symbol, qualified) => {
    expect(parseLabelTitle(title, crumbs)).toEqual(
      qualified === undefined ? { symbol } : { symbol, qualified },
    );
  });

  it.each([
    'Examples: scripting a task',
    'What is new in 12.1?',
    'A title of far too many plain words',
  ])('does not derive a name from the prose title "%s"', (title) => {
    expect(parseLabelTitle(title, ['Catalog'])).toBeUndefined();
  });

  it('tells resources, operations and data types apart in a labelled hierarchy', () => {
    const page = (path: string, title: string, crumbs: string[]) => ({
      url: `${D}/x/${path}/`,
      title,
      crumbs,
    });
    const entries = restSymbols(
      input({
        pages: [
          page('gadget-service', 'Gadget Service', ['Catalog']),
          page('apply-changes', 'Apply Changes (Gadget Service)', ['Catalog', 'Gadget Service']),
          page('gadgetset-object', 'GadgetSet object', ['Data Types']),
          page('overview', 'Working with gadgets', []),
        ],
      }),
    );
    expect(entries.map((entry) => [entry.symbol, entry.symbolKind, entry.qualified])).toEqual([
      ['gadgetService', 'resource', 'Catalog.gadgetService'],
      ['applyChanges', 'operation', 'GadgetService.applyChanges'],
      ['GadgetSet', 'type', undefined],
    ]);
  });
});

describe('symbols: glossary', () => {
  it('lists each term as a term symbol on its glossary page', async () => {
    const records = await recordsOf(documentation());
    expect(recordAt(records, '/glossary/feature-subtype/')).toMatchObject({
      title: 'feature subtype',
      symbol: 'feature subtype',
      symbolKind: 'term',
      kind: 'guide',
      description: 'A feature subtype groups the rows of one table.',
      keywords: ['subtype'],
      breadcrumb: 'Glossary',
    });
    expect(recordAt(records, '/glossary/basemap/').keywords).toBeUndefined();
    // The term without a name and URL is skipped.
    expect(records.filter((record) => record.symbolKind === 'term')).toHaveLength(3);
  });
});

describe('symbols: typedoc', () => {
  it('lists every page of the manifest, qualified by its package', async () => {
    const records = await recordsOf(typedoc());
    expect(recordAt(records, '/toolkit-request/RequestManager/')).toMatchObject({
      title: 'RequestManager',
      symbol: 'RequestManager',
      qualified: '@example/toolkit-request.RequestManager',
      symbolKind: 'type',
      kind: 'api',
      // The site has two trees (guide and API), so the tree's root leads the breadcrumb.
      breadcrumb: 'Documentation > @example/toolkit-request',
    });
    expect(recordAt(records, '/toolkit-request/request/').symbolKind).toBe('function');
    expect(recordAt(records, '/toolkit-request/DEFAULT_TIMEOUT/').symbolKind).toBe('constant');
    expect(recordAt(records, '/toolkit-geocoding/geocode/').qualified).toBe(
      '@example/toolkit-geocoding.geocode',
    );
  });

  it('keeps package and guide pages as plain pages', async () => {
    const records = await recordsOf(typedoc());
    const packagePage = recordAt(records, '/api-reference/toolkit-request/');
    expect(packagePage.title).toBe('@example/toolkit-request');
    expect(packagePage.symbol).toBeUndefined();
    expect(recordAt(records, '/get-started/').kind).toBe('guide');
    expect(new Set(records.map((record) => record.ref)).size).toBe(records.length);
  });

  it('falls back to the navigation tree and the path segment without a manifest', () => {
    const entries = typedocSymbols(
      input({
        nav: [
          { url: `${D}/x/api-reference/pkg/Thing/`, title: 'Thing', crumbs: ['pkg'], root: '' },
          { url: `${D}/x/guide/intro/`, title: 'Intro', crumbs: [], root: '' },
        ],
      }),
    );
    expect(entries).toEqual([
      {
        url: `${D}/x/api-reference/pkg/Thing/`,
        symbol: 'Thing',
        symbolKind: 'type',
        qualified: 'pkg.Thing',
        crumbs: ['pkg'],
      },
    ]);
  });
});

describe('symbols: openapi', () => {
  it('names operations after their slug and builds the path from the nav folders', async () => {
    const records = await recordsOf(openapi());
    expect(recordAt(records, '/beacons/near-point-get/')).toMatchObject({
      title: 'GET /beacons/near-point',
      symbol: 'nearPointGet',
      qualified: 'beacons.nearPointGet',
      symbolKind: 'operation',
      kind: 'api',
      breadcrumb: 'Requests > /beacons',
      locator: { operationId: 'nearPointGet', method: 'get' },
    });
    expect(recordAt(records, '/beacons/beacon-id-get/').title).toBe('GET /beacons/{beaconId}');
    expect(recordAt(records, '/beacons/categories-get/')).toMatchObject({
      title: 'GET /categories',
      symbol: 'categoriesGet',
    });
  });

  it('keeps prose and schema pages as pages', async () => {
    const records = await recordsOf(openapi());
    expect(recordAt(records, '/beacons/types/')).toMatchObject({ title: 'Types' });
    expect(recordAt(records, '/beacons/types/').symbol).toBeUndefined();
    expect(recordAt(records, '/beacons/get-started/').kind).toBe('guide');
  });
});

describe('symbols: apiref-nav', () => {
  it('reads kind and namespace off the navigation tree of the API pages', async () => {
    const records = await recordsOf(apiref());
    expect(recordAt(records, '/api-reference/net/ICenterPoint/')).toMatchObject({
      title: 'ICenterPoint',
      symbol: 'ICenterPoint',
      qualified: 'EXAMPLE.Server.Carto.ICenterPoint',
      symbolKind: 'interface',
      kind: 'api',
      breadcrumb: 'Server SDK Namespaces > EXAMPLE.Server.Carto > Interfaces',
    });
    expect(recordAt(records, '/api-reference/net/CenterPointClass/').symbolKind).toBe('class');
    expect(recordAt(records, '/api-reference/net/esriGadgetType/').symbolKind).toBe('enum');
  });

  it('lists a namespace page as a namespace', async () => {
    const records = await recordsOf(apiref());
    expect(recordAt(records, '/api-reference/net/Carto_library/')).toMatchObject({
      title: 'EXAMPLE.Server.Carto',
      symbol: 'Carto',
      qualified: 'EXAMPLE.Server.Carto',
      symbolKind: 'namespace',
    });
    expect(recordAt(records, '/guide/extend-a-service/').symbol).toBeUndefined();
  });
});

describe('symbols: sphinx-pagination', () => {
  it('lists modules, classes, members and functions with qualified names', async () => {
    const records = await recordsOf(pythonApi());
    expectMembersComplete(records);
    expect(recordAt(records, '/pylib.gis.toc.html')).toMatchObject({
      title: 'pylib.gis module',
      symbol: 'gis',
      qualified: 'pylib.gis',
      symbolKind: 'module',
    });
    expect(recordAt(records, '#pylib.gis.GIS')).toMatchObject({
      title: 'GIS',
      symbol: 'GIS',
      qualified: 'pylib.gis.GIS',
      symbolKind: 'class',
      locator: { anchor: 'pylib.gis.GIS' },
    });
    expect(recordAt(records, '#pylib.gis.GIS').parent).toBeUndefined();
    expect(recordAt(records, '#pylib.gis.GIS.admin')).toMatchObject({
      title: 'GIS.admin',
      symbol: 'admin',
      qualified: 'pylib.gis.GIS.admin',
      parent: 'pylib.gis.GIS',
      symbolKind: 'property',
      breadcrumb: 'GIS',
    });
    expect(recordAt(records, '#pylib.gis.GIS.map')).toMatchObject({
      title: 'GIS.map()',
      symbol: 'map',
      symbolKind: 'method',
      parent: 'pylib.gis.GIS',
    });
    expect(recordAt(records, '.html#geocode')).toMatchObject({
      symbol: 'geocode',
      qualified: 'pylib.geocoding.geocode',
      symbolKind: 'function',
    });
  });

  it('drops heading slugs that repeat a class and headings that are not names', async () => {
    const records = await recordsOf(pythonApi());
    expect(records.some((record) => record.ref.endsWith('#gis'))).toBe(false);
    expect(records.some((record) => record.ref.endsWith('#usage-notes'))).toBe(false);
    expect(records.filter((record) => record.qualified === 'pylib.gis.GIS')).toHaveLength(1);
  });
});

describe('symbols: fuse-store', () => {
  it('lists the types and members the store marks with a page type', async () => {
    const records = await recordsOf(engine());
    expectMembersComplete(records);
    expect(recordAt(records, '/geometry/envelopebuilder/')).toMatchObject({
      title: 'EnvelopeBuilder',
      symbol: 'EnvelopeBuilder',
      qualified: 'Core.Geometry.EnvelopeBuilder',
      symbolKind: 'class',
      kind: 'api',
      breadcrumb: 'Core > Geometry',
    });
    expect(recordAt(records, '#changeaspectratio')).toMatchObject({
      title: 'changeAspectRatio',
      symbol: 'changeAspectRatio',
      qualified: 'Core.Geometry.EnvelopeBuilder.changeAspectRatio',
      parent: 'Core.Geometry.EnvelopeBuilder',
      symbolKind: 'method',
      locator: { anchor: 'changeaspectratio' },
    });
    // No breadcrumb: the owner is read from the `Type.member` description.
    expect(recordAt(records, '#width')).toMatchObject({
      qualified: 'EnvelopeBuilder.width',
      parent: 'EnvelopeBuilder',
      symbolKind: 'property',
    });
  });

  it('does not take prose pages or their headings for symbols', async () => {
    const records = await recordsOf(engine());
    expect(recordAt(records, '/maps/camera/').symbol).toBeUndefined();
    expect(records.some((record) => record.ref.endsWith('#notes'))).toBe(false);
    expect(recordAt(records, '/sample-code/Routing/')).toMatchObject({
      kind: 'sample',
      title: 'Routing',
    });
  });

  it('falls back to the page title, then to no owner, for a member without a path', () => {
    const index = emptyIndex();
    index.store.push(
      { url: '/api/shape/#area', title: 'area', keywords: [], crumbs: [], pageType: 'Property' },
      { url: '/api/other/#size', title: 'size', keywords: [], crumbs: [], pageType: 'Property' },
    );
    const entries = fuseSymbols(
      input({ index, pages: [{ url: `${D}/x/api/shape/`, title: 'Shape', crumbs: [] }] }),
    );
    expect(entries[0]).toMatchObject({ qualified: 'Shape.area', parent: 'Shape' });
    expect(entries[1]?.parent).toBeUndefined();
    expect(entries[1]?.qualified).toBeUndefined();
    expect(entries[1]?.locator).toEqual({ anchor: 'size' });
  });
});
