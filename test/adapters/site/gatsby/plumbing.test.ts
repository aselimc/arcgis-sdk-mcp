import { describe, expect, it } from 'vitest';
import {
  bodyModeOf,
  bodyVariantOf,
  documentOf,
} from '../../../../src/adapters/site/gatsby/body.js';
import { GatsbySession } from '../../../../src/adapters/site/gatsby/session.js';
import { loadStaticQueries, rolesOf } from '../../../../src/adapters/site/gatsby/static-queries.js';
import { isMcpDocError } from '../../../../src/core/errors.js';
import { D, guide, rest } from './sites.js';

describe('body variants', () => {
  it('derives the body mode from bodyFrom, else from the symbols mode', () => {
    expect(bodyModeOf({ base: '/x/' })).toBe('html');
    expect(bodyModeOf({ base: '/x/', symbols: 'rest-operations' })).toBe('html');
    expect(bodyModeOf({ base: '/x/', symbols: 'glossary' })).toBe('html');
    expect(bodyModeOf({ base: '/x/', symbols: 'fuse-store' })).toBe('html');
    expect(bodyModeOf({ base: '/x/', symbols: 'typedoc' })).toBe('auto');
    expect(bodyModeOf({ base: '/x/', symbols: 'openapi' })).toBe('auto');
    expect(bodyModeOf({ base: '/x/', symbols: 'apiref-nav' })).toBe('auto');
    expect(bodyModeOf({ base: '/x/', symbols: 'sphinx-pagination' })).toBe('auto');
    expect(bodyModeOf({ base: '/x/', symbols: 'typedoc', bodyFrom: 'html' })).toBe('html');
    expect(bodyModeOf({ base: '/x/', bodyFrom: 'apiRef' })).toBe('apiRef');
  });

  const data = {
    openApiOperationPage: { title: '/a', operation: { operationId: 'aGet' } },
    typedocPage: { title: 'T', raw: { name: 'T' } },
    sphinxJson: { title: 'm module', html: '<section>m</section>' },
    jupyterNotebook: { title: 'Notebook', html: '<div>cells</div>' },
    apiRef: { title: 'IThing', html: '<p>thing</p>' },
    mdxPage: { title: 'thing', childMarkdownRemark: { html: '<p>spec</p>' } },
  };

  it('prefers structured bodies in auto mode', () => {
    expect(bodyVariantOf(data, 'auto')).toEqual({
      renderer: 'openapi',
      operation: { operationId: 'aGet' },
      title: '/a',
    });
    const { openApiOperationPage: _operation, ...withoutOperation } = data;
    expect(bodyVariantOf(withoutOperation, 'auto')?.renderer).toBe('typedoc');
    expect(
      bodyVariantOf({ openApiOperationPage: null, openApiSchemasPage: { schemas: [] } }, 'auto'),
    ).toEqual({ renderer: 'openapi', schemas: [], title: '' });
  });

  it('takes exactly the field an explicit mode names', () => {
    expect(bodyVariantOf(data, 'sphinxJson')).toEqual({
      renderer: 'sphinx',
      html: '<section>m</section>',
      title: 'm module',
    });
    expect(bodyVariantOf(data, 'jupyterNotebook')).toMatchObject({
      html: '<div>cells</div>',
      title: 'Notebook',
    });
    expect(bodyVariantOf(data, 'apiRef')).toMatchObject({ html: '<p>thing</p>', title: 'IThing' });
    expect(bodyVariantOf(data, 'childMarkdownRemark')).toMatchObject({
      html: '<p>spec</p>',
      title: 'thing',
    });
    expect(bodyVariantOf({ sphinxJson: data.sphinxJson }, 'apiRef')).toBeUndefined();
  });

  it('finds no body in a prose page or behind renamed fields', () => {
    expect(bodyVariantOf({ mdxPage: { title: 'Prose' } }, 'auto')).toBeUndefined();
    expect(bodyVariantOf({ sphinxJson: { body: '<p>x</p>' } }, 'auto')).toBeUndefined();
    expect(bodyVariantOf({ apiRef: { html: '   ' } }, 'apiRef')).toBeUndefined();
    expect(bodyVariantOf({ typedocPage: { raw: 'text' } }, 'auto')).toBeUndefined();
    expect(bodyVariantOf({}, 'html')).toBeUndefined();
  });

  it('wraps a fragment into a document, escaping the title', () => {
    expect(documentOf('A <b> & c', '<p>x</p>')).toBe(
      '<!doctype html><html><head><title>A &lt;b&gt; &amp; c</title></head><body><main><h1>A &lt;b&gt; &amp; c</h1><p>x</p></main></body></html>',
    );
    expect(documentOf('T', '<h1 class="t">Own</h1>')).not.toContain('<h1>T</h1>');
    expect(documentOf('', '<p>x</p>')).toContain('<main><p>x</p></main>');
  });
});

describe('static queries', () => {
  const prefix = `${D}/rest/gadgets/`;
  const hashes = ['1000000001', '2000000002', '1000000002', '1000000003', '3000000003'];

  it('stops as soon as every wanted role is found', async () => {
    const s = rest();
    const ctx = s.ctx();
    const session = new GatsbySession(ctx, s.bound(), 24);
    const found = await loadStaticQueries(session, prefix, hashes, ['glossary']);
    expect(found.glossaryTerms).toHaveLength(1);
    expect(ctx.http.count()).toBe(2);
  });

  it('requests nothing when nothing is wanted or no hash is listed', async () => {
    const s = rest();
    const ctx = s.ctx();
    const session = new GatsbySession(ctx, s.bound(), 24);
    expect(rolesOf(await loadStaticQueries(session, prefix, hashes, []))).toEqual([]);
    expect(rolesOf(await loadStaticQueries(session, prefix, [], ['nav']))).toEqual([]);
    expect(ctx.http.count()).toBe(0);
  });

  it('never asks again for a hash known to hold nothing wanted', async () => {
    const s = rest();
    const ctx = s.ctx();
    const first = new GatsbySession(ctx, s.bound(), 24);
    await loadStaticQueries(first, prefix, hashes, ['nav', 'search']);
    expect(await ctx.cache.getDerived('misc', 'gatsby-static-query-roles')).toEqual({
      '1000000001': [],
      '2000000002': ['glossary'],
      '1000000002': [],
      '1000000003': [],
      '3000000003': ['nav', 'search'],
    });

    ctx.http.resetLog();
    const second = new GatsbySession(ctx, s.bound(), 24);
    await loadStaticQueries(second, prefix, hashes, ['glossary']);
    expect(ctx.http.requests.map((request) => request.url)).toEqual([
      `${prefix}page-data/sq/d/2000000002.json`,
    ]);
  });

  it('does not write a hash off for one empty answer', async () => {
    const s = rest();
    const ctx = s.ctx();
    await ctx.cache.putDerived('misc', 'gatsby-static-query-roles', {
      '1000000001': ['nav'],
      broken: 'not a list',
    });
    const session = new GatsbySession(ctx, s.bound(), 24);
    await loadStaticQueries(session, prefix, ['1000000001'], ['nav']);
    expect(await ctx.cache.getDerived('misc', 'gatsby-static-query-roles')).toMatchObject({
      '1000000001': ['nav'],
    });
  });

  it('ignores a static query without a data object', async () => {
    const s = rest();
    const ctx = s.ctx();
    ctx.http.on(`${prefix}page-data/sq/d/9.json`, { json: { errors: [] } });
    const session = new GatsbySession(ctx, s.bound(), 24);
    expect(rolesOf(await loadStaticQueries(session, prefix, ['9'], ['nav']))).toEqual([]);
  });
});

describe('GatsbySession', () => {
  it('refuses further requests once its allowance is spent', async () => {
    const s = guide();
    const ctx = s.ctx();
    const session = new GatsbySession(ctx, s.bound(), 1);
    expect(session.remaining()).toBe(1);
    await session.xml(`${D}/widgets/sitemap-0.xml`);
    expect(session.remaining()).toBe(0);
    const [outcome] = await Promise.allSettled([session.xml(`${D}/widgets/sitemap-0.xml`)]);
    expect(outcome.status).toBe('rejected');
    expect(
      outcome.status === 'rejected' && isMcpDocError(outcome.reason) && outcome.reason.details?.why,
    ).toContain('at most 1 requests');
    expect(ctx.http.count()).toBe(1);
  });

  it('does not ask a host again after it refused', async () => {
    const s = guide();
    const ctx = s.ctx();
    ctx.http.fail(/sitemap/, 429);
    const session = new GatsbySession(ctx, s.bound(), 10);
    const first = await Promise.allSettled([session.xml(`${D}/widgets/sitemap-0.xml`)]);
    const second = await Promise.allSettled([
      session.json(`${D}/widgets/page-data/index/page-data.json`),
    ]);
    expect(first[0].status).toBe('rejected');
    expect(
      second[0].status === 'rejected' && isMcpDocError(second[0].reason) && second[0].reason.code,
    ).toBe('UPSTREAM_BLOCKED');
    expect(ctx.http.count()).toBe(1);
  });

  it('turns an upstream failure of optional work into undefined', async () => {
    const s = guide();
    const ctx = s.ctx();
    ctx.http.fail(/sitemap/, 503);
    const session = new GatsbySession(ctx, s.bound(), 10);
    expect(
      await session.optional('The sitemap', () => session.xml(`${D}/widgets/sitemap-0.xml`)),
    ).toBeUndefined();
    expect(
      ctx.logger.entries.some((entry) => entry.msg.includes('The sitemap is unavailable')),
    ).toBe(true);
  });
});
