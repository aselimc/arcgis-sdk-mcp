import { describe, expect, it } from 'vitest';
import { McpDocError } from '../../../src/core/errors.js';
import { makeDocPage, makeLine } from '../../support/builders.js';
import { jsSdk } from '../support/catalogue.js';
import { API_URL, GUIDE_URL, JS, guidePage, harness, read, unavailable } from './fixtures.js';

describe('read: content ladder', () => {
  it('uses the declared fallback source when the primary upstream fails', async () => {
    const h = harness();
    h.adapter('astro').failOn('read', unavailable);
    h.adapter('npm-dts').addPage(
      makeDocPage({ url: API_URL, markdown: '# FeatureLayer (typings)\n\nFrom the package.' }),
    );
    const response = await read(h, { ref: API_URL });
    expect(response.text).toContain('From the package.');
    expect(response.page).toMatchObject({ product: 'js-maps-sdk', source: 'typings' });
    expect(response.page.notices[0]).toMatch(
      /^Read from Core typings instead of Core API reference: .*not responding \(timeout\)\.$/,
    );
  });

  it.each([
    ['an unreachable upstream', unavailable],
    [
      'a refusing upstream',
      new McpDocError('UPSTREAM_BLOCKED', 'developers.arcgis.com refused the request', {
        why: 'The server answered 403',
        retryable: false,
      }),
    ],
  ])('returns a link-only page instead of failing for %s', async (_name, error) => {
    const h = harness();
    await h.index.ensure(jsSdk, ['guide'], makeLine(), h.call());
    h.adapter('gatsby').failOn('read', error);
    const response = await read(h, { ref: GUIDE_URL, section: 'enable-clustering' });
    expect(response.page.degraded?.level).toBe('link-only');
    // The title comes from the catalogue index when the page is known there.
    expect(response.page).toMatchObject({
      title: 'Cluster points',
      product: 'js-maps-sdk',
      source: 'guide',
      url: GUIDE_URL,
    });
    expect(response.text).toContain(`Open it directly: <${GUIDE_URL}>`);
    expect(response.truncated).toBe(false);
    expect(h.index.queryBodies({ text: 'retrieved', products: ['js-maps-sdk'], limit: 3 })).toEqual(
      [],
    );
  });

  it('falls through every fallback to a link-only page', async () => {
    const h = harness();
    h.adapter('astro').failOn('read', unavailable);
    h.adapter('npm-dts').failOn('read', new McpDocError('DOC_NOT_FOUND', 'no such module'));
    const response = await read(h, { ref: API_URL });
    expect(response.page.degraded?.level).toBe('link-only');
    expect(response.page.title).toBe('FeatureLayer');
  });

  it('labels stale content', async () => {
    const h = harness();
    h.adapter('gatsby').addPage(guidePage({ cache: 'stale' }));
    const response = await read(h, { ref: GUIDE_URL });
    expect(response.page.degraded).toEqual({
      level: 'stale',
      reason: 'served from an expired cached copy after an upstream failure',
    });
    expect(response.text).toContain('Clusters group nearby points.');
  });

  it('keeps the rung an adapter already reported', async () => {
    const h = harness();
    const degraded = {
      level: 'generic-extractor',
      reason: 'profile selectors matched nothing',
    } as const;
    h.adapter('gatsby').addPage(guidePage({ cache: 'stale', degraded }));
    expect((await read(h, { ref: GUIDE_URL })).page.degraded).toEqual(degraded);
  });

  it('keeps errors the agent can act on: not found, offline, GitHub quota', async () => {
    const h = harness();
    await expect(read(h, { ref: `${JS}/no-such-page/` })).rejects.toMatchObject({
      code: 'DOC_NOT_FOUND',
      details: { next: 'arcgis_docs_search({"query":"No such page","product":"js-maps-sdk"})' },
    });
    h.adapter('gatsby').failOn(
      'read',
      new McpDocError('OFFLINE_MISS', 'not cached', { next: 'unset ARCGIS_DOCS_OFFLINE' }),
    );
    await expect(read(h, { ref: GUIDE_URL })).rejects.toMatchObject({ code: 'OFFLINE_MISS' });
    h.adapter('gatsby').failOn('read', new McpDocError('RATE_LIMITED_GITHUB', 'quota'));
    await expect(read(h, { ref: GUIDE_URL })).rejects.toMatchObject({
      code: 'RATE_LIMITED_GITHUB',
    });
  });

  it('wraps an adapter crash as INTERNAL and logs it', async () => {
    const h = harness();
    h.adapter('gatsby').failOn('read', new TypeError('cannot read properties of undefined'));
    await expect(read(h, { ref: GUIDE_URL })).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(h.ctx.logger.messages('error')).toEqual(['adapter read failed unexpectedly']);
  });
});

describe('page', () => {
  it('returns the converted page without view logic and passes the selector on', async () => {
    const h = harness();
    const page = await h.services.docs.page(API_URL, h.call(), { member: 'applyEdits' });
    expect(page.sections).toHaveLength(4);
    expect(h.adapter('astro').calls[0]?.target?.select).toEqual({ member: 'applyEdits' });
    expect(h.adapter('astro').calls[0]?.target?.focusedCode).toBeUndefined();
  });
});
