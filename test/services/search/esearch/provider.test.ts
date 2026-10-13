import { describe, expect, it } from 'vitest';
import { McpDocError } from '../../../../src/core/errors.js';
import type { Product } from '../../../../src/core/types.js';
import {
  MIN_INTERVAL_MS,
  RETRY_DELAY_MS,
  coveredBySiteSearch,
  createEsearchProvider,
  kindFromUrl,
} from '../../../../src/services/search/esearch/provider.js';
import {
  DEFAULT_NUM,
  ESEARCH_URL,
  MAX_NUM,
  PROJECTION,
  bodyJson,
  planRequest,
  type EsearchBody,
  type EsearchPlan,
} from '../../../../src/services/search/esearch/request.js';
import { makeLine, makeProduct, makeSource } from '../../../support/builders.js';
import { fakePolicy } from '../../../support/fake-policy.js';
import { fakeRegistry } from '../../../support/fake-registry.js';
import { makeCall, makeCtx, type TestCtx } from '../../../support/make-ctx.js';
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
    expect(plan(kotlinSdk).body.partialfields).toBe('Content-Location:developers%2Earcgis%2Ecom/kotlin');
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
    const { body } = plan(help({ index: 'esri_docs_main_v1', site: 'esri_docs_main', products: ['arcgis-pro'] }));
    expect(body).toMatchObject({ index: 'esri_docs_main_v1', requiredfields: 'product:arcgis-pro' });
    expect(body).not.toHaveProperty('site');
    expect(body).not.toHaveProperty('partialfields');
  });

  it('adds the English filter on multilingual collections and ORs several ids', () => {
    const { body, keep } = plan(
      help({ site: 'arcgis_doc_col', products: ['workforce iphone', 'workforce ipad'], keepUrl: '/latest/' }),
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
    expect(skip(help({ index: 'esri_docs_main_v1', urlPrefix: 'not a url' }))).toContain('host name');
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
    expect(bodyJson(body)).toBe('{"_source":{"includes":[]},"index":"i","num":1,"q":"a","start":0}');
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

describe('site-search provider', () => {
  const hit = (path: string, score: number, extra: object = {}) => ({
    score,
    doc: { url: `https://developers.arcgis.com${path}`, title: `Title of ${path}`, ...extra },
  });

  function setup(enabled = true): { ctx: TestCtx; slept: number[]; provider: ReturnType<typeof createEsearchProvider> } {
    const ctx = makeCtx({
      registry: fakeRegistry({ products: [jsSdk, kotlinSdk, aiAgents] }),
      policy: fakePolicy({ enabled: enabled ? ['website', 'site-index', 'site-search'] : ['website'] }),
    });
    const slept: number[] = [];
    const provider = createEsearchProvider(ctx, {
      sleep: async (ms) => {
        slept.push(ms);
        ctx.clock.advance(ms);
      },
    });
    return { ctx, slept, provider };
  }
  const query = (products: Product[], limit = 10) => ({ text: 'offline map', products, line: 'latest', limit });

  it('does nothing while the capability is off', async () => {
    const { ctx, provider } = setup(false);
    expect(await provider.search(query([jsSdk]), makeCall(ctx))).toEqual([]);
    expect(ctx.http.requests).toEqual([]);
    expect(coveredBySiteSearch(ctx, jsSdk, line)).toBe(false);
  });

  it('posts JSON with the projection, the remote-search TTL and the call budget', async () => {
    const { ctx, provider } = setup();
    ctx.http.on(ESEARCH_URL, { json: { search: { hits: [hit('/javascript/latest/offline/', 5)] } } }, 'POST');
    const call = makeCall(ctx);
    const hits = await provider.search(query([jsSdk]), call);
    expect(hits).toEqual([
      expect.objectContaining({
        ref: 'https://developers.arcgis.com/javascript/latest/offline/',
        title: 'Title of /javascript/latest/offline/',
        product: 'js-maps-sdk',
        source: 'guide',
        line: 'latest',
        kind: 'guide',
        match: 'site',
        score: 5,
        license: 'esri-website-terms',
      }),
    ]);
    const [request] = ctx.http.requests;
    expect(request).toMatchObject({
      method: 'POST',
      url: ESEARCH_URL,
      expect: 'json',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
    });
    expect(call.budget.used).toBe(1);
    expect(coveredBySiteSearch(ctx, jsSdk, line)).toBe(true);
    expect(coveredBySiteSearch(ctx, aiAgents, line)).toBe(false);
  });

  it('post-filters hits: other products, old trees, duplicates and junk', async () => {
    const { ctx, provider } = setup();
    ctx.http.on(
      ESEARCH_URL,
      {
        json: {
          search: {
            hits: [
              hit('/kotlin/offline-maps/', 9),
              hit('/kotlin/offline-maps/index.html?highlight=x#top', 8),
              hit('/kotlin/v200/offline-maps/', 7),
              hit('/javascript/latest/offline/', 6),
              hit('/kotlin/api-reference/pkg/-cls/', 5, { title: '  ', description: ' A class. ' }),
              { score: 4, doc: { url: 42 } },
              { score: 3 },
              { doc: { url: 'https://developers.arcgis.com/kotlin/samples/x/' }, highlight: { content: ['<b>Offline</b> sample'] } },
            ],
          },
        },
      },
      'POST',
    );
    const hits = await provider.search(query([kotlinSdk]), makeCall(ctx));
    expect(hits.map((entry) => [entry.ref.replace('https://developers.arcgis.com', ''), entry.kind, entry.source])).toEqual([
      ['/kotlin/offline-maps/', 'guide', 'guide'],
      ['/kotlin/api-reference/pkg/-cls/', 'api', 'api'],
      ['/kotlin/samples/x/', 'sample', 'guide'],
    ]);
    expect(hits[1]).toMatchObject({ title: 'Cls', excerpt: 'A class.' });
    expect(hits[2]).toMatchObject({ excerpt: 'Offline sample', score: 0 });
  });

  it('keeps requests at least a second apart and one at a time', async () => {
    const { ctx, slept, provider } = setup();
    ctx.http.on(ESEARCH_URL, { json: { search: { hits: [] } } }, 'POST');
    await provider.search(query([jsSdk, kotlinSdk]), makeCall(ctx));
    expect(ctx.http.count()).toBe(2);
    expect(slept).toEqual([MIN_INTERVAL_MS]);

    ctx.clock.advance(5 * MIN_INTERVAL_MS);
    await provider.search(query([jsSdk]), makeCall(ctx));
    expect(slept).toEqual([MIN_INTERVAL_MS]);
  });

  it('retries a transient failure once with half the page size', async () => {
    const { ctx, slept, provider } = setup();
    ctx.http
      .on(ESEARCH_URL, { json: { search: { hits: [hit('/javascript/latest/a/', 1)] } } }, 'POST')
      .fail(ESEARCH_URL, 503, { times: 1 });
    const hits = await provider.search(query([jsSdk], 20), makeCall(ctx));
    expect(hits).toHaveLength(1);
    expect(ctx.http.requests.map((request) => (JSON.parse(request.body ?? '{}') as EsearchBody).num)).toEqual([20, 10]);
    expect(slept).toContain(RETRY_DELAY_MS);
  });

  it('never halves below five and gives up after the second failure', async () => {
    const { ctx, provider } = setup();
    ctx.http.on(ESEARCH_URL, { json: { search: { hits: [] } } }, 'POST').fail(ESEARCH_URL, 'timeout');
    expect(await provider.search(query([jsSdk], 6), makeCall(ctx))).toEqual([]);
    expect(ctx.http.requests.map((request) => (JSON.parse(request.body ?? '{}') as EsearchBody).num)).toEqual([6, 5]);
    expect(ctx.logger.messages('warn')).toEqual(['site search failed; local indexes answer alone']);
  });

  it.each([
    ['a refusal', new McpDocError('UPSTREAM_BLOCKED', 'refused', { retryable: false })],
    ['a syntax-error signature', new McpDocError('UPSTREAM_UNAVAILABLE', 'HTTP 500', { why: 'request.sort.split is not a function', retryable: true })],
    ['an oversized body', new McpDocError('UPSTREAM_UNAVAILABLE', 'too large', { retryable: false })],
    ['offline mode', new McpDocError('OFFLINE_MISS', 'offline')],
  ])('does not retry %s', async (_name, error) => {
    const { ctx, provider } = setup();
    ctx.http.on(
      ESEARCH_URL,
      () => {
        throw error;
      },
      'POST',
    );
    expect(await provider.search(query([jsSdk]), makeCall(ctx))).toEqual([]);
    expect(ctx.http.count()).toBe(1);
  });

  it('does not retry when the call budget is spent', async () => {
    const { ctx, provider } = setup();
    ctx.http.on(ESEARCH_URL, { json: { search: { hits: [] } } }, 'POST').fail(ESEARCH_URL, 500);
    const call = makeCall(ctx);
    call.budget.maxRequests = 1;
    expect(await provider.search(query([jsSdk]), call)).toEqual([]);
    expect(ctx.http.count()).toBe(1);
  });

  it.each([
    ['an error object with HTTP 200', { error: { message: 'Endpoint execution error', detail: 'boom' }, search: { hits: [] } }],
    ['an error without detail', { error: { message: 'Endpoint execution error' } }],
    ['a body without hits', { search: { count: 3 } }],
    ['an empty object', {}],
  ])('treats %s as a failure', async (_name, json) => {
    const { ctx, provider } = setup();
    ctx.http.on(ESEARCH_URL, { json }, 'POST');
    expect(await provider.search(query([jsSdk]), makeCall(ctx))).toEqual([]);
    expect(ctx.http.count()).toBe(1);
    expect(ctx.logger.messages('warn')).toHaveLength(1);
  });

  it('stops asking for five minutes after three consecutive failures', async () => {
    const { ctx, provider } = setup();
    ctx.http.on(ESEARCH_URL, { json: { search: { hits: [hit('/javascript/latest/a/', 1)] } } }, 'POST').fail(ESEARCH_URL, 403);
    for (let attempt = 0; attempt < 3; attempt++) await provider.search(query([jsSdk]), makeCall(ctx));
    expect(ctx.http.count()).toBe(3);

    await provider.search(query([jsSdk]), makeCall(ctx));
    expect(ctx.http.count()).toBe(3);

    ctx.http.heal();
    ctx.clock.advance(5 * 60 * 1000);
    expect(await provider.search(query([jsSdk]), makeCall(ctx))).toHaveLength(1);
  });

  it('skips products it has no request for and uses the current line for an unknown one', async () => {
    const { ctx, provider } = setup();
    ctx.http.on(ESEARCH_URL, { json: { search: { hits: [hit('/kotlin/offline-maps/', 1)] } } }, 'POST');
    const hits = await provider.search({ ...query([aiAgents, kotlinSdk]), line: 'no-such-line' }, makeCall(ctx));
    expect(hits).toHaveLength(1);
    expect(ctx.http.count()).toBe(1);
    expect(ctx.logger.messages('debug')).toEqual(['site search skipped']);
  });
});
