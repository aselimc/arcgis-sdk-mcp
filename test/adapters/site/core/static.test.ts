import { describe, expect, it } from 'vitest';
import { staticAdapter } from '../../../../src/adapters/site/static.js';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import { newBudget } from '../../../../src/core/async.js';
import { makeLine, makeProduct, makeSource } from '../../../support/builders.js';
import { loadCassette } from '../../../support/fixtures.js';
import { makeCtx, type TestCtx } from '../../../support/make-ctx.js';
import { describeSiteAdapterContract } from '../contract.js';

const OVERVIEW = 'https://location.arcgis.com/help/widgets-overview/';
const MIGRATE = 'https://developers.arcgis.com/widgets/v2/migrate/';

const card = makeSource(
  'static',
  {
    entries: [
      { url: OVERVIEW, title: 'Widgets overview', kind: 'help' },
      { url: '/widgets/{prefix}migrate/', title: 'Migrate to version 2', kind: 'guide' },
      { url: OVERVIEW, title: 'Listed twice', kind: 'guide' },
    ],
  },
  {
    id: 'card',
    title: 'Entry pages',
    kinds: ['help', 'guide'],
    probe: { url: OVERVIEW, expect: 'html', minChars: 100 },
  },
);
const product = makeProduct({ sources: [card] });
const line = makeLine({ vars: { prefix: 'v2/' } });
const ctxOf = (): TestCtx =>
  makeCtx({ cassette: loadCassette('cassettes', 'site', 'core', 'static.json') });
const bound = () => bindSource(product, card, line);

describeSiteAdapterContract('static (fixed entries)', () => ({
  adapter: staticAdapter,
  product: makeProduct({ sources: [card], lines: [line] }),
  source: card,
  ctx: ctxOf,
  allowedHosts: ['location.arcgis.com', 'developers.arcgis.com'],
  minRecords: 2,
  readRef: OVERVIEW,
  failures: {
    renamedField: { notApplicable: 'the catalogue is registry data' },
    missingFile: { notApplicable: 'enumeration requests nothing' },
    emptyIndex: { notApplicable: 'enumeration requests nothing' },
    htmlInsteadOfJson: { notApplicable: 'the source reads no JSON' },
  },
}));

describe('static: enumerate and read', () => {
  it('lists its entries from the registry without a request', async () => {
    const ctx = ctxOf();
    const records = await staticAdapter.enumerate!(ctx, bound());
    expect(records.map((record) => [record.ref, record.title, record.kind])).toEqual([
      [OVERVIEW, 'Widgets overview', 'help'],
      [MIGRATE, 'Migrate to version 2', 'guide'],
    ]);
    expect(ctx.http.count()).toBe(0);
  });

  it('still lists entries of a link-only line, which are answered as links when read', async () => {
    const src = bindSource(product, card, { ...line, access: 'link-only' });
    expect(await staticAdapter.enumerate!(ctxOf(), src)).toHaveLength(2);
    await expect(
      staticAdapter.read(ctxOf(), src, { url: new URL(OVERVIEW) }),
    ).rejects.toMatchObject({
      code: 'LINK_ONLY',
      details: { url: OVERVIEW, host: 'location.arcgis.com' },
    });
  });

  it('reads an entry with the kind the registry gives it', async () => {
    const ctx = ctxOf();
    expect((await staticAdapter.read(ctx, bound(), { url: new URL(OVERVIEW) })).kind).toBe('help');
    expect(
      (await staticAdapter.read(ctx, bound(), { url: new URL(`${MIGRATE}#steps`) })).kind,
    ).toBe('guide');
  });

  it('reads an unlisted URL as the first kind of the source', async () => {
    const ctx = ctxOf();
    ctx.http.on('https://location.arcgis.com/help/other/', { body: '<main><h1>Other</h1></main>' });
    const page = await staticAdapter.read(ctx, bound(), {
      url: new URL('https://location.arcgis.com/help/other/'),
    });
    expect(page.kind).toBe('help');
  });

  it('passes the request budget of the bound source to the gateway', async () => {
    const ctx = ctxOf();
    const budget = newBudget(1, 60_000, ctx.clock);
    const src = bindSource(product, card, line, undefined, budget);
    await staticAdapter.read(ctx, src, { url: new URL(OVERVIEW) });
    expect(budget.used).toBe(1);
    await expect(staticAdapter.read(ctx, src, { url: new URL(MIGRATE) })).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
    });
  });
});
