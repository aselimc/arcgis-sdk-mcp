import { describe, expect, it } from 'vitest';
import {
  makeDocPage,
  makeHost,
  makeLine,
  makeProduct,
  makeSource,
} from '../../support/builders.js';
import { makeHarness } from '../support/harness.js';
import { API_URL, DEV, GUIDE_URL, harness, read } from './fixtures.js';

describe('read: routing', () => {
  it('reads a brief, with or without a source that lists it', async () => {
    const h = harness();
    const overview = await read(h, { ref: 'brief:ai/overview' });
    expect(overview.page).toMatchObject({
      ref: 'brief:ai/overview',
      kind: 'brief',
      license: 'project',
      attribution: '',
      product: 'ai-agents',
      source: 'briefs',
    });
    expect(overview.text).toContain('## MCP servers');
    expect((await read(h, { ref: 'brief:ai/overview#mcp-servers' })).text).toBe(
      '## MCP servers\n\nServers that let an agent call location services.',
    );

    const loose = await read(h, { ref: 'BRIEF:auth/choosing-authentication' });
    expect(loose.page.title).toBe('Choosing an authentication type');
    expect(loose.page.product).toBeUndefined();
    expect(h.ctx.http.requests).toEqual([]);
  });

  // Regression: `brief:index` listed no slug at all, because none is near it.
  it('answers an unknown brief with every slug, the nearest first', async () => {
    const h = harness();
    const slugs = h.ctx.registry.briefs().map((brief) => `brief:${brief.slug}`);
    const near: unknown = await read(h, { ref: 'brief:ai/overvew' }).catch((e: unknown) => e);
    expect(near).toMatchObject({
      code: 'DOC_NOT_FOUND',
      details: { next: 'arcgis_docs_read({"ref":"brief:ai/overview"})' },
    });
    const listed = (near as { details: { candidates: string[] } }).details.candidates;
    expect(listed[0]).toBe('brief:ai/overview');
    expect([...listed].sort()).toEqual([...slugs].sort());

    const far: unknown = await read(h, { ref: 'brief:index' }).catch((e: unknown) => e);
    expect([...(far as { details: { candidates: string[] } }).details.candidates].sort()).toEqual(
      [...slugs].sort(),
    );
  });

  // Regression: the URI under which the server lists a brief as an MCP resource was
  // refused with "Only https URLs can be read".
  it('reads a brief by its resource URI, and points a product resource at the product list', async () => {
    const h = harness();
    const viaUri = await read(h, { ref: 'arcgis-docs://brief/ai/overview' });
    expect(viaUri.page.ref).toBe('brief:ai/overview');
    await expect(read(h, { ref: 'arcgis-docs://product/js-maps-sdk' })).rejects.toMatchObject({
      code: 'DOC_NOT_FOUND',
      details: { next: 'arcgis_docs_list_products({"product":"js-maps-sdk"})' },
    });
  });

  it('rejects text that is not a ref with a search to try', async () => {
    const h = harness();
    await expect(read(h, { ref: 'FeatureLayer.queryFeatures' })).rejects.toMatchObject({
      code: 'DOC_NOT_FOUND',
      details: { next: 'arcgis_docs_search({"query":"FeatureLayer.queryFeatures"})' },
    });
  });

  it('reads any page of an allowed host through the generic HTML path', async () => {
    const h = harness();
    const url = `${DEV}/unlisted-product/intro/`;
    h.ctx.http.on(url, {
      body: '<html><body><main><h1>Unlisted</h1><p>Some words.</p></main></body></html>',
    });
    const response = await read(h, { ref: `${url}?utm_source=x` });
    expect(response.text).toContain('Unlisted Some words.');
    expect(response.page).toMatchObject({ url, kind: 'guide', license: 'esri-website-terms' });
    expect(response.page.product).toBeUndefined();
    expect(h.ctx.http.requests[0]).toMatchObject({ url, expect: 'html' });
  });

  it('turns a missing generic page into DOC_NOT_FOUND with a search, and an unreachable one into a link', async () => {
    const h = harness();
    const url = `${DEV}/unlisted-product/gone-page/`;
    h.ctx.http.on(url, { status: 404 });
    await expect(read(h, { ref: url })).rejects.toMatchObject({
      code: 'DOC_NOT_FOUND',
      details: { next: 'arcgis_docs_search({"query":"Gone page"})' },
    });
    h.ctx.http.fail(url, 'timeout');
    const response = await read(h, { ref: url });
    expect(response.page.degraded).toMatchObject({ level: 'link-only' });
    expect(response.page.title).toBe('Gone page');
  });

  it('reads unregistered GitHub files by their type', async () => {
    const h = harness();
    h.ctx.github.addRepo('Esri/some-tool', {
      license: 'apache-2.0',
      files: {
        main: {
          'docs/usage.md': '# Usage\n\nRun the tool.',
          'src/tool.py': 'print("hi")',
          'nb/demo.ipynb': '{"cells":[]}',
          'nb/broken.ipynb': '{not json',
        },
      },
      wiki: { Home: '# Wiki home\n\nWelcome.' },
    });
    const markdown = await read(h, {
      ref: 'https://github.com/Esri/some-tool/blob/main/docs/usage.md',
    });
    expect(markdown.text).toBe('# Usage\n\nRun the tool.');
    expect(markdown.page).toMatchObject({
      license: 'apache-2.0',
      ref: 'https://github.com/Esri/some-tool/blob/main/docs/usage.md',
    });

    expect(
      (await read(h, { ref: 'https://github.com/Esri/some-tool/blob/main/src/tool.py' })).text,
    ).toBe('# Rendered by source');
    expect(
      (await read(h, { ref: 'https://github.com/Esri/some-tool/blob/main/nb/demo.ipynb' })).text,
    ).toBe('# Rendered by notebook');
    expect(
      (await read(h, { ref: 'https://github.com/Esri/some-tool/blob/main/nb/broken.ipynb' })).text,
    ).toBe('# Rendered by source');
    expect((await read(h, { ref: 'https://github.com/Esri/some-tool/wiki' })).text).toBe(
      '# Wiki home\n\nWelcome.',
    );
    expect(h.ctx.github.calls.every((call) => call.method !== 'tree')).toBe(true);

    await expect(read(h, { ref: 'https://github.com/Esri/some-tool' })).rejects.toMatchObject({
      code: 'DOC_NOT_FOUND',
    });
    await expect(
      read(h, { ref: 'https://github.com/Esri/some-tool/blob/main/missing.md' }),
    ).rejects.toMatchObject({
      code: 'DOC_NOT_FOUND',
      details: { next: expect.stringContaining('arcgis_docs_search') as string },
    });
  });

  it('attributes a GitHub file conservatively when the licence cannot be read', async () => {
    const h = harness();
    h.ctx.github
      .addRepo('Esri/some-tool', { files: { main: { 'README.md': '# Readme' } } })
      .exhaustQuota('2026-10-13T13:00:00Z');
    const response = await read(h, {
      ref: 'https://github.com/Esri/some-tool/blob/main/README.md',
    });
    expect(response.page.license).toBe('unlicensed');
  });

  it('lets an adapter claim a URL inside its product', async () => {
    const h = harness({
      adapters: { 'npm-dts': { owns: (url) => url.pathname.includes('/layers/') } },
    });
    h.adapter('npm-dts').addPage(
      makeDocPage({ url: API_URL, markdown: '# FeatureLayer (typings)\n\nFrom the package.' }),
    );
    const response = await read(h, { ref: API_URL });
    expect(response.text).toContain('From the package.');
    expect(response.page.source).toBe('typings');
  });

  it('asks astro tutorials for focused code and says so, except in view "full"', async () => {
    const tutorial = `${DEV}/widgets/tutorials/first-widget/`;
    const product = makeProduct({ sources: [makeSource('astro', { base: '/widgets/' })] });
    const h = makeHarness({ products: [product], records: [] });
    h.adapter('astro').addPage(
      makeDocPage({ url: tutorial, kind: 'tutorial', markdown: '# First widget\n\nStep one.' }),
    );
    const focused = await read(h, { ref: tutorial });
    expect(h.adapter('astro').calls[0]?.target?.focusedCode).toBe(true);
    expect(focused.page.notices).toEqual([
      expect.stringContaining('only the lines each step adds'),
    ]);

    const full = await read(h, { ref: tutorial, view: 'full' });
    expect(h.adapter('astro').calls[1]?.target?.focusedCode).toBeUndefined();
    expect(full.page.notices).toEqual([]);
  });
});

describe('read: policy', () => {
  const hosts = [
    makeHost(),
    makeHost({ host: 'archive.developers.arcgis.com', capability: null }),
    makeHost({ host: 'raw.githubusercontent.com', capability: 'github' }),
    makeHost({ host: 'cdn.jsdelivr.net', capability: 'package-cdn' }),
  ];

  it('refuses hosts outside the allow-list and names the documentation hosts', async () => {
    const h = harness({ hosts });
    await expect(read(h, { ref: 'https://example.com/docs/page/' })).rejects.toMatchObject({
      code: 'HOST_NOT_ALLOWED',
      details: {
        candidates: ['developers.arcgis.com', 'raw.githubusercontent.com', 'cdn.jsdelivr.net'],
        next: 'arcgis_docs_search({"query":"Page"})',
      },
    });
    await expect(read(h, { ref: 'ftp://developers.arcgis.com/x' })).rejects.toMatchObject({
      code: 'HOST_NOT_ALLOWED',
    });
    expect(h.ctx.http.requests).toEqual([]);
  });

  it('answers a link-only host with LINK_ONLY and never fetches it', async () => {
    const h = harness({ hosts });
    await expect(
      read(h, { ref: 'https://archive.developers.arcgis.com/android/guide/offline/' }),
    ).rejects.toMatchObject({
      code: 'LINK_ONLY',
      details: { next: 'arcgis_docs_search({"query":"Offline"})' },
    });
    expect(h.ctx.http.requests).toEqual([]);
  });

  it('checks a GitHub ref as the raw URL that would be fetched', async () => {
    const h = harness({ hosts, enabled: ['website'] });
    await expect(
      read(h, { ref: 'https://github.com/Esri/some-tool/blob/main/README.md' }),
    ).rejects.toMatchObject({
      code: 'SOURCE_DISABLED',
      details: { capability: 'github' },
    });
  });

  it('answers a link-only version line with LINK_ONLY and the alternative', async () => {
    const archived = makeLine({
      id: 'v4',
      label: '4.x',
      current: false,
      access: 'link-only',
      vars: { tree: '4.34' },
    });
    const current = makeLine({ vars: { tree: 'latest' } });
    const product = makeProduct({
      id: 'js-old',
      name: 'JavaScript SDK',
      lines: [current, archived],
      sources: [
        makeSource('gatsby', { base: '/javascript/{tree}/' }),
        makeSource(
          'npm-dts',
          { package: '@arcgis/core', docUrl: '/javascript/{tree}/api-reference/{path}' },
          { id: 'typings', floor: false, capability: 'package-cdn' },
        ),
      ],
    });
    const h = makeHarness({ products: [product], records: [] });
    await expect(
      read(h, { ref: `${DEV}/javascript/4.34/api-reference/esri-Map.html` }),
    ).rejects.toMatchObject({
      code: 'LINK_ONLY',
      message: 'JavaScript SDK 4.x pages are not fetched',
      details: {
        why: expect.stringContaining('arcgis_docs_lookup_symbol') as string,
        next: 'arcgis_docs_list_products({"product":"js-old"})',
      },
    });
    expect(h.adapter('gatsby').count()).toBe(0);
  });

  it('answers SOURCE_DISABLED with the exact setting when the capability is off', async () => {
    const h = harness({ enabled: ['github'] });
    await expect(read(h, { ref: GUIDE_URL })).rejects.toMatchObject({
      code: 'SOURCE_DISABLED',
      details: { capability: 'website', next: 'Set ARCGIS_DOCS_SOURCES=+website' },
    });
    expect(h.adapter('gatsby').count()).toBe(0);
  });

  it('reads through a declared fallback when the primary capability is off', async () => {
    const h = harness({ enabled: ['package-cdn'] });
    h.adapter('npm-dts').addPage(
      makeDocPage({ url: API_URL, markdown: '# FeatureLayer (typings)\n\nFrom the package.' }),
    );
    const response = await read(h, { ref: API_URL });
    expect(response.text).toContain('From the package.');
    expect(response.page.notices).toEqual([
      'Read from Core typings instead of Core API reference: Core API reference is switched off.',
    ]);
    expect(h.adapter('astro').count()).toBe(0);
  });
});
