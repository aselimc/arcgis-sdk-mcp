import { describe, expect, it } from 'vitest';
import { gatsbyAdapter } from '../../../../src/adapters/site/gatsby/index.js';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import { isMcpDocError } from '../../../../src/core/errors.js';
import type { RendererInputs } from '../../../../src/core/ports.js';
import { makeLine, makeRecord } from '../../../support/builders.js';
import type { RenderCall } from '../../../support/fake-render.js';
import type { TestCtx } from '../../../support/make-ctx.js';
import {
  D,
  apiref,
  engine,
  guide,
  openapi,
  pythonApi,
  pythonGuide,
  rest,
  site,
  spec,
  typedoc,
} from './sites.js';

/** The single render call of a read, with its input typed for the expected renderer. */
function rendered<K extends keyof RendererInputs>(
  ctx: TestCtx,
  kind: K,
): RenderCall & { input: RendererInputs[K] } {
  const calls = (ctx.render as { calls?: RenderCall[] }).calls ?? [];
  expect(calls).toHaveLength(1);
  const call = calls[0];
  if (call === undefined) throw new Error('nothing was rendered');
  expect(call.kind).toBe(kind);
  return call as RenderCall & { input: RendererInputs[K] };
}

async function rejection(work: Promise<unknown>): Promise<unknown> {
  const [outcome] = await Promise.allSettled([work]);
  if (outcome.status === 'fulfilled') throw new Error('expected a rejection');
  return outcome.reason;
}

describe('gatsby read: HTML pages', () => {
  it('reads a prose page with one request and no page-data', async () => {
    const s = guide();
    const ctx = s.ctx();
    const url = `${D}/widgets/get-started/`;
    const page = await gatsbyAdapter.read(ctx, s.bound(), { url: new URL(url) });

    expect(ctx.http.requests.map((request) => request.url)).toEqual([url]);
    const call = rendered(ctx, 'html');
    expect(call.input.html).toContain('Install the package');
    expect(call.input.familyHint).toBeUndefined();
    expect(call.meta).toMatchObject({
      url,
      product: 'widgets-sdk',
      source: 'guide',
      line: 'latest',
      kind: 'guide',
      license: 'esri-website-terms',
    });
    expect(page.ref).toBe(url);
    expect(page.attribution).toContain('developers.arcgis.com/widgets/get-started/');
  });

  it('passes the family of the source probe as a hint', async () => {
    const s = rest();
    const ctx = s.ctx();
    await gatsbyAdapter.read(ctx, s.bound(), {
      url: new URL(`${D}/rest/gadgets/apply-changes-gadget-service/`),
    });
    expect(rendered(ctx, 'html').input.familyHint).toBe('gatsby-rest');
  });

  it('keeps the fragment in the ref and forwards selector and detail', async () => {
    const s = guide();
    const ctx = s.ctx();
    const page = await gatsbyAdapter.read(ctx, s.bound(), {
      url: new URL(`${D}/widgets/get-started/#install`),
      select: { section: 'install' },
      detail: 'summary',
    });
    expect(page.ref).toBe(`${D}/widgets/get-started/#install`);
    expect(page.url).toBe(`${D}/widgets/get-started/`);
    expect(rendered(ctx, 'html').opts).toEqual({
      select: { section: 'install' },
      detail: 'summary',
    });
  });

  it('takes kind and breadcrumb from the record that led to the page', async () => {
    const s = guide();
    const ctx = s.ctx();
    const record = makeRecord({ kind: 'tutorial', breadcrumb: 'Tutorials > Basics' });
    const page = await gatsbyAdapter.read(ctx, s.bound(), { url: new URL(record.ref), record });
    expect(page.kind).toBe('tutorial');
    expect(page.breadcrumb).toBe('Tutorials > Basics');
  });

  it('classifies a page read by URL from its path', async () => {
    const s = guide({ classify: [['^get-started/', 'tutorial']] });
    const ctx = s.ctx();
    const page = await gatsbyAdapter.read(ctx, s.bound(), {
      url: new URL(`${D}/widgets/get-started/`),
    });
    expect(page.kind).toBe('tutorial');
  });

  it('names the page by the URL a redirect landed on', async () => {
    const s = guide();
    const ctx = s.ctx();
    const old = `${D}/widgets/getting-started.htm`;
    ctx.http.on(old, {
      body: '<main><h1>Get started</h1></main>',
      finalUrl: `${D}/widgets/get-started/`,
      aliasChain: [old],
    });
    const page = await gatsbyAdapter.read(ctx, s.bound(), { url: new URL(`${old}#install`) });
    expect(page.ref).toBe(`${D}/widgets/get-started/#install`);
    expect(page.redirectedFrom).toEqual([old]);
  });

  it('reports a missing page as DOC_NOT_FOUND', async () => {
    const s = guide();
    const ctx = s.ctx();
    ctx.http.fail(/.*/, 404);
    const error = await rejection(
      gatsbyAdapter.read(ctx, s.bound(), { url: new URL(`${D}/widgets/get-started/`) }),
    );
    expect(isMcpDocError(error) && error.code).toBe('DOC_NOT_FOUND');
  });

  it('answers LINK_ONLY for a link-only line without a request', async () => {
    const s = guide();
    const ctx = s.ctx();
    const src = bindSource(s.product, s.source, makeLine({ access: 'link-only' }));
    const url = `${D}/widgets/get-started/`;
    const error = await rejection(gatsbyAdapter.read(ctx, src, { url: new URL(url) }));
    expect(isMcpDocError(error) && error.code).toBe('LINK_ONLY');
    expect(isMcpDocError(error) && error.details?.url).toBe(url);
    expect(ctx.http.count()).toBe(0);
  });
});

describe('gatsby read: bodies in page-data', () => {
  it('renders a TypeDoc reflection from page-data alone', async () => {
    const s = typedoc();
    const ctx = s.ctx();
    const url = `${D}/toolkit-js/api-reference/toolkit-request/RequestManager/`;
    const page = await gatsbyAdapter.read(ctx, s.bound(), {
      url: new URL(url),
      select: { member: 'send' },
    });

    const pageData = `${D}/toolkit-js/page-data/api-reference/toolkit-request/RequestManager/page-data.json`;
    expect(ctx.http.requests.map((request) => request.url)).toEqual([pageData]);
    const call = rendered(ctx, 'typedoc');
    expect(call.input.raw).toMatchObject({ name: 'RequestManager', kind: 128 });
    expect(call.input.member).toBe('send');
    // The public URL is the ref; the response is the page-data's.
    expect(call.meta.url).toBe(url);
    expect(call.meta.res?.url).toBe(pageData);
    expect(call.meta.kind).toBe('api');
    expect(page.ref).toBe(url);
  });

  it('falls back to the HTML page when page-data has no body', async () => {
    const s = typedoc();
    const ctx = s.ctx();
    const url = `${D}/toolkit-js/get-started/`;
    await gatsbyAdapter.read(ctx, s.bound(), { url: new URL(url) });
    expect(ctx.http.requests.map((request) => request.url)).toEqual([
      `${D}/toolkit-js/page-data/get-started/page-data.json`,
      url,
    ]);
    expect(rendered(ctx, 'html').input.html).toContain('Install the toolkit');
  });

  it.each([
    ['is failing', 503],
    ['is a catch-all HTML page', 'html'],
    ['is truncated', 'truncated'],
  ] as const)('falls back to the HTML page when page-data %s', async (_label, fault) => {
    const s = typedoc();
    const ctx = s.ctx();
    ctx.http.fail(/\/page-data\//, fault);
    await gatsbyAdapter.read(ctx, s.bound(), { url: new URL(`${D}/toolkit-js/get-started/`) });
    expect(rendered(ctx, 'html').meta.res?.url).toBe(`${D}/toolkit-js/get-started/`);
  });

  it('falls back to the HTML page when page-data has lost its envelope', async () => {
    const s = site('typedoc', { base: '/toolkit-js/', bodyFrom: 'auto' });
    const ctx = s.ctx();
    ctx.http.on(/page-data\/authentication\/page-data\.json$/, { json: { renamed: {} } });
    ctx.http.on(`${D}/toolkit-js/authentication/`, {
      body: '<main><h1>Authentication</h1></main>',
    });
    await gatsbyAdapter.read(ctx, s.bound(), { url: new URL(`${D}/toolkit-js/authentication/`) });
    expect(rendered(ctx, 'html').input.html).toContain('Authentication');
  });

  it('renders an OpenAPI operation with the site prefix for its links', async () => {
    const s = openapi();
    const ctx = s.ctx();
    await gatsbyAdapter.read(ctx, s.bound(), {
      url: new URL(`${D}/services/beacons/near-point-get/`),
    });
    expect(ctx.http.count()).toBe(1);
    const call = rendered(ctx, 'openapi');
    expect(call.input.operation).toMatchObject({ operationId: 'nearPointGet', method: 'get' });
    expect(call.input.schemas).toBeUndefined();
    expect(call.input.sitePrefix).toBe('/services');
    expect(call.input.target).toBeUndefined();
    // Read by URL, without a record: a generated operation page is API documentation.
    expect(call.meta.kind).toBe('api');
  });

  it('renders the schemas page and passes a fragment as the target', async () => {
    const s = openapi();
    const ctx = s.ctx();
    await gatsbyAdapter.read(ctx, s.bound(), {
      url: new URL(`${D}/services/beacons/types/#xcoord`),
    });
    const call = rendered(ctx, 'openapi');
    expect(call.input.operation).toBeUndefined();
    expect(call.input.schemas).toEqual([
      { name: 'XCoord', type: 'number', description: 'A longitude.' },
    ]);
    expect(call.input.target).toBe('xcoord');
  });

  it('wraps an apiRef fragment into a document with its title', async () => {
    const s = apiref();
    const ctx = s.ctx();
    const page = await gatsbyAdapter.read(ctx, s.bound(), {
      url: new URL(`${D}/server-sdk/api-reference/net/IScaleRange/`),
    });
    const call = rendered(ctx, 'html');
    expect(call.input.html).toContain('<title>IScaleRange</title>');
    expect(call.input.html).toContain('<main><h1>IScaleRange</h1><p>Limits the scales');
    expect(call.meta.kind).toBe('api');
    expect(page.title).not.toBe('');
  });

  it('renders a notebook page from jupyterNotebook.html', async () => {
    const s = pythonGuide();
    const ctx = s.ctx();
    await gatsbyAdapter.read(ctx, s.bound(), {
      url: new URL(`${D}/pylib/latest/guide/first-notebook/`),
    });
    expect(ctx.http.count()).toBe(1);
    const call = rendered(ctx, 'html');
    expect(call.input.html).toContain('<h1>A first notebook</h1>');
    expect(call.input.html).toContain('gis = connect()');
  });

  it('renders a specification page verbatim under its own name', async () => {
    const s = spec();
    const ctx = s.ctx();
    const page = await gatsbyAdapter.read(ctx, s.bound(), {
      url: new URL(`${D}/thing-specification/objects/thingLayer/`),
    });
    const call = rendered(ctx, 'html');
    expect(call.input.html).toContain('The thingLayer object describes');
    expect(call.opts).toEqual({ verbatim: true });
    expect(call.meta).toMatchObject({
      license: 'cc-by-nd',
      specName: s.product.name,
      kind: 'spec',
    });
    expect(page.license).toBe('cc-by-nd');
  });

  it('keeps a specification verbatim when it falls back to the HTML page', async () => {
    const s = spec();
    const ctx = s.ctx();
    ctx.http.fail(/\/page-data\//, 404);
    const url = `${D}/thing-specification/objects/thingLayer/`;
    await gatsbyAdapter.read(ctx, s.bound(), { url: new URL(url), detail: 'full' });
    const call = rendered(ctx, 'html');
    expect(call.meta.res?.url).toBe(url);
    expect(call.opts).toEqual({ detail: 'full', verbatim: true });
    expect(call.meta.specName).toBe(s.product.name);
  });

  it('ignores a body of another kind than the one the source names', async () => {
    const s = site('python', { base: '/pylib/latest/', bodyFrom: 'sphinxJson' });
    const ctx = s.ctx();
    ctx.http.on(`${D}/pylib/latest/guide/first-notebook/`, {
      body: '<main><h1>A first notebook</h1></main>',
    });
    await gatsbyAdapter.read(ctx, s.bound(), {
      url: new URL(`${D}/pylib/latest/guide/first-notebook/`),
    });
    expect(ctx.http.count()).toBe(2);
    expect(rendered(ctx, 'html').input.html).toBe('<main><h1>A first notebook</h1></main>');
  });
});

describe('gatsby read: site prefix above the source base', () => {
  const url = `${D}/pylib/latest/api-reference/pylib.geocoding.html`;

  it('finds the prefix by walking up, slices by anchor and remembers the prefix', async () => {
    const s = pythonApi();
    const ctx = s.ctx();
    await gatsbyAdapter.read(ctx, s.bound(), {
      url: new URL(`${url}#pylib.geocoding.geocode`),
    });
    expect(ctx.http.requests.map((request) => request.url)).toEqual([
      `${D}/pylib/latest/api-reference/page-data/pylib.geocoding.html/page-data.json`,
      `${D}/pylib/latest/page-data/api-reference/pylib.geocoding.html/page-data.json`,
    ]);
    const call = rendered(ctx, 'sphinx');
    expect(call.input.html).toContain('dl class="py function"');
    expect(call.input.anchor).toBe('pylib.geocoding.geocode');
    expect(call.meta.kind).toBe('api');

    ctx.http.resetLog();
    await gatsbyAdapter.read(ctx, s.bound(), { url: new URL(url) });
    expect(ctx.http.count()).toBe(1);
  });

  it('prefers the member selector over the fragment as the Sphinx anchor', async () => {
    const s = pythonApi();
    const ctx = s.ctx();
    await gatsbyAdapter.read(ctx, s.bound(), {
      url: new URL(`${url}#geocode`),
      select: { member: 'pylib.geocoding.geocode' },
    });
    expect(rendered(ctx, 'sphinx').input.anchor).toBe('pylib.geocoding.geocode');
  });

  it('reads the public HTML page when no prefix candidate has page-data', async () => {
    const s = pythonApi();
    const ctx = s.ctx();
    ctx.http.fail(/\/page-data\//, 404);
    await gatsbyAdapter.read(ctx, s.bound(), { url: new URL(url) });
    expect(ctx.http.unrecorded).toEqual([]);
    expect(ctx.http.count(/\/page-data\//)).toBe(3);
    expect(rendered(ctx, 'html').meta.res?.url).toBe(url);
    expect(
      await ctx.cache.getDerived('misc', `gatsby-prefix:${D}/pylib/latest/api-reference/`),
    ).toBe(undefined);
  });
});

describe('gatsby symbol', () => {
  it('selects a member by its anchor', async () => {
    const s = engine();
    const ctx = s.ctx();
    if (gatsbyAdapter.symbol === undefined) throw new Error('the adapter must render symbols');
    const ref = `${D}/engine/api-reference/core/geometry/envelopebuilder/#changeaspectratio`;
    const record = makeRecord({
      ref,
      kind: 'api',
      symbol: 'changeAspectRatio',
      qualified: 'Core.Geometry.EnvelopeBuilder.changeAspectRatio',
      parent: 'Core.Geometry.EnvelopeBuilder',
      symbolKind: 'method',
      locator: { anchor: 'changeaspectratio' },
    });
    const page = await gatsbyAdapter.symbol(ctx, s.bound(), record, 'signature');
    expect(rendered(ctx, 'html').opts).toEqual({
      select: { member: 'changeaspectratio' },
      detail: 'signature',
    });
    expect(page.ref).toBe(ref);
  });

  it('selects the section of an anchored record that is not a member', async () => {
    const s = pythonApi();
    const ctx = s.ctx();
    if (gatsbyAdapter.symbol === undefined) throw new Error('the adapter must render symbols');
    const record = makeRecord({
      ref: `${D}/pylib/latest/api-reference/pylib.geocoding.html#geocode`,
      kind: 'api',
      symbol: 'geocode',
      qualified: 'pylib.geocoding.geocode',
      symbolKind: 'function',
    });
    await gatsbyAdapter.symbol(ctx, s.bound(), record, 'full');
    const call = rendered(ctx, 'sphinx');
    expect(call.opts).toEqual({ select: { section: 'geocode' }, detail: 'full' });
    expect(call.input.anchor).toBe('geocode');
  });

  it('reads the whole page for a symbol documented by a page', async () => {
    const s = typedoc();
    const ctx = s.ctx();
    if (gatsbyAdapter.symbol === undefined) throw new Error('the adapter must render symbols');
    const record = makeRecord({
      ref: `${D}/toolkit-js/api-reference/toolkit-request/RequestManager/`,
      kind: 'api',
      symbol: 'RequestManager',
      symbolKind: 'type',
    });
    await gatsbyAdapter.symbol(ctx, s.bound(), record, 'summary');
    const call = rendered(ctx, 'typedoc');
    expect(call.opts).toEqual({ detail: 'summary' });
    expect(call.input.member).toBeUndefined();
  });
});
