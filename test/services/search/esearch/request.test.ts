import { describe, expect, it } from 'vitest';
import type { Product } from '../../../../src/core/types.js';
import { kindFromUrl } from '../../../../src/services/search/esearch/provider.js';
import {
  DEFAULT_NUM,
  MAX_NUM,
  PROJECTION,
  bodyJson,
  planRequest,
  type EsearchBody,
  type EsearchPlan,
} from '../../../../src/services/search/esearch/request.js';
import { makeLine, makeProduct, makeSource } from '../../../support/builders.js';
import { aiAgents, jsSdk, kotlinSdk, restApi } from '../../support/catalogue.js';

const line = makeLine();

function plan(product: Product, text = 'offline map', num?: number): EsearchPlan {
  const planned = planRequest(product, product.lines[0] ?? line, text, num);
  if ('skip' in planned) throw new Error(`unexpected skip: ${planned.skip}`);
  return planned;
}

function skip(product: Product, text = 'offline map'): string {
  const planned = planRequest(product, line, text);
  if (!('skip' in planned)) throw new Error('expected a skip');
  return planned.skip;
}

describe('planRequest: developers index', () => {
  it('scopes a product by the URL prefixes of its website sources, outermost only', () => {
    const { body, drop, keep } = plan(jsSdk);
    expect(body).toEqual({
      q: 'offline map',
      index: 'developers_arcgis_v1',
      num: DEFAULT_NUM,
      start: 0,
      partialfields: 'Content-Location:developers%2Earcgis%2Ecom/javascript/latest',
      _source: { includes: [...PROJECTION] },
    });
    expect(keep).toBeUndefined();
    expect(drop?.test('https://developers.arcgis.com/kotlin/v200/offline/')).toBe(true);
    expect(drop?.test('https://developers.arcgis.com/kotlin/offline/')).toBe(false);
  });

  it('ORs several trees and leaves out sources that are not on the website', () => {
    expect(plan(restApi).body.partialfields).toBe(
      'Content-Location:developers%2Earcgis%2Ecom/rest/services-reference/enterprise|Content-Location:developers%2Earcgis%2Ecom/rest/users-groups-and-items',
    );
    expect(plan(kotlinSdk).body.partialfields).toBe(
      'Content-Location:developers%2Earcgis%2Ecom/kotlin',
    );
  });

  it('uses the tree of the requested line and keeps old trees then', () => {
    const lts = kotlinSdk.lines[1] ?? line;
    const planned = planRequest(kotlinSdk, lts, 'offline');
    expect('skip' in planned ? '' : planned.body.partialfields).toBe(
      'Content-Location:developers%2Earcgis%2Ecom/kotlin/v200',
    );
    expect('skip' in planned ? undefined : planned.drop).toBeUndefined();
  });

  it.each([
    ['the Swift API reference', '/swift/api-reference/'],
    ['a versioned Swift API reference', '/swift/v200/api-reference/'],
    ['the Python API reference', '/python/latest/api-reference/'],
    ['the AI pages', '/ai/mcp-arcgis-location-services/'],
    ['another host', 'https://location.arcgis.com/help/'],
    ['the site root', '/'],
  ])('never searches %s', (_name, base) => {
    const product = makeProduct({ sources: [makeSource('gatsby', { base })] });
    expect(skip(product)).toBe('widgets-sdk is not covered by site search');
  });

  it('skips products without website sources and products with too many trees', () => {
    expect(skip(aiAgents)).toContain('not covered');
    const sprawling = makeProduct({
      sources: Array.from({ length: 9 }, (_, i) =>
        makeSource('gatsby', { base: `/tree-${i}/` }, { id: `s${i}`, floor: i === 0 }),
      ),
    });
    expect(skip(sprawling)).toContain('not covered');
  });

  it('cleans the query and clamps the page size', () => {
    expect(plan(jsSdk, '  applyEd*   attachments\n').body.q).toBe('applyEd attachments');
    expect(plan(jsSdk, 'x', 500).body.num).toBe(MAX_NUM);
    expect(plan(jsSdk, 'x', 0).body.num).toBe(1);
    expect(plan(jsSdk, 'x', 7.9).body.num).toBe(7);
    expect(skip(jsSdk, ' * ')).toBe('empty query');
  });
});

describe('planRequest: products with an esearch entry', () => {
  const help = (esearch: Product['esearch']): Product =>
    makeProduct({ id: 'help-product', ...(esearch === undefined ? {} : { esearch }) });

  it('filters a doc.esri.com product by its exact product id in the named index', () => {
    const { body } = plan(
      help({ index: 'esri_docs_main_v1', site: 'esri_docs_main', products: ['arcgis-pro'] }),
    );
    expect(body).toMatchObject({
      index: 'esri_docs_main_v1',
      requiredfields: 'product:arcgis-pro',
    });
    expect(body).not.toHaveProperty('site');
    expect(body).not.toHaveProperty('partialfields');
  });

  it('adds the English filter on multilingual collections and ORs several ids', () => {
    const { body, keep } = plan(
      help({
        site: 'arcgis_doc_col',
        products: ['workforce iphone', 'workforce ipad'],
        keepUrl: '/latest/',
      }),
    );
    expect(body).toMatchObject({
      site: 'arcgis_doc_col',
      requiredfields: '(product:workforce iphone|product:workforce ipad).content-language:en',
    });
    expect(body).not.toHaveProperty('index');
    expect(keep?.test('https://doc.arcgis.com/en/workforce/latest/x.htm')).toBe(true);
  });

  it('adds a URL prefix as a phrase filter and honours dropUrl', () => {
    const { body, drop } = plan(
      help({
        index: 'esri_docs_main_v1',
        products: ['arcgis-pro'],
        urlPrefix: 'https://doc.esri.com/en/arcgis-pro/latest/arcpy/',
        dropUrl: '/tool-reference/',
      }),
    );
    expect(body.partialfields).toBe('Content-Location:doc%2Eesri%2Ecom/en/arcgis-pro/latest/arcpy');
    expect(drop?.source).toBe('\\/tool-reference\\/');
  });

  it('refuses to send when the filter cannot be proven well-formed', () => {
    expect(skip(help({ index: 'esri_docs_main_v1', products: ['bad|id'] }))).toContain('reserves');
    expect(skip(help({ index: 'esri_docs_main_v1' }))).toContain('no filter that scopes');
    expect(skip(help({ index: 'esri_docs_main_v1', urlPrefix: 'not a url' }))).toContain(
      'host name',
    );
  });

  it('ignores an invalid post-filter pattern and an entry without a scope', () => {
    const { keep } = plan(help({ index: 'esri_docs_main_v1', products: ['x'], keepUrl: '(' }));
    expect(keep).toBeUndefined();
    // No index and no site: treated like a product without an entry.
    expect(plan(help({ products: ['x'] })).body.index).toBe('developers_arcgis_v1');
  });
});

describe('bodyJson', () => {
  it('sorts keys so equal requests are one cache entry', () => {
    const body: EsearchBody = { q: 'a', num: 1, start: 0, index: 'i', _source: { includes: [] } };
    expect(bodyJson(body)).toBe(
      '{"_source":{"includes":[]},"index":"i","num":1,"q":"a","start":0}',
    );
  });
});

describe('kindFromUrl', () => {
  it.each([
    ['https://developers.arcgis.com/javascript/latest/references/core/Map/', 'api'],
    ['https://developers.arcgis.com/kotlin/api-reference/x/', 'api'],
    ['https://developers.arcgis.com/javascript/latest/sample-code/x/', 'sample'],
    ['https://developers.arcgis.com/kotlin/samples/x/', 'sample'],
    ['https://developers.arcgis.com/javascript/latest/tutorials/x/', 'tutorial'],
    ['https://developers.arcgis.com/kotlin/release-notes/300/', 'release-notes'],
    ['https://developers.arcgis.com/kotlin/offline/', 'guide'],
  ])('%s is %s', (url, kind) => {
    expect(kindFromUrl(url, 'guide')).toBe(kind);
  });
});
