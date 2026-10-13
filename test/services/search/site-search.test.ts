import { describe, expect, it } from 'vitest';
import type { SearchProvider } from '../../../src/core/ports.js';
import type { SearchHit } from '../../../src/core/types.js';
import { createIndexService } from '../../../src/services/index/service.js';
import { createSearchService } from '../../../src/services/search/service.js';
import { makeHit } from '../../support/builders.js';
import { makeCall } from '../../support/make-ctx.js';
import { JS_RECORDS, jsSdk, kotlinSdk } from '../support/catalogue.js';
import { fakeVersions, makeHarness } from '../support/harness.js';
import { adapterRegistry, TestAdapter } from '../support/test-adapter.js';

const JS = 'https://developers.arcgis.com/javascript/latest';

describe('site search', () => {
  const ESEARCH = 'https://esearchapi.esri.com/search';
  const body = {
    search: {
      hits: [
        {
          score: 30,
          doc: {
            url: `${JS}/popups/?highlight=arcade`,
            title: 'Configure popups',
            description: 'ignored',
          },
          highlight: { content: ['Use <b>Arcade</b> expressions in a popup'] },
        },
        {
          score: 20,
          doc: {
            url: `${JS}/arcade-profiles/`,
            title: 'Arcade profiles',
            description: 'Where expressions run.',
          },
        },
        {
          score: 10,
          doc: { url: 'https://developers.arcgis.com/kotlin/arcade/', title: 'Another product' },
        },
      ],
    },
  };

  it('fuses remote hits when the capability is on', async () => {
    const h = makeHarness({
      enabled: ['website', 'site-index', 'site-search', 'github', 'package-cdn'],
    });
    h.ctx.http.on(ESEARCH, { json: body }, 'POST');
    const response = await h.services.search.search(
      { query: 'arcade expressions', product: 'js-maps-sdk', limit: 5 },
      h.call(),
    );
    expect(response.mode).toBe('local+site');
    expect(response.hits.map((hit) => hit.ref)).toEqual(
      expect.arrayContaining([`${JS}/popups/`, `${JS}/arcade-profiles/`]),
    );
    // Hits of other products are dropped, even when the remote filter let them through.
    expect(response.hits.map((hit) => hit.product)).not.toContain('kotlin-maps-sdk');
    const remoteOnly = response.hits.find((hit) => hit.ref === `${JS}/arcade-profiles/`);
    expect(remoteOnly).toMatchObject({
      match: 'site',
      excerpt: 'Where expressions run.',
      source: 'guide',
    });
    expect(response.notes.join(' ')).not.toContain('+site-search');

    const sent = JSON.parse(h.ctx.http.requests.at(-1)?.body ?? '{}') as Record<string, unknown>;
    expect(sent).toMatchObject({
      q: 'arcade expressions',
      index: 'developers_arcgis_v1',
      partialfields: 'Content-Location:developers%2Earcgis%2Ecom/javascript/latest',
      start: 0,
    });
  });

  it('keeps a scoped search inside its source and skips the remote for uncovered sources', async () => {
    const h = makeHarness({
      enabled: ['website', 'site-index', 'site-search', 'github', 'package-cdn'],
    });
    h.ctx.http.on(ESEARCH, { json: body }, 'POST');
    const scoped = await h.services.search.search(
      { query: 'arcade expressions', product: 'js-maps-sdk/core', limit: 5 },
      h.call(),
    );
    expect(scoped.mode).toBe('local+site');
    // The remote hits belong to the guide source: none of them may leak into a core search.
    expect(scoped.hits.filter((hit) => hit.source !== 'core')).toEqual([]);

    const requests = h.ctx.http.count();
    const typings = await h.services.search.search(
      { query: 'FeatureLayer', product: 'js-maps-sdk/typings', limit: 5 },
      h.call(),
    );
    expect(typings.mode).toBe('local');
    expect(h.ctx.http.count()).toBe(requests);
  });

  it('answers locally when the remote fails', async () => {
    const h = makeHarness({ enabled: ['website', 'site-index', 'site-search'] });
    h.ctx.http.on(ESEARCH, { json: body }, 'POST').fail(ESEARCH, 403);
    const response = await h.services.search.search(
      { query: 'cluster points', product: 'js-maps-sdk', limit: 3 },
      h.call(),
    );
    expect(response.mode).toBe('local+site');
    expect(response.hits[0]?.ref).toBe(`${JS}/clustering/`);
  });

  it('answers without a slow remote and includes its hits on the next call', async () => {
    const h = makeHarness();
    const index = createIndexService(
      h.ctx,
      adapterRegistry([new TestAdapter('gatsby').setRecords(JS_RECORDS)]),
    );
    let release: (hits: SearchHit[]) => void = () => undefined;
    let calls = 0;
    const provider: SearchProvider = {
      id: 'site-search',
      search: () => {
        calls += 1;
        return new Promise<SearchHit[]>((resolve) => {
          release = resolve;
        });
      },
    };
    const ctx = { ...h.ctx, policy: { ...h.ctx.policy, enabled: () => true } };
    const search = createSearchService({
      ctx,
      index,
      versions: fakeVersions(),
      provider,
      siteSoftDeadlineMs: 20,
    });
    const request = { query: 'cluster points', product: 'js-maps-sdk', limit: 5 };

    const first = await search.search(request, makeCall(ctx));
    expect(first.hits[0]?.ref).toBe(`${JS}/clustering/`);
    expect(first.notes).toContainEqual(
      expect.stringContaining('Site search did not answer in time'),
    );

    release([
      makeHit({
        ref: `${JS}/late-page/`,
        title: 'Late page',
        product: 'js-maps-sdk',
        match: 'site',
      }),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await search.search(request, makeCall(ctx));
    expect(second.hits.map((hit) => hit.ref)).toContain(`${JS}/late-page/`);
    expect(calls).toBe(1);
  });

  it('never fails the search for a remote failure that is not an upstream error', async () => {
    const h = makeHarness({
      enabled: ['website', 'site-index', 'site-search', 'github'],
      products: [kotlinSdk, jsSdk],
    });
    // Nothing is recorded for the endpoint: the fake rejects with a plain Error.
    const response = await h.services.search.search(
      { query: 'offline', product: 'kotlin-maps-sdk', limit: 3 },
      h.call(),
    );
    expect(response.mode).toBe('local+site');
    expect(response.hits[0]?.ref).toBe('https://developers.arcgis.com/kotlin/offline-maps/');
    expect(h.ctx.http.unrecorded).toEqual(['POST https://esearchapi.esri.com/search']);
  });

  it('reports local mode for a product the remote index does not cover', async () => {
    const h = makeHarness({ enabled: ['website', 'site-index', 'site-search', 'github'] });
    const response = await h.services.search.search(
      { query: 'mcp', product: 'ai-agents', limit: 3 },
      h.call(),
    );
    expect(response.mode).toBe('local');
    expect(h.ctx.http.requests).toEqual([]);
  });
});
