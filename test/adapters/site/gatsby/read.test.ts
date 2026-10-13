import { describe, expect, it } from 'vitest';
import { gatsbyAdapter } from '../../../../src/adapters/site/gatsby/index.js';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import { isMcpDocError } from '../../../../src/core/errors.js';
import type { RendererInputs } from '../../../../src/core/ports.js';
import { makeLine, makeRecord } from '../../../support/builders.js';
import type { RenderCall } from '../../../support/fake-render.js';
import type { TestCtx } from '../../../support/make-ctx.js';
import { D, engine, guide, pythonApi, rest, typedoc, rejection } from './sites.js';

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
