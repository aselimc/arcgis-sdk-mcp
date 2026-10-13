import { describe, expect, it } from 'vitest';
import { McpDocError } from '../../../../src/core/errors.js';
import type { Product } from '../../../../src/core/types.js';
import {
  MIN_INTERVAL_MS,
  RETRY_DELAY_MS,
  coveredBySiteSearch,
  createEsearchProvider,
} from '../../../../src/services/search/esearch/provider.js';
import { ESEARCH_URL, type EsearchBody } from '../../../../src/services/search/esearch/request.js';
import { makeLine, makeProduct, makeSource } from '../../../support/builders.js';
import { fakePolicy } from '../../../support/fake-policy.js';
import { fakeRegistry } from '../../../support/fake-registry.js';
import { makeCall, makeCtx, type TestCtx } from '../../../support/make-ctx.js';
import { aiAgents, jsSdk, kotlinSdk } from '../../support/catalogue.js';

const line = makeLine();

describe('site-search provider', () => {
  const hit = (path: string, score: number, extra: object = {}) => ({
    score,
    doc: { url: `https://developers.arcgis.com${path}`, title: `Title of ${path}`, ...extra },
  });

  function setup(enabled = true): {
    ctx: TestCtx;
    slept: number[];
    provider: ReturnType<typeof createEsearchProvider>;
  } {
    const ctx = makeCtx({
      registry: fakeRegistry({ products: [jsSdk, kotlinSdk, aiAgents] }),
      policy: fakePolicy({
        enabled: enabled ? ['website', 'site-index', 'site-search'] : ['website'],
      }),
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
  const query = (products: Product[], limit = 10) => ({
    text: 'offline map',
    products,
    line: 'latest',
    limit,
  });

  it('does nothing while the capability is off', async () => {
    const { ctx, provider } = setup(false);
    expect(await provider.search(query([jsSdk]), makeCall(ctx))).toEqual([]);
    expect(ctx.http.requests).toEqual([]);
    expect(coveredBySiteSearch(ctx, jsSdk, line)).toBe(false);
  });

  it('posts JSON with the projection, the remote-search TTL and the call budget', async () => {
    const { ctx, provider } = setup();
    ctx.http.on(
      ESEARCH_URL,
      { json: { search: { hits: [hit('/javascript/latest/offline/', 5)] } } },
      'POST',
    );
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
              hit('/kotlin/offline-maps/', 9, {
                title: 'Offline maps | Sample | Widgets SDK for Kotlin',
              }),
              hit('/kotlin/offline-maps/index.html?highlight=x#top', 8),
              hit('/kotlin/v200/offline-maps/', 7),
              hit('/javascript/latest/offline/', 6),
              hit('/kotlin/api-reference/pkg/-cls/', 5, { title: '  ', description: ' A class. ' }),
              { score: 4, doc: { url: 42 } },
              { score: 3 },
              {
                doc: { url: 'https://developers.arcgis.com/kotlin/samples/x/' },
                highlight: { content: ['<b>Offline</b> sample'] },
              },
            ],
          },
        },
      },
      'POST',
    );
    const hits = await provider.search(query([kotlinSdk]), makeCall(ctx));
    expect(
      hits.map((entry) => [
        entry.ref.replace('https://developers.arcgis.com', ''),
        entry.kind,
        entry.source,
      ]),
    ).toEqual([
      ['/kotlin/offline-maps/', 'guide', 'guide'],
      ['/kotlin/api-reference/pkg/-cls/', 'api', 'api'],
      ['/kotlin/samples/x/', 'sample', 'guide'],
    ]);
    // The site name that the page title carries is not part of the title.
    expect(hits[0]?.title).toBe('Offline maps');
    expect(hits[1]).toMatchObject({ title: 'Cls', excerpt: 'A class.' });
    expect(hits[2]).toMatchObject({ excerpt: 'Offline sample', score: 0 });
  });

  it('drops results from trees it must not be used for, and knows which sources it covers', async () => {
    const swift = makeProduct({
      id: 'swift-like',
      sources: [
        makeSource('gatsby', { base: '/swift/', exclude: ['^api-reference/'] }),
        makeSource(
          'docc',
          { base: '/swift/api-reference/' },
          { id: 'api', kinds: ['api'], floor: false },
        ),
        makeSource(
          'github-repo',
          { repo: 'Esri/x', preset: 'samples-readme' },
          { id: 'samples', floor: false, capability: 'github' },
        ),
      ],
    });
    const ctx = makeCtx({
      registry: fakeRegistry({ products: [swift] }),
      policy: fakePolicy({ enabled: ['website', 'site-search'] }),
    });
    ctx.http.on(
      ESEARCH_URL,
      {
        json: {
          search: {
            hits: [
              hit('/swift/api-reference/documentation/arcgis/map/', 9),
              hit('/swift/offline/', 5),
            ],
          },
        },
      },
      'POST',
    );
    const provider = createEsearchProvider(ctx, { sleep: async () => undefined });
    const hits = await provider.search(
      { text: 'offline', products: [swift], line: 'latest', limit: 10 },
      makeCall(ctx),
    );
    expect(hits.map((entry) => entry.ref)).toEqual([
      'https://developers.arcgis.com/swift/offline/',
    ]);
    expect((JSON.parse(ctx.http.requests[0]?.body ?? '{}') as EsearchBody).partialfields).toBe(
      'Content-Location:developers%2Earcgis%2Ecom/swift',
    );

    expect(coveredBySiteSearch(ctx, swift, line)).toBe(true);
    expect(coveredBySiteSearch(ctx, swift, line, ['guide'])).toBe(true);
    expect(coveredBySiteSearch(ctx, swift, line, ['api'])).toBe(false);
    expect(coveredBySiteSearch(ctx, swift, line, ['samples', 'api'])).toBe(false);
    const help = makeProduct({ esearch: { index: 'esri_docs_main_v1', products: ['x'] } });
    expect(coveredBySiteSearch(ctx, help, line, ['guide'])).toBe(true);
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
    expect(
      ctx.http.requests.map((request) => (JSON.parse(request.body ?? '{}') as EsearchBody).num),
    ).toEqual([20, 10]);
    expect(slept).toContain(RETRY_DELAY_MS);
  });

  it('never halves below five and gives up after the second failure', async () => {
    const { ctx, provider } = setup();
    ctx.http
      .on(ESEARCH_URL, { json: { search: { hits: [] } } }, 'POST')
      .fail(ESEARCH_URL, 'timeout');
    expect(await provider.search(query([jsSdk], 6), makeCall(ctx))).toEqual([]);
    expect(
      ctx.http.requests.map((request) => (JSON.parse(request.body ?? '{}') as EsearchBody).num),
    ).toEqual([6, 5]);
    expect(ctx.logger.messages('warn')).toEqual(['site search failed; local indexes answer alone']);
  });

  it.each([
    ['a refusal', new McpDocError('UPSTREAM_BLOCKED', 'refused', { retryable: false })],
    [
      'a syntax-error signature',
      new McpDocError('UPSTREAM_UNAVAILABLE', 'HTTP 500', {
        why: 'request.sort.split is not a function',
        retryable: true,
      }),
    ],
    [
      'an oversized body',
      new McpDocError('UPSTREAM_UNAVAILABLE', 'too large', { retryable: false }),
    ],
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
    [
      'an error object with HTTP 200',
      { error: { message: 'Endpoint execution error', detail: 'boom' }, search: { hits: [] } },
    ],
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
    ctx.http
      .on(ESEARCH_URL, { json: { search: { hits: [hit('/javascript/latest/a/', 1)] } } }, 'POST')
      .fail(ESEARCH_URL, 403);
    for (let attempt = 0; attempt < 3; attempt++)
      await provider.search(query([jsSdk]), makeCall(ctx));
    expect(ctx.http.count()).toBe(3);

    await provider.search(query([jsSdk]), makeCall(ctx));
    expect(ctx.http.count()).toBe(3);

    ctx.http.heal();
    ctx.clock.advance(5 * 60 * 1000);
    expect(await provider.search(query([jsSdk]), makeCall(ctx))).toHaveLength(1);
  });

  it('skips products it has no request for and uses the current line for an unknown one', async () => {
    const { ctx, provider } = setup();
    ctx.http.on(
      ESEARCH_URL,
      { json: { search: { hits: [hit('/kotlin/offline-maps/', 1)] } } },
      'POST',
    );
    const hits = await provider.search(
      { ...query([aiAgents, kotlinSdk]), line: 'no-such-line' },
      makeCall(ctx),
    );
    expect(hits).toHaveLength(1);
    expect(ctx.http.count()).toBe(1);
    expect(ctx.logger.messages('debug')).toEqual(['site search skipped']);
  });
});
