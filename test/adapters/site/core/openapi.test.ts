import { describe, expect, it } from 'vitest';
import {
  extractEmbeddedSpec,
  listOperations,
  openapiAdapter,
} from '../../../../src/adapters/site/openapi.js';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import type { RendererInputs } from '../../../../src/core/ports.js';
import type { CatalogRecord } from '../../../../src/core/types.js';
import { makeLine, makeProduct, makeSource } from '../../../support/builders.js';
import { loadCassette, readFixture } from '../../../support/fixtures.js';
import { makeCtx, type TestCtx } from '../../../support/make-ctx.js';
import { describeSiteAdapterContract, rendererOf, replaceResponses } from '../contract.js';

const EVENTS = 'https://hub.arcgis.com/api/events/v1/docs-json';
const FEED = 'https://hub.arcgis.com/api/feed/definition/swagger-ui-init.js';
const SCAN = 'https://sitescan-api.arcgis.com/api/v2/apidocs.json';

const api = makeSource(
  'openapi',
  { specs: [EVENTS, { url: FEED, embedded: true }, SCAN] },
  {
    id: 'api',
    title: 'Service APIs',
    kinds: ['api'],
    probe: { url: EVENTS, expect: 'json', minRecords: 2 },
  },
);
const product = makeProduct({ id: 'hub-dev', name: 'Hub developer APIs', sources: [api] });
const cassette = () => loadCassette('cassettes', 'site', 'core', 'openapi.json');
const ctxOf = (): TestCtx => makeCtx({ cassette: cassette() });
const bound = () => bindSource(product, api, makeLine());
const byRef = (records: CatalogRecord[]) => new Map(records.map((record) => [record.ref, record]));
const lastInput = (ctx: TestCtx) =>
  rendererOf(ctx).calls.at(-1)?.input as RendererInputs['openapi'];

describeSiteAdapterContract('openapi (published documents)', () => ({
  adapter: openapiAdapter,
  product,
  source: api,
  ctx: ctxOf,
  allowedHosts: ['hub.arcgis.com', 'sitescan-api.arcgis.com'],
  minRecords: 14,
  readRef: `${EVENTS}#getEvents`,
  failures: {
    renamedField: {
      // One document loses its "paths" member; the other two still answer.
      arrange: (ctx) =>
        replaceResponses(ctx, cassette(), { [EVENTS]: { json: { openapi: '3.0.0', routes: {} } } }),
      outcome: 'degraded',
      minRecords: 6,
    },
    missingFile: {
      arrange: (ctx) => ctx.http.fail(/.*/, 404),
      outcome: 'typed-failure',
      codes: ['DOC_NOT_FOUND'],
    },
    emptyIndex: {
      arrange: (ctx) =>
        replaceResponses(ctx, cassette(), {
          [EVENTS]: { json: {} },
          [FEED]: { body: 'var options = {};' },
          [SCAN]: { json: [] },
        }),
      outcome: 'typed-failure',
      codes: ['UPSTREAM_UNAVAILABLE'],
    },
    htmlInsteadOfJson: {
      arrange: (ctx) => ctx.http.fail(/.*/, 'html'),
      outcome: 'typed-failure',
      codes: ['DOC_NOT_FOUND'],
    },
  },
}));

describe('openapi: enumerate', () => {
  it('lists each document, its operations and its schemas', async () => {
    const ctx = ctxOf();
    const records = await openapiAdapter.enumerate!(ctx, bound());

    expect(records.map((record) => record.ref)).toEqual([
      EVENTS,
      `${EVENTS}#getEvents`,
      `${EVENTS}#createEvent`,
      `${EVENTS}#getEvent`,
      `${EVENTS}#deleteEvent`,
      `${EVENTS}#/components/schemas/Event`,
      `${EVENTS}#/components/schemas/EventList`,
      FEED,
      `${FEED}#getRssFeed`,
      `${FEED}#getCatalogFeed`,
      `${FEED}#/definitions/Catalog`,
      SCAN,
      `${SCAN}#list-projects`,
      `${SCAN}#list-projects-post`,
      `${SCAN}#get-apiv2missionsid`,
    ]);
    expect(ctx.http.count()).toBe(3);
    expect(ctx.http.requests.map((request) => request.expect)).toEqual(['json', 'text', 'json']);
  });

  it('describes the document, an operation and a schema', async () => {
    const records = byRef(await openapiAdapter.enumerate!(ctxOf(), bound()));

    expect(records.get(EVENTS)).toMatchObject({
      kind: 'api',
      title: 'Widget Events Service 0.0.1',
      description: 'Create and list widget events.',
    });
    expect(records.get(`${EVENTS}#getEvents`)).toEqual({
      ref: `${EVENTS}#getEvents`,
      product: 'hub-dev',
      source: 'api',
      line: 'latest',
      kind: 'api',
      title: 'List events',
      symbol: 'getEvents',
      qualified: '/api/events/v1/events',
      symbolKind: 'operation',
      breadcrumb: 'Widget Events Service > Events',
      description: 'GET /api/events/v1/events',
      keywords: ['GET', 'Events', 'Public'],
      locator: { spec: EVENTS, method: 'get', path: '/api/events/v1/events' },
      license: 'esri-website-terms',
    });
    expect(records.get(`${EVENTS}#/components/schemas/Event`)).toMatchObject({
      title: 'Event',
      symbol: 'Event',
      symbolKind: 'type',
      breadcrumb: 'Widget Events Service > Schemas',
      description: 'A scheduled widget event.',
    });
    expect(records.get(`${EVENTS}#/components/schemas/EventList`)?.description).toBeUndefined();
  });

  it('titles an operation without a summary from its description, then its method and path', async () => {
    const records = byRef(await openapiAdapter.enumerate!(ctxOf(), bound()));
    expect(records.get(`${EVENTS}#getEvent`)).toMatchObject({
      title: 'Returns one event by its id.',
      breadcrumb: 'Widget Events Service',
      keywords: ['GET'],
    });
    expect(records.get(`${SCAN}#get-apiv2missionsid`)?.title).toBe('GET /api/v2/missions/{id}');
    expect(records.get(`${EVENTS}#deleteEvent`)?.deprecated).toBe(true);
    expect(records.get(`${EVENTS}#getEvents`)?.deprecated).toBeUndefined();
  });

  it('continues with the other documents when one cannot be read', async () => {
    const ctx = ctxOf();
    ctx.http.fail(FEED, 503);
    const records = await openapiAdapter.enumerate!(ctx, bound());
    expect(records.filter((record) => record.ref.startsWith(FEED))).toEqual([]);
    expect(records).toHaveLength(11);
    expect(ctx.logger.messages('warn')).toEqual([
      `OpenAPI document ${FEED} is unavailable; enumerating without it`,
    ]);
  });

  it('answers LINK_ONLY on a link-only line', async () => {
    const ctx = ctxOf();
    const src = bindSource(product, api, makeLine({ access: 'link-only' }));
    await expect(openapiAdapter.enumerate!(ctx, src)).rejects.toMatchObject({ code: 'LINK_ONLY' });
    expect(ctx.http.count()).toBe(0);
  });

  it('lists nothing for a source without documents', async () => {
    const none = makeSource('openapi', { specs: [] });
    const src = bindSource(makeProduct({ sources: [none] }), none, makeLine());
    expect(await openapiAdapter.enumerate!(makeCtx(), src)).toEqual([]);
  });
});

describe('openapi: document parsing', () => {
  it('cuts the embedded document out of a Swagger UI script without evaluating it', () => {
    const script = readFixture('cassettes', 'site', 'core', 'swagger-ui-init.js');
    expect(extractEmbeddedSpec(script)).toMatchObject({
      swagger: '2.0',
      info: { title: 'Widget Feed API' },
      definitions: { Catalog: { type: 'object' } },
    });
  });

  it.each([
    ['no marker', 'var options = { "spec": {} };'],
    ['no object after the marker', 'var options = { "swaggerDoc": null };'],
    ['an unbalanced object', 'var options = { "swaggerDoc": { "paths": { "/a": {} } '],
    ['an object that is not JSON', 'var options = { "swaggerDoc": { paths: {} } };'],
  ])('finds nothing in a script with %s', (_, script) => {
    expect(extractEmbeddedSpec(script)).toBeUndefined();
  });

  it('merges path-level parameters into each operation', () => {
    const [operation] = listOperations({
      paths: {
        '/things/{id}': {
          parameters: [{ name: 'id', in: 'path' }],
          get: { operationId: 'getThing', parameters: [{ name: 'expand', in: 'query' }] },
        },
      },
    });
    expect(operation).toEqual({
      key: 'getThing',
      method: 'get',
      path: '/things/{id}',
      operation: {
        operationId: 'getThing',
        parameters: [
          { name: 'id', in: 'path' },
          { name: 'expand', in: 'query' },
        ],
      },
    });
  });

  it('keeps keys unique when summaries repeat', () => {
    const same = { summary: 'Do it' };
    const keys = listOperations({
      paths: { '/a': { get: same, post: same }, '/b': { post: same }, '/c': { post: same } },
    }).map((operation) => operation.key);
    expect(keys).toEqual(['do-it', 'do-it-post', 'do-it-post-2', 'do-it-post-3']);
    expect(listOperations({})).toEqual([]);
  });
});

describe('openapi: read', () => {
  it('hands the renderer one operation, addressed by its operation id', async () => {
    const ctx = ctxOf();
    const page = await openapiAdapter.read(ctx, bound(), {
      url: new URL(`${EVENTS}#getEvent`),
      detail: 'summary',
    });

    expect(page).toMatchObject({
      ref: `${EVENTS}#getEvent`,
      url: EVENTS,
      kind: 'api',
      product: 'hub-dev',
      source: 'api',
      version: '0.0.1',
    });
    expect(rendererOf(ctx).calls[0]).toMatchObject({
      kind: 'openapi',
      opts: { detail: 'summary' },
    });
    expect(lastInput(ctx).target).toBe('getEvent');
    expect(lastInput(ctx).operation).toMatchObject({
      operationId: 'getEvent',
      method: 'get',
      path: '/api/events/v1/events/{id}',
      parameters: [{ name: 'id' }, { name: 'expand' }],
    });
    expect(lastInput(ctx).spec).toMatchObject({ openapi: '3.0.0' });
  });

  it('finds an operation of a document without operation ids by the slug of its summary', async () => {
    const ctx = ctxOf();
    await openapiAdapter.read(ctx, bound(), { url: new URL(`${SCAN}#List-Projects`) });
    expect(lastInput(ctx)).toMatchObject({ target: 'list-projects', operation: { method: 'get' } });

    await openapiAdapter.read(ctx, bound(), { url: new URL(`${SCAN}#list-projects-post`) });
    expect(lastInput(ctx)).toMatchObject({
      target: 'list-projects-post',
      operation: { method: 'post' },
    });
  });

  it('hands the renderer one schema for a JSON-pointer fragment, from either container', async () => {
    const ctx = ctxOf();
    await openapiAdapter.read(ctx, bound(), {
      url: new URL(`${EVENTS}#/components/schemas/Event`),
    });
    expect(lastInput(ctx)).toMatchObject({
      target: 'Event',
      schemas: { Event: { type: 'object' } },
    });

    await openapiAdapter.read(ctx, bound(), { url: new URL(`${FEED}#/definitions/Catalog`) });
    expect(lastInput(ctx)).toMatchObject({ target: 'Catalog', schemas: { Catalog: {} } });
    expect(ctx.http.requests.at(-1)).toMatchObject({ url: FEED, expect: 'text' });
  });

  it('renders the whole document for no fragment and for one that names nothing', async () => {
    const ctx = ctxOf();
    for (const ref of [
      EVENTS,
      `${EVENTS}#noSuchOperation`,
      `${EVENTS}#/components/schemas/Nope`,
      `${EVENTS}#%E0%A4%A`,
    ]) {
      await openapiAdapter.read(ctx, bound(), { url: new URL(ref) });
      expect(Object.keys(lastInput(ctx))).toEqual(['spec']);
    }
  });

  it('refuses a URL that is not one of its documents, naming them', async () => {
    const ctx = ctxOf();
    await expect(
      openapiAdapter.read(ctx, bound(), {
        url: new URL('https://hub.arcgis.com/api/other/docs-json'),
      }),
    ).rejects.toMatchObject({
      code: 'DOC_NOT_FOUND',
      details: { candidates: [EVENTS, FEED, SCAN], host: 'hub.arcgis.com' },
    });
    expect(ctx.http.count()).toBe(0);
  });

  it('reports a document that lost its shape as a typed failure', async () => {
    const ctx = ctxOf();
    replaceResponses(ctx, cassette(), { [FEED]: { body: 'window.onload = function () {};' } });
    await expect(openapiAdapter.read(ctx, bound(), { url: new URL(FEED) })).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      details: { url: FEED, retryable: false, why: 'The script holds no "swaggerDoc" object' },
    });
  });
});

describe('openapi: probe', () => {
  it('counts the paths of a JSON document', async () => {
    expect(await openapiAdapter.probe(ctxOf(), bound())).toMatchObject({ ok: true, records: 3 });
  });

  it('counts the paths of an embedded document fetched as text', async () => {
    const embedded = {
      ...api,
      probe: { url: FEED, expect: 'text' as const, mustContain: 'swaggerDoc', minRecords: 2 },
    };
    const result = await openapiAdapter.probe(ctxOf(), bindSource(product, embedded, makeLine()));
    expect(result).toMatchObject({ ok: true, records: 2 });
  });

  it('fails when a text canary holds no document', async () => {
    const ctx = ctxOf();
    replaceResponses(ctx, cassette(), { [FEED]: { body: 'var options = {};' } });
    const embedded = { ...api, probe: { url: FEED, expect: 'text' as const, minRecords: 1 } };
    const result = await openapiAdapter.probe(ctx, bindSource(product, embedded, makeLine()));
    expect(result).toMatchObject({ ok: false, error: 'Expected at least 1 records, found 0' });
  });
});
