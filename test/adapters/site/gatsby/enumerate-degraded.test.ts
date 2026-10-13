import { describe, expect, it } from 'vitest';
import { gatsbyAdapter } from '../../../../src/adapters/site/gatsby/index.js';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import { newBudget } from '../../../../src/core/async.js';
import { isMcpDocError } from '../../../../src/core/errors.js';
import type { BoundSource, Ctx } from '../../../../src/core/ports.js';
import type { CatalogRecord } from '../../../../src/core/types.js';
import { makeLine } from '../../../support/builders.js';
import { fakePolicy } from '../../../support/fake-policy.js';
import { D, guide, recordAt, rejection, rest } from './sites.js';

function enumerate(ctx: Ctx, src: BoundSource<'gatsby'>): Promise<CatalogRecord[]> {
  if (gatsbyAdapter.enumerate === undefined) throw new Error('the adapter must enumerate');
  return gatsbyAdapter.enumerate(ctx, src);
}

const PAGE_DATA = `${D}/widgets/page-data/index/page-data.json`;
const STORE = `${D}/widgets/static/0f1e2d3c4b5a69788796a5b4c3d2e1f0.store.json`;
const ROTATED = '/widgets/static/ffffffffffffffffffffffffffffffff.store.json';

describe('gatsby enumerate: degradation', () => {
  it('reads only the sitemap while site-index is off', async () => {
    const site = guide();
    const ctx = site.ctx({ policy: fakePolicy({ enabled: ['website'] }) });
    const records = await enumerate(ctx, site.bound());
    expect(ctx.http.requests.map((request) => request.url)).toEqual([`${D}/widgets/sitemap-0.xml`]);
    expect(records).toHaveLength(8);
    expect(recordAt(records, '/layers/feature-layers/').title).toBe('Feature layers');
    expect(recordAt(records, '/widgets/').title).toBe('Guide'); // the source title
  });

  it('rediscovers a rotated store once, with a revalidating request', async () => {
    const site = guide();
    const ctx = site.ctx();
    ctx.http.fail(STORE, 404);
    ctx.http.on(PAGE_DATA, {
      json: { result: { data: { search: { publicStoreURL: ROTATED } } }, staticQueryHashes: [] },
    });
    ctx.http.on(`${D}${ROTATED}`, {
      json: [{ title: 'Start here', url: '/get-started/', pageType: 'Topic' }],
    });
    const records = await enumerate(ctx, site.bound());

    expect(ctx.http.unrecorded).toEqual([]);
    expect(ctx.http.count(PAGE_DATA)).toBe(2);
    expect(ctx.http.count(STORE)).toBe(1);
    expect(ctx.http.count(`${D}${ROTATED}`)).toBe(1);
    const pageDataRequests = ctx.http.requests.filter((request) => request.url === PAGE_DATA);
    expect(pageDataRequests[0]?.revalidate).toBeUndefined();
    expect(pageDataRequests[1]?.revalidate).toBe(true);
    expect(recordAt(records, '/get-started/').title).toBe('Start here');
  });

  it('gives a rotated store up after one rediscovery and answers from the navigation', async () => {
    const site = guide();
    const ctx = site.ctx();
    ctx.http.fail(/\.store\.json$/, 404);
    ctx.http.on(PAGE_DATA, {
      json: { result: { data: { search: { publicStoreURL: ROTATED } } }, staticQueryHashes: [] },
    });
    ctx.http.on(`${D}${ROTATED}`, { json: [] });
    const records = await enumerate(ctx, site.bound());

    expect(ctx.http.count(PAGE_DATA)).toBe(2);
    expect(ctx.http.count(/\.store\.json$/)).toBe(2);
    expect(recordAt(records, '/get-started/').title).toBe('Get started'); // navigation title
    expect(recordAt(records, '/widgets/').title).toBe('Overview');
    expect(ctx.logger.entries.some((entry) => entry.msg.includes('not rediscovered'))).toBe(true);
  });

  // Regression: the REST reference sub-sites answer their root with a redirect stub, which has
  // no page-data, so no navigation was found and every title came from a slug.
  it('starts from another page when the site root has no page-data', async () => {
    const site = rest();
    const ctx = site.ctx();
    const rootData = `${D}/rest/gadgets/page-data/index/page-data.json`;
    const standIn = `${D}/rest/gadgets/page-data/gadget-service/page-data.json`;
    const recorded = await site.ctx().http.getJson({ url: rootData });
    ctx.http.fail(rootData, 404);
    ctx.http.on(standIn, { json: recorded.data });
    const records = await enumerate(ctx, site.bound());

    expect(ctx.http.unrecorded).toEqual([]);
    expect(ctx.http.count(standIn)).toBe(1);
    expect(recordAt(records, '/apply-changes-gadget-service/')).toMatchObject({
      title: '/applyChanges: Apply Changes (Gadget Service)',
      symbol: 'applyChanges',
    });
  });

  it('does not ask twice when rediscovery names the same file', async () => {
    const site = guide();
    const ctx = site.ctx();
    ctx.http.fail(STORE, 404);
    const records = await enumerate(ctx, site.bound());
    expect(ctx.http.count(STORE)).toBe(1);
    expect(ctx.http.count(PAGE_DATA)).toBe(2);
    expect(records).toHaveLength(8);
  });

  it.each([
    ['a 5xx', 503],
    ['an oversized body', 'oversized'],
    ['a truncated body', 'truncated'],
  ] as const)('continues without the store after %s', async (_label, fault) => {
    const site = guide();
    const ctx = site.ctx();
    ctx.http.fail(STORE, fault);
    const records = await enumerate(ctx, site.bound());
    expect(ctx.http.count(STORE)).toBe(1); // only a missing file triggers rediscovery
    expect(records).toHaveLength(8);
    expect(recordAt(records, '/widgets/').title).toBe('Overview');
  });

  it('stops asking a host that refused, and still lists the sitemap', async () => {
    const site = guide();
    const ctx = site.ctx();
    ctx.http.fail(/\/page-data\//, 403);
    const records = await enumerate(ctx, site.bound());
    expect(ctx.http.count()).toBe(2);
    expect(records).toHaveLength(8);
  });

  it('lists from the index files when the sitemap is failing', async () => {
    const site = guide();
    const ctx = site.ctx();
    ctx.http.fail(/sitemap-0\.xml$/, 503);
    const records = await enumerate(ctx, site.bound());
    expect(ctx.http.count(/sitemap/)).toBe(1);
    expect(records.map((record) => record.title)).toContain('Dial');
    expect(records).toHaveLength(7); // everything but the sitemap-only page
  });

  it('fails with the sitemap error when nothing can be listed', async () => {
    const site = guide();
    const ctx = site.ctx();
    ctx.http.fail(/.*/, 503);
    const error = await rejection(enumerate(ctx, site.bound()));
    expect(isMcpDocError(error) && error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(isMcpDocError(error) && error.details?.url).toBe(`${D}/widgets/sitemap-0.xml`);
  });

  it('fails, not retryable, when the site lists no page under the base', async () => {
    const site = guide({ include: ['^nothing-like-this/'] });
    const error = await rejection(enumerate(site.ctx(), site.bound()));
    expect(isMcpDocError(error) && error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(isMcpDocError(error) && error.details?.retryable).toBe(false);
  });

  it('rejects instead of returning a partial catalogue when the call budget runs out', async () => {
    const site = guide();
    const ctx = site.ctx();
    const src = bindSource(
      site.product,
      site.source,
      makeLine(),
      undefined,
      newBudget(1, 60_000, ctx.clock),
    );
    const error = await rejection(enumerate(ctx, src));
    expect(isMcpDocError(error) && error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(ctx.http.count()).toBe(2); // the second request found the budget spent
  });

  it('wraps an unexpected exception as INTERNAL', async () => {
    const site = guide();
    const ctx = site.ctx();
    const src = site.bound();
    // A request outside the cassette makes the fake throw a plain Error.
    const elsewhere = bindSource(
      site.product,
      { ...site.source, config: { base: '/elsewhere/' } },
      src.line,
    );
    const error = await rejection(enumerate(ctx, elsewhere));
    expect(isMcpDocError(error) && error.code).toBe('INTERNAL');
  });

  it('lists nothing, and requests nothing, for a link-only line', async () => {
    const site = guide();
    const ctx = site.ctx();
    const src = bindSource(site.product, site.source, makeLine({ access: 'link-only' }));
    expect(await enumerate(ctx, src)).toEqual([]);
    expect(ctx.http.count()).toBe(0);
  });
});
