import { describe, expect, it } from 'vitest';
import { McpDocError } from '../../../src/core/errors.js';
import type { RequestBudget } from '../../../src/core/ports.js';
import type { CatalogRecord, Product } from '../../../src/core/types.js';
import { RETRY_AFTER_MS } from '../../../src/services/index/service.js';
import { snapshotKey } from '../../../src/services/index/snapshot.js';
import { makeLine, makeProduct, makeRecord, makeSource } from '../../support/builders.js';
import { DAY, HOUR, MINUTE } from '../../support/fake-clock.js';
import { makeHarness } from '../support/harness.js';

const BASE = 'https://developers.arcgis.com/widgets/';

function records(count: number, overrides: Partial<CatalogRecord> = {}): CatalogRecord[] {
  return Array.from({ length: count }, (_, i) =>
    makeRecord({ ref: `${BASE}page-${i}/`, title: `Widget page ${i}`, ...overrides }),
  );
}

function product(overrides: Partial<Product> = {}): Product {
  return makeProduct({
    startHere: [{ title: 'Start with widgets', ref: `${BASE}start/` }],
    ...overrides,
  });
}

const unavailable = new McpDocError(
  'UPSTREAM_UNAVAILABLE',
  'developers.arcgis.com is not responding',
  {
    why: 'timeout',
    retryable: true,
  },
);

describe('index build', () => {
  it('builds on first use and answers from memory afterwards', async () => {
    const h = makeHarness({ products: [product()], records: records(12) });
    const [first] = await h.index.ensure(product(), undefined, makeLine(), h.call());
    expect(first).toMatchObject({
      product: 'widgets-sdk',
      source: 'guide',
      state: 'ready',
      records: 12,
    });
    expect(first?.builtAt).toBe(h.ctx.clock.iso());

    await h.index.ensure(product(), undefined, makeLine(), h.call());
    expect(h.adapter('gatsby').count('enumerate')).toBe(1);
    expect(h.index.health()).toEqual([
      expect.objectContaining({
        product: 'widgets-sdk',
        source: 'guide',
        state: 'ok',
        records: 12,
      }),
    ]);
  });

  it('gives the adapter its own request budget, capped by maxEnumerateRequests', async () => {
    const h = makeHarness({
      products: [product()],
      records: [],
      adapters: { gatsby: { maxEnumerateRequests: 4 } },
    });
    let seen: RequestBudget | undefined;
    h.adapter('gatsby').enumerate = async (_ctx, src) => {
      seen = src.budget;
      return records(3);
    };
    const call = h.call();
    await h.index.ensure(product(), undefined, makeLine(), call);
    expect(seen?.maxRequests).toBe(4);
    expect(seen).not.toBe(call.budget);
    expect(call.budget.used).toBe(0);
  });

  it('caps the build budget at requestsPerIndexBuild', async () => {
    const h = makeHarness({
      products: [product()],
      records: [],
      adapters: { gatsby: { maxEnumerateRequests: 500 } },
    });
    let seen: RequestBudget | undefined;
    h.adapter('gatsby').enumerate = async (_ctx, src) => {
      seen = src.budget;
      return records(3);
    };
    await h.index.ensure(product(), undefined, makeLine(), h.call());
    expect(seen?.maxRequests).toBe(h.ctx.config.limits.requestsPerIndexBuild);
  });

  it('builds once for concurrent callers', async () => {
    const h = makeHarness({ products: [product()], records: records(5) });
    const states = await Promise.all([
      h.index.ensure(product(), undefined, makeLine(), h.call()),
      h.index.ensure(product(), undefined, makeLine(), h.call()),
    ]);
    expect(states.map((list) => list[0]?.state)).toEqual(['ready', 'ready']);
    expect(h.adapter('gatsby').count('enumerate')).toBe(1);
  });

  it('drops duplicate and unusable records and stamps the unit identity', async () => {
    const h = makeHarness({ products: [product()], records: [] });
    h.adapter('gatsby').enumerate = async () => [
      makeRecord({ ref: `${BASE}a/`, title: 'A', product: 'someone-else', source: 'x', line: 'y' }),
      makeRecord({ ref: `${BASE}a/`, title: 'A again' }),
      makeRecord({ ref: '', title: 'No ref' }),
    ];
    const [state] = await h.index.ensure(product(), undefined, makeLine(), h.call());
    expect(state?.records).toBe(1);
    expect(h.index.toc('widgets-sdk', 'guide', 'latest')).toEqual([
      expect.objectContaining({
        product: 'widgets-sdk',
        source: 'guide',
        line: 'latest',
        title: 'A',
      }),
    ]);
  });

  it('builds sources in priority order and honours the source filter and line filter', async () => {
    const p = product({
      lines: [makeLine(), makeLine({ id: 'v1', label: '1.x', current: false })],
      sources: [
        makeSource('gatsby', { base: '/widgets/' }, { id: 'late', priority: 9 }),
        makeSource('astro', { base: '/widgets/ref/' }, { id: 'early', priority: 1, floor: false }),
        makeSource(
          'docc',
          { base: '/widgets/old/' },
          { id: 'v1-only', floor: false, lines: ['v1'] },
        ),
      ],
    });
    const h = makeHarness({ products: [p], records: [] });
    const all = await h.index.ensure(p, undefined, makeLine(), h.call());
    expect(all.map((state) => state.source)).toEqual(['early', 'late']);
    const one = await h.index.ensure(p, ['late'], makeLine(), h.call());
    expect(one.map((state) => state.source)).toEqual(['late']);
  });
});

describe('index persistence', () => {
  it('loads the snapshot after a restart without enumerating', async () => {
    const first = makeHarness({ products: [product()], records: records(7) });
    await first.index.ensure(product(), undefined, makeLine(), first.call());
    expect(first.ctx.cache.derivedKeys()).toContainEqual([
      'catalog',
      snapshotKey('widgets-sdk', 'guide', 'latest'),
    ]);

    const second = makeHarness({ products: [product()], records: records(7), ctx: first.ctx });
    const [state] = await second.index.ensure(product(), undefined, makeLine(), second.call());
    expect(state).toMatchObject({ state: 'ready', records: 7 });
    expect(second.adapter('gatsby').count('enumerate')).toBe(0);
    expect(second.index.toc('widgets-sdk', 'guide', 'latest')).toHaveLength(7);
  });

  it('discards a snapshot whose source definition changed', async () => {
    const first = makeHarness({ products: [product()], records: records(7) });
    await first.index.ensure(product(), undefined, makeLine(), first.call());

    const changed = product({
      sources: [makeSource('gatsby', { base: '/widgets/', exclude: ['^old/'] })],
    });
    const second = makeHarness({ products: [changed], records: records(3), ctx: first.ctx });
    const [state] = await second.index.ensure(changed, undefined, makeLine(), second.call());
    expect(second.adapter('gatsby').count('enumerate')).toBe(1);
    expect(state).toMatchObject({ state: 'ready', records: 3 });
  });

  it('discards a snapshot of another schema version, and one that is not a snapshot', async () => {
    for (const stored of [{ v: 0, fingerprint: 'x', builtAt: 0, records: [] }, 'garbage']) {
      const h = makeHarness({ products: [product()], records: records(2) });
      await h.ctx.cache.putDerived(
        'catalog',
        snapshotKey('widgets-sdk', 'guide', 'latest'),
        stored,
      );
      const [state] = await h.index.ensure(product(), undefined, makeLine(), h.call());
      expect(state).toMatchObject({ state: 'ready', records: 2 });
      expect(h.adapter('gatsby').count('enumerate')).toBe(1);
    }
  });

  it('treats an unreadable cache as a miss', async () => {
    const h = makeHarness({ products: [product()], records: records(2) });
    h.ctx.cache.getDerived = async () => {
      throw new Error('disk on fire');
    };
    h.ctx.cache.putDerived = async () => {
      throw new Error('disk on fire');
    };
    const [state] = await h.index.ensure(product(), undefined, makeLine(), h.call());
    expect(state).toMatchObject({ state: 'ready', records: 2 });
    expect(h.ctx.logger.messages('warn')).toContain('index snapshot could not be written');
  });

  it('revalidates after 24 hours and swaps in the new index', async () => {
    const h = makeHarness({ products: [product()], records: records(6) });
    await h.index.ensure(product(), undefined, makeLine(), h.call());
    h.ctx.clock.advance(23 * HOUR);
    await h.index.ensure(product(), undefined, makeLine(), h.call());
    expect(h.adapter('gatsby').count('enumerate')).toBe(1);

    h.ctx.clock.advance(2 * HOUR);
    h.adapter('gatsby').setRecords(records(8));
    const [state] = await h.index.ensure(product(), undefined, makeLine(), h.call());
    expect(h.adapter('gatsby').count('enumerate')).toBe(2);
    expect(state).toMatchObject({ state: 'ready', records: 8 });
  });

  it('revalidates a day-old snapshot loaded from disk, keeping it when the rebuild fails', async () => {
    const first = makeHarness({ products: [product()], records: records(6) });
    await first.index.ensure(product(), undefined, makeLine(), first.call());
    first.ctx.clock.advance(2 * DAY);

    const second = makeHarness({ products: [product()], records: [], ctx: first.ctx });
    second.adapter('gatsby').failOn('enumerate', unavailable);
    const [state] = await second.index.ensure(product(), undefined, makeLine(), second.call());
    expect(state).toMatchObject({ state: 'stale', records: 6 });
    expect(second.index.reason('widgets-sdk', 'guide')).toContain('UPSTREAM_UNAVAILABLE');
    expect(second.index.health()[0]).toMatchObject({ state: 'degraded' });
  });

  it('does not serve a snapshot past the hard maximum age of seven days', async () => {
    const first = makeHarness({ products: [product()], records: records(6) });
    await first.index.ensure(product(), undefined, makeLine(), first.call());
    first.ctx.clock.advance(8 * DAY);

    const second = makeHarness({ products: [product()], records: [], ctx: first.ctx });
    second.adapter('gatsby').failOn('enumerate', unavailable);
    const [state] = await second.index.ensure(product(), undefined, makeLine(), second.call());
    expect(state?.state).toBe('partial');
    expect(second.ctx.cache.derivedKeys()).toEqual([]);
  });

  it('drops an in-memory index that has aged past seven days when its rebuild fails', async () => {
    const h = makeHarness({ products: [product()], records: records(6) });
    await h.index.ensure(product(), undefined, makeLine(), h.call());
    h.ctx.clock.advance(8 * DAY);
    h.adapter('gatsby').failOn('enumerate', unavailable);
    const [state] = await h.index.ensure(product(), undefined, makeLine(), h.call());
    expect(state?.state).toBe('partial');
  });
});

describe('swap rule', () => {
  async function rebuilt(before: number, after: number, minRecords?: number) {
    const p = product({
      sources: [
        makeSource(
          'gatsby',
          { base: '/widgets/' },
          {
            probe: {
              url: BASE,
              expect: 'html',
              ...(minRecords === undefined ? {} : { minRecords }),
            },
          },
        ),
      ],
    });
    const h = makeHarness({ products: [p], records: records(before) });
    await h.index.ensure(p, undefined, makeLine(), h.call());
    h.ctx.clock.advance(25 * HOUR);
    h.adapter('gatsby').setRecords(records(after));
    const [state] = await h.index.ensure(p, undefined, makeLine(), h.call());
    return { h, p, state };
  }

  it('keeps the old index when the rebuilt one has under half the records', async () => {
    const { h, state } = await rebuilt(10, 4);
    expect(state).toMatchObject({ state: 'stale', records: 10 });
    expect(h.index.toc('widgets-sdk', 'guide', 'latest')).toHaveLength(10);
    expect(h.index.health()[0]).toMatchObject({ state: 'degraded', stale: true });
    expect(h.index.reason('widgets-sdk', 'guide')).toMatch(/4 records, fewer than the 5 needed/);
  });

  it('accepts a rebuilt index with exactly half the records', async () => {
    const { state } = await rebuilt(10, 5);
    expect(state).toMatchObject({ state: 'ready', records: 5 });
  });

  it('applies probe.minRecords when it is the larger threshold', async () => {
    const { state } = await rebuilt(10, 6, 8);
    expect(state).toMatchObject({ state: 'stale', records: 10 });
  });

  it('keeps the old index when the rebuild returns nothing', async () => {
    const { state } = await rebuilt(10, 0);
    expect(state).toMatchObject({ state: 'stale', records: 10 });
  });

  it('does not retry a rejected rebuild on every call', async () => {
    const { h, p } = await rebuilt(10, 4);
    await h.index.ensure(p, undefined, makeLine(), h.call());
    h.ctx.clock.advance(5 * MINUTE);
    await h.index.ensure(p, undefined, makeLine(), h.call());
    expect(h.adapter('gatsby').count('enumerate')).toBe(2);
  });

  it('marks a first index below probe.minRecords as degraded but uses it', async () => {
    const p = product({
      sources: [
        makeSource(
          'gatsby',
          { base: '/widgets/' },
          { probe: { url: BASE, expect: 'html', minRecords: 50 } },
        ),
      ],
    });
    const h = makeHarness({ products: [p], records: records(3) });
    const [state] = await h.index.ensure(p, undefined, makeLine(), h.call());
    expect(state).toMatchObject({ state: 'ready', records: 3 });
    expect(h.index.health()[0]).toMatchObject({ state: 'degraded' });
  });
});

describe('deadline and background completion', () => {
  it('answers "building" at the deadline and finishes the build in the background', async () => {
    const h = makeHarness({
      products: [product()],
      records: records(9),
      config: { limits: { ...makeHarness().ctx.config.limits, indexBuildDeadlineMs: 30 } },
    });
    const release = h.adapter('gatsby').block('enumerate');

    const [early] = await h.index.ensure(product(), undefined, makeLine(), h.call());
    expect(early).toMatchObject({ state: 'building', records: 0 });
    expect(
      h.index.query({ text: 'widget', products: ['widgets-sdk'], limit: 5, offset: 0 }).total,
    ).toBe(0);

    release();
    await h.index.idle();
    const [late] = await h.index.ensure(product(), undefined, makeLine(), h.call());
    expect(late).toMatchObject({ state: 'ready', records: 9 });
    // The second call joined or followed the first build: nothing was enumerated twice.
    expect(h.adapter('gatsby').count('enumerate')).toBe(1);
  });

  it('reports an old index as stale while its rebuild is still running', async () => {
    const h = makeHarness({
      products: [product()],
      records: records(9),
      config: { limits: { ...makeHarness().ctx.config.limits, indexBuildDeadlineMs: 30 } },
    });
    await h.index.ensure(product(), undefined, makeLine(), h.call());
    h.ctx.clock.advance(25 * HOUR);
    const release = h.adapter('gatsby').block('enumerate');
    const [state] = await h.index.ensure(product(), undefined, makeLine(), h.call());
    expect(state).toMatchObject({ state: 'stale', records: 9 });
    release();
    await h.index.idle();
  });
});

describe('enumeration ladder', () => {
  it('falls back to registry entry links when the first build fails', async () => {
    const h = makeHarness({ products: [product()], records: [] });
    h.adapter('gatsby').failOn('enumerate', unavailable);
    const [state] = await h.index.ensure(product(), undefined, makeLine(), h.call());
    expect(state?.state).toBe('partial');
    expect(h.index.toc('widgets-sdk', 'guide', 'latest').map((record) => record.ref)).toEqual([
      BASE,
      `${BASE}start/`,
    ]);
    expect(h.index.reason('widgets-sdk', 'guide')).toContain('timeout');
  });

  it('treats an empty enumeration as a lower rung, not as an index', async () => {
    const h = makeHarness({ products: [product()], records: [] });
    const [state] = await h.index.ensure(product(), undefined, makeLine(), h.call());
    expect(state?.state).toBe('partial');
    expect(h.index.reason('widgets-sdk', 'guide')).toBe('the source returned no records');
  });

  it('never throws, whatever the adapter throws', async () => {
    const h = makeHarness({ products: [product()], records: [] });
    h.adapter('gatsby').failOn('enumerate', new TypeError('selector is undefined'));
    const [state] = await h.index.ensure(product(), undefined, makeLine(), h.call());
    expect(state?.state).toBe('partial');
    expect(h.ctx.logger.messages('warn')).toContain('index build failed unexpectedly');
  });

  it('waits a minute before retrying a failed build', async () => {
    const h = makeHarness({ products: [product()], records: records(4) });
    h.adapter('gatsby').failOn('enumerate', unavailable, 1);
    await h.index.ensure(product(), undefined, makeLine(), h.call());
    await h.index.ensure(product(), undefined, makeLine(), h.call());
    expect(h.adapter('gatsby').count('enumerate')).toBe(1);

    h.ctx.clock.advance(RETRY_AFTER_MS + 1);
    const [state] = await h.index.ensure(product(), undefined, makeLine(), h.call());
    expect(state).toMatchObject({ state: 'ready', records: 4 });
    expect(h.index.health()[0]).toMatchObject({ state: 'ok' });
  });

  it('marks a source failing after three failures and skips it for fifteen minutes', async () => {
    const h = makeHarness({ products: [product()], records: records(4) });
    h.adapter('gatsby').failOn('enumerate', unavailable);
    for (let attempt = 0; attempt < 3; attempt++) {
      await h.index.ensure(product(), undefined, makeLine(), h.call());
      h.ctx.clock.advance(RETRY_AFTER_MS + 1);
    }
    expect(h.index.health()[0]).toMatchObject({ state: 'failing' });
    expect(h.adapter('gatsby').count('enumerate')).toBe(3);

    // Inside the skip window nothing is requested, even though the retry delay has passed.
    await h.index.ensure(product(), undefined, makeLine(), h.call());
    h.ctx.clock.advance(5 * MINUTE);
    await h.index.ensure(product(), undefined, makeLine(), h.call());
    expect(h.adapter('gatsby').count('enumerate')).toBe(3);

    h.ctx.clock.advance(15 * MINUTE);
    h.adapter('gatsby').heal();
    const [state] = await h.index.ensure(product(), undefined, makeLine(), h.call());
    expect(state?.state).toBe('ready');
    expect(h.index.health()[0]).toMatchObject({ state: 'ok' });
  });

  it('reports a source whose capability is off as unavailable and disabled', async () => {
    const h = makeHarness({ products: [product()], records: records(4), enabled: ['github'] });
    const [state] = await h.index.ensure(product(), undefined, makeLine(), h.call());
    expect(state).toMatchObject({ state: 'unavailable', records: 0 });
    expect(h.adapter('gatsby').count('enumerate')).toBe(0);
    expect(h.index.health()[0]).toMatchObject({ state: 'disabled' });
    expect(h.index.reason('widgets-sdk', 'guide')).toContain('"website" is switched off');
  });

  it('treats SOURCE_DISABLED from the gateway as disabled, not as a failure', async () => {
    const h = makeHarness({ products: [product()], records: [] });
    h.adapter('gatsby').failOn(
      'enumerate',
      new McpDocError('SOURCE_DISABLED', 'needs capability "site-index"', {
        capability: 'site-index',
      }),
    );
    const [state] = await h.index.ensure(product(), undefined, makeLine(), h.call());
    expect(state?.state).toBe('unavailable');
    expect(h.index.health()[0]).toMatchObject({ state: 'disabled' });
  });

  it('never fetches the website sources of a link-only line', async () => {
    const archived = makeLine({ id: 'v1', label: '1.x', current: false, access: 'link-only' });
    const p = product({ lines: [makeLine(), archived] });
    const h = makeHarness({ products: [p], records: records(4, { line: 'v1' }) });
    const [state] = await h.index.ensure(p, undefined, archived, h.call());
    expect(state?.state).toBe('unavailable');
    expect(h.adapter('gatsby').count('enumerate')).toBe(0);
  });

  it('indexes the entry links of a source that cannot be enumerated', async () => {
    const h = makeHarness({
      products: [product()],
      records: [],
      adapters: { gatsby: { noEnumerate: true } },
    });
    const [state] = await h.index.ensure(product(), undefined, makeLine(), h.call());
    expect(state).toMatchObject({ state: 'ready', records: 2 });
  });

  it('reports a spent build budget in the reason', async () => {
    const h = makeHarness({ products: [product()], records: [] });
    h.adapter('gatsby').enumerate = async (_ctx, src) => {
      if (src.budget !== undefined) src.budget.used = src.budget.maxRequests;
      throw unavailable;
    };
    await h.index.ensure(product(), undefined, makeLine(), h.call());
    expect(h.index.reason('widgets-sdk', 'guide')).toMatch(
      /^request budget of the index build spent/,
    );
  });
});

describe('memory bound', () => {
  it('evicts the least recently used index and reloads it from its snapshot', async () => {
    const a = product({ id: 'a-sdk', sources: [makeSource('gatsby', { base: '/a/' })] });
    const b = product({ id: 'b-sdk', sources: [makeSource('astro', { base: '/b/' })] });
    const many = (id: string): CatalogRecord[] =>
      Array.from({ length: 1500 }, (_, i) =>
        makeRecord({
          product: id,
          ref: `https://developers.arcgis.com/${id}/p${i}/`,
          title: `Page ${i}`,
        }),
      );
    const h = makeHarness({
      products: [a, b],
      records: [...many('a-sdk'), ...many('b-sdk')],
      config: { memoryMaxMb: 1 },
    });
    await h.index.ensure(a, undefined, makeLine(), h.call());
    h.ctx.clock.advance(1000);
    await h.index.ensure(b, undefined, makeLine(), h.call());
    expect(h.index.toc('a-sdk', 'guide', 'latest')).toHaveLength(0);
    expect(h.index.toc('b-sdk', 'guide', 'latest')).toHaveLength(1500);

    const [state] = await h.index.ensure(a, undefined, makeLine(), h.call());
    expect(state).toMatchObject({ state: 'ready', records: 1500 });
    expect(h.adapter('gatsby').count('enumerate')).toBe(1);
  });
});
