import { describe, expect, it } from 'vitest';
import { briefAdapter } from '../../../../src/adapters/site/brief.js';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import { FAKE_NOW_ISO, makeLine, makeProduct, makeSource } from '../../../support/builders.js';
import { fakeRegistry, type Brief } from '../../../support/fake-registry.js';
import { makeCtx, type TestCtx } from '../../../support/make-ctx.js';
import { describeSiteAdapterContract, rendererOf } from '../contract.js';

const BRIEFS: Brief[] = [
  {
    slug: 'ai/overview',
    title: 'AI and agents: where to start',
    verifiedOn: '2026-10-01',
    sources: ['https://developers.arcgis.com/widgets/agents/'],
    markdown: [
      '# AI and agents: where to start',
      '',
      'An invented brief used by tests.',
      '',
      '## Assistants',
      '',
      'Use the assistant widget.',
      '',
      '## Tool servers',
      '',
      'Connect a tool server.',
    ].join('\n'),
  },
  {
    slug: 'ai/components',
    title: 'AI components',
    verifiedOn: '2026-09-15',
    sources: [],
    markdown: 'A brief without any heading.',
  },
  {
    slug: 'versions/lines',
    title: 'Version lines',
    verifiedOn: '2026-09-20',
    sources: [],
    markdown: '# Version lines\n\nWhich line to choose.',
  },
];

const briefs = makeSource(
  'brief',
  { slugs: ['ai/*'] },
  {
    id: 'briefs',
    title: 'Briefs',
    kinds: ['brief'],
    license: 'project',
    probe: { url: 'brief:ai/overview', expect: 'text' },
  },
);
// A brief source needs no capability: nothing is fetched.
delete briefs.capability;
const product = makeProduct({ id: 'ai-agents', name: 'AI and agents', sources: [briefs] });
const ctxOf = (list: Brief[] = BRIEFS): TestCtx =>
  makeCtx({ registry: fakeRegistry({ products: [product], briefs: list }) });
const bound = () => bindSource(product, briefs, makeLine());

describeSiteAdapterContract('brief (bundled)', () => ({
  adapter: briefAdapter,
  product,
  source: briefs,
  ctx: ctxOf,
  allowedHosts: [],
  minRecords: 2,
  readRef: 'brief:ai/overview',
  failures: {
    renamedField: { notApplicable: 'briefs are embedded at build time' },
    missingFile: { notApplicable: 'nothing is fetched' },
    emptyIndex: { notApplicable: 'nothing is fetched' },
    htmlInsteadOfJson: { notApplicable: 'nothing is fetched' },
  },
}));

describe('brief: enumerate', () => {
  it('lists the briefs its globs select, with their headings for search', async () => {
    const ctx = ctxOf();
    expect(await briefAdapter.enumerate!(ctx, bound())).toEqual([
      {
        ref: 'brief:ai/overview',
        product: 'ai-agents',
        source: 'briefs',
        line: 'latest',
        kind: 'brief',
        title: 'AI and agents: where to start',
        headings: ['Assistants', 'Tool servers'],
        license: 'project',
      },
      {
        ref: 'brief:ai/components',
        product: 'ai-agents',
        source: 'briefs',
        line: 'latest',
        kind: 'brief',
        title: 'AI components',
        license: 'project',
      },
    ]);
    expect(ctx.http.count()).toBe(0);
  });

  it('lists nothing when no brief matches', async () => {
    expect(await briefAdapter.enumerate!(ctxOf([]), bound())).toEqual([]);
  });
});

describe('brief: read', () => {
  it('renders the Markdown as a project-licensed page without attribution', async () => {
    const ctx = ctxOf();
    const page = await briefAdapter.read(ctx, bound(), {
      url: new URL('brief:ai/overview#assistants'),
      select: { section: 'assistants' },
    });

    expect(page).toMatchObject({
      ref: 'brief:ai/overview#assistants',
      url: 'brief:ai/overview',
      title: 'AI and agents: where to start',
      product: 'ai-agents',
      source: 'briefs',
      kind: 'brief',
      license: 'project',
      attribution: '',
      retrievedAt: FAKE_NOW_ISO,
      cache: 'miss',
    });
    expect(page.notices).toEqual([
      'Curated brief written for this server; verified on 2026-10-01.',
    ]);
    expect(rendererOf(ctx).calls[0]).toMatchObject({
      kind: 'markdown',
      input: { markdown: BRIEFS[0]!.markdown },
      opts: { select: { section: 'assistants' } },
    });
    expect(ctx.http.count()).toBe(0);
  });

  it('titles a brief without a heading from its front matter', async () => {
    const ctx = ctxOf();
    rendererOf(ctx).when('markdown', (call) => ({
      ...ctx.render.render('html', { html: '' }, call.meta),
      title: '',
    }));
    const page = await briefAdapter.read(ctx, bound(), { url: new URL('brief:ai/components') });
    expect(page.title).toBe('AI components');
  });

  it('reads a bundled brief that this source does not list', async () => {
    const page = await briefAdapter.read(ctxOf(), bound(), {
      url: new URL('brief:versions/lines'),
    });
    expect(page.ref).toBe('brief:versions/lines');
  });

  it('answers an unknown slug with the nearest briefs and the call that opens the best one', async () => {
    await expect(
      briefAdapter.read(ctxOf(), bound(), { url: new URL('brief:ai/overveiw') }),
    ).rejects.toMatchObject({
      code: 'DOC_NOT_FOUND',
      message: 'There is no brief "ai/overveiw"',
      details: {
        candidates: ['ai/overview'],
        next: 'arcgis_docs_read({"ref":"brief:ai/overview"})',
      },
    });
  });

  it('suggests a search when no brief is close, and when the ref is not a brief at all', async () => {
    await expect(
      briefAdapter.read(ctxOf(), bound(), { url: new URL('brief:zz/unrelated-topic') }),
    ).rejects.toMatchObject({
      code: 'DOC_NOT_FOUND',
      details: { next: 'arcgis_docs_search({"query":"zz unrelated topic"})' },
    });
    await expect(
      briefAdapter.read(ctxOf(), bound(), {
        url: new URL('https://developers.arcgis.com/widgets/'),
      }),
    ).rejects.toMatchObject({ code: 'DOC_NOT_FOUND' });
    await expect(
      briefAdapter.read(ctxOf(), bound(), { url: new URL('brief:%%%') }),
    ).rejects.toMatchObject({ code: 'DOC_NOT_FOUND' });
  });

  it('rejects, rather than throws, when the renderer fails', async () => {
    const ctx = ctxOf();
    rendererOf(ctx).when('markdown', () => {
      throw new Error('renderer defect');
    });
    const reading = briefAdapter.read(ctx, bound(), { url: new URL('brief:ai/overview') });
    await expect(reading).rejects.toThrow('renderer defect');
  });
});

describe('brief: probe', () => {
  it('succeeds without a request when a brief matches', async () => {
    const ctx = ctxOf();
    expect(await briefAdapter.probe(ctx, bound())).toEqual({ ok: true, records: 2, ms: 0 });
    expect(ctx.http.count()).toBe(0);
  });

  it('fails when the registry holds no matching brief', async () => {
    expect(await briefAdapter.probe(ctxOf([BRIEFS[2]!]), bound())).toEqual({
      ok: false,
      records: 0,
      error: 'No bundled brief matches ai/*',
      ms: 0,
    });
  });
});
