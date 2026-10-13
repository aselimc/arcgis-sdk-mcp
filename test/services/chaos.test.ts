import { describe, expect, it } from 'vitest';
import { McpDocError } from '../../src/core/errors.js';
import type { Services } from '../../src/core/ports.js';
import { createServices } from '../../src/services/index.js';
import type { IndexInternals } from '../../src/services/index/types.js';
import { makeProduct, makeSource } from '../support/builders.js';
import { HOUR } from '../support/fake-clock.js';
import type { Fault, RecordedResponse } from '../support/fake-http.js';
import { fakeRegistry } from '../support/fake-registry.js';
import { makeCall, makeCtx, type TestCtx } from '../support/make-ctx.js';
import { adapterRegistry } from './support/test-adapter.js';
import { fakeVersions } from './support/harness.js';
import { HttpAdapter, type IndexFile } from './support/http-adapter.js';

/**
 * Chaos suite (design section 10): the services run over an adapter that really uses the
 * HTTP port, and faults are injected into that port. For every fault the suite asserts the
 * rung that answered, that the call did not fail, that a good index was not replaced by a
 * worse one, and that stale content is labelled.
 */

const BASE = 'https://developers.arcgis.com/widgets/';
const INDEX_URL = `${BASE}index.json`;
const PAGE_URL = `${BASE}resize/`;

const product = makeProduct({
  startHere: [{ title: 'Start with widgets', ref: `${BASE}start/` }],
  sources: [makeSource('gatsby', { base: '/widgets/' }, { kinds: ['guide', 'api'] })],
});

const INDEX: IndexFile = {
  pages: [
    { path: 'resize/', title: 'Resize a widget' },
    { path: 'theme/', title: 'Theme a widget' },
    { path: 'api/Widget/', title: 'Widget', symbol: 'Widget' },
    { path: 'layout/', title: 'Lay out widgets' },
  ],
};

const PAGE_HTML =
  '<html><body><main><h1>Resize a widget</h1><p>Call resize with a width.</p></main></body></html>';

interface World {
  ctx: TestCtx;
  services: Omit<Services, 'versions'>;
  index: IndexInternals;
}

function world(): World {
  const ctx = makeCtx({ registry: fakeRegistry({ products: [product] }) });
  ctx.http.on(INDEX_URL, { json: INDEX }).on(PAGE_URL, { body: PAGE_HTML });
  const services = createServices(
    ctx,
    adapterRegistry([new HttpAdapter('gatsby')]),
    fakeVersions(),
  );
  return { ctx, services, index: services.index as IndexInternals };
}

const search = (w: World, query = 'resize widget') =>
  w.services.search.search({ query, product: 'widgets-sdk', limit: 5 }, makeCall(w.ctx));
const read = (w: World) =>
  w.services.docs.read({ ref: PAGE_URL, view: 'auto', maxTokens: 6000 }, makeCall(w.ctx));

/** A responder that fails the way the gateway reports conditions the fake has no fault for. */
const throwing = (error: McpDocError) => (): RecordedResponse => {
  throw error;
};

const refreshLoop = new McpDocError(
  'UPSTREAM_UNAVAILABLE',
  'developers.arcgis.com sent a redirect loop',
  {
    why: 'meta-refresh loop after 5 hops',
    host: 'developers.arcgis.com',
    retryable: false,
  },
);
const offAllowList = new McpDocError('LINK_ONLY', 'archive.developers.arcgis.com is not fetched', {
  why: 'The page redirects to a link-only host',
  url: 'https://archive.developers.arcgis.com/widgets/resize/',
  host: 'archive.developers.arcgis.com',
});

const TRANSIENT: Array<[string, Fault]> = [
  ['a timeout', 'timeout'],
  ['a network error', 'network'],
  ['HTTP 500', 500],
  ['HTTP 503', 503],
];
const REFUSALS: Array<[string, Fault]> = [
  ['HTTP 403', 403],
  ['HTTP 429 with Retry-After', 429],
];
const BROKEN_BODIES: Array<[string, Fault]> = [
  ['a truncated body', 'truncated'],
  ['an HTML page instead of JSON', 'html'],
  ['an empty body', 'empty'],
  ['an oversized body', 'oversized'],
  ['HTTP 404', 404],
];

describe('chaos: first index build', () => {
  it.each([...TRANSIENT, ...REFUSALS, ...BROKEN_BODIES])(
    '%s on the index file leaves search on the last rung',
    async (_name, fault) => {
      const w = world();
      w.ctx.http.fail(INDEX_URL, fault);
      const response = await search(w);
      // Entry links from the registry answered: the source root and the start-here page.
      expect(response.hits.map((hit) => hit.ref).sort()).toEqual([BASE, `${BASE}start/`]);
      expect(response.notes).toContainEqual(
        expect.stringMatching(
          /^degraded: widgets-sdk\/guide has no index, only its entry links were used: /,
        ),
      );
      expect(w.index.health()[0]).toMatchObject({ state: 'degraded' });
      expect(w.ctx.http.unrecorded).toEqual([]);
    },
  );

  it.each([
    ['a refresh loop', refreshLoop],
    ['a redirect off the allow-list', offAllowList],
  ])('%s on the index file does not fail the search', async (_name, error) => {
    const lost = makeCtx({ registry: fakeRegistry({ products: [product] }) });
    lost.http.on(INDEX_URL, throwing(error));
    const services = createServices(
      lost,
      adapterRegistry([new HttpAdapter('gatsby')]),
      fakeVersions(),
    );
    const response = await services.search.search(
      { query: 'resize', product: 'widgets-sdk', limit: 5 },
      makeCall(lost),
    );
    expect(response.notes).toContainEqual(expect.stringContaining(error.message));
  });

  it('recovers on the next attempt once the upstream is back', async () => {
    const w = world();
    w.ctx.http.fail(INDEX_URL, 503, { times: 1 });
    expect((await search(w)).notes.join(' ')).toContain('degraded');
    w.ctx.clock.advance(2 * 60 * 1000);
    const response = await search(w);
    expect(response.hits[0]?.ref).toBe(PAGE_URL);
    expect(response.notes).toEqual([]);
  });

  it('does not refuse symbol lookups with a wrong certainty while the index is down', async () => {
    const w = world();
    w.ctx.http.fail(INDEX_URL, 'timeout');
    const error: unknown = await w.services.symbols
      .lookup(
        { symbol: 'Widget', product: 'widgets-sdk', detail: 'summary', maxTokens: 3000 },
        makeCall(w.ctx),
      )
      .catch((caught: unknown) => caught);
    // Nothing was searched, so the answer is "unavailable", never "not found".
    expect(error).toMatchObject({ code: 'UPSTREAM_UNAVAILABLE', details: { retryable: true } });
    expect((error as McpDocError).details?.why).toContain('widgets-sdk/guide');
    expect((error as McpDocError).details?.why).toContain('says nothing about whether');
  });
});

describe('chaos: revalidating a good index', () => {
  it.each([...TRANSIENT, ...REFUSALS, ...BROKEN_BODIES])(
    '%s keeps the good index and labels it stale',
    async (_name, fault) => {
      const w = world();
      const good = await search(w);
      expect(good.hits[0]?.ref).toBe(PAGE_URL);
      expect(good.notes).toEqual([]);

      w.ctx.clock.advance(25 * HOUR);
      w.ctx.http.fail(INDEX_URL, fault);
      const degraded = await search(w);
      expect(degraded.hits.map((hit) => hit.ref)).toEqual(good.hits.map((hit) => hit.ref));
      expect(degraded.notes).toContainEqual(
        expect.stringMatching(
          /^degraded: widgets-sdk\/guide answered from an older index snapshot: /,
        ),
      );
      expect(w.index.toc('widgets-sdk', 'guide', 'latest')).toHaveLength(INDEX.pages.length);
    },
  );

  it('never replaces a good index by a much smaller one', async () => {
    const w = world();
    await search(w);
    w.ctx.clock.advance(25 * HOUR);
    // The upstream answers 200 with an index that lost most of its pages.
    w.ctx.http.on(INDEX_URL, { json: { pages: [INDEX.pages[1]] } });
    const response = await search(w);
    expect(response.hits[0]?.ref).toBe(PAGE_URL);
    expect(w.index.toc('widgets-sdk', 'guide', 'latest')).toHaveLength(INDEX.pages.length);
    expect(w.index.health()[0]).toMatchObject({ state: 'degraded', stale: true });
    expect(response.notes).toContainEqual(
      expect.stringContaining('fewer than the 2 needed to replace the previous 4'),
    );
  });

  it('never replaces a good index by one whose shape changed', async () => {
    const w = world();
    await search(w);
    w.ctx.clock.advance(25 * HOUR);
    // A renamed field: the adapter crashes on `data.pages.map`.
    w.ctx.http.on(INDEX_URL, { json: { documents: [] } });
    const response = await search(w);
    expect(response.hits[0]?.ref).toBe(PAGE_URL);
    expect(w.index.toc('widgets-sdk', 'guide', 'latest')).toHaveLength(INDEX.pages.length);
  });

  it('keeps answering from the persisted index after a restart during an outage', async () => {
    const first = world();
    await search(first);
    first.ctx.clock.advance(25 * HOUR);

    const ctx = makeCtx({
      registry: fakeRegistry({ products: [product] }),
      cache: first.ctx.cache,
      clock: first.ctx.clock,
    });
    ctx.http.on(INDEX_URL, { json: INDEX }).fail(INDEX_URL, 'timeout');
    const services = createServices(
      ctx,
      adapterRegistry([new HttpAdapter('gatsby')]),
      fakeVersions(),
    );
    const response = await services.search.search(
      { query: 'resize widget', product: 'widgets-sdk', limit: 5 },
      makeCall(ctx),
    );
    expect(response.hits[0]?.ref).toBe(PAGE_URL);
    expect(response.notes.join(' ')).toContain('older index snapshot');
  });
});

describe('chaos: reading a page', () => {
  it.each(TRANSIENT)(
    '%s with a cached copy returns the copy labelled stale',
    async (_name, fault) => {
      const w = world();
      w.ctx.http.fail(PAGE_URL, fault, { stale: true });
      const response = await read(w);
      expect(response.text).toContain('Call resize with a width.');
      expect(response.page.cache).toBe('stale');
      expect(response.page.degraded).toMatchObject({ level: 'stale' });
      expect(response.page.attribution).toContain('stale');
    },
  );

  it.each([...TRANSIENT, ...REFUSALS, ['an oversized body', 'oversized'] as [string, Fault]])(
    '%s without a copy returns a link-only page',
    async (_name, fault) => {
      const w = world();
      w.ctx.http.fail(PAGE_URL, fault);
      const response = await read(w);
      expect(response.page.degraded?.level).toBe('link-only');
      expect(response.page.degraded?.reason).toMatch(/not responding|refused|size limit/);
      expect(response.text).toContain(`Open it directly: <${PAGE_URL}>`);
      expect(response.page.attribution).toContain(PAGE_URL);
      // Refusals and failures are not worked around: one request, no second attempt here.
      expect(w.ctx.http.count(PAGE_URL)).toBe(1);
    },
  );

  it('a refresh loop returns a link-only page', async () => {
    const lost = makeCtx({ registry: fakeRegistry({ products: [product] }) });
    lost.http.on(PAGE_URL, throwing(refreshLoop));
    const services = createServices(
      lost,
      adapterRegistry([new HttpAdapter('gatsby')]),
      fakeVersions(),
    );
    const response = await services.docs.read(
      { ref: PAGE_URL, view: 'auto', maxTokens: 6000 },
      makeCall(lost),
    );
    expect(response.page.degraded).toMatchObject({
      level: 'link-only',
      reason: expect.stringContaining('meta-refresh loop') as string,
    });
  });

  it('a redirect off the allow-list is reported as LINK_ONLY with the target, not followed', async () => {
    const lost = makeCtx({ registry: fakeRegistry({ products: [product] }) });
    lost.http.on(PAGE_URL, throwing(offAllowList));
    const services = createServices(
      lost,
      adapterRegistry([new HttpAdapter('gatsby')]),
      fakeVersions(),
    );
    await expect(
      services.docs.read({ ref: PAGE_URL, view: 'auto', maxTokens: 6000 }, makeCall(lost)),
    ).rejects.toMatchObject({
      code: 'LINK_ONLY',
      details: { url: 'https://archive.developers.arcgis.com/widgets/resize/' },
    });
    expect(lost.http.hosts()).toEqual(['developers.arcgis.com']);
  });

  it('a truncated page is still returned', async () => {
    const w = world();
    w.ctx.http.fail(PAGE_URL, 'truncated');
    const response = await read(w);
    expect(response.text).toContain('Resize a widget');
    expect(response.page.degraded).toBeUndefined();
  });

  it('a page whose selectors are gone keeps the rung the extractor reports', async () => {
    const w = world();
    const degraded = {
      level: 'generic-extractor',
      reason: 'the family profile matched nothing',
    } as const;
    const plain = w.ctx.render;
    w.ctx.render = {
      render: (kind, input, meta, opts) => ({ ...plain.render(kind, input, meta, opts), degraded }),
      detectFamily: (html) => plain.detectFamily(html),
      detectMetaRefresh: (html, base) => plain.detectMetaRefresh(html, base),
    };
    const services = createServices(
      w.ctx,
      adapterRegistry([new HttpAdapter('gatsby')]),
      fakeVersions(),
    );
    const response = await services.docs.read(
      { ref: PAGE_URL, view: 'auto', maxTokens: 6000 },
      makeCall(w.ctx),
    );
    expect(response.page.degraded).toEqual(degraded);
    expect(response.text).toContain('Call resize with a width.');
  });

  it('a spent request budget returns a link-only page instead of failing', async () => {
    const w = world();
    const call = makeCall(w.ctx);
    call.budget.used = call.budget.maxRequests;
    const response = await w.services.docs.read(
      { ref: PAGE_URL, view: 'auto', maxTokens: 6000 },
      call,
    );
    expect(response.page.degraded).toMatchObject({
      level: 'link-only',
      reason: expect.stringContaining('request budget') as string,
    });
  });

  it('a lookup whose page cannot be fetched answers from the index', async () => {
    const w = world();
    w.ctx.http
      .on(`${BASE}api/Widget/`, { body: '<main><h1>Widget</h1></main>' })
      .fail(`${BASE}api/Widget/`, 503);
    const response = await w.services.symbols.lookup(
      { symbol: 'Widget', product: 'widgets-sdk', detail: 'summary', maxTokens: 3000 },
      makeCall(w.ctx),
    );
    expect(response.record.ref).toBe(`${BASE}api/Widget/`);
    expect(response.page.degraded?.level).toBe('link-only');
  });
});
