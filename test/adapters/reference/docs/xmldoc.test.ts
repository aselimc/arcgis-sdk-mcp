import { describe, expect, it } from 'vitest';
import {
  sliceType,
  xmldocAdapter,
  xmldocRecords,
} from '../../../../src/adapters/reference/xmldoc.js';
import { bindSource } from '../../../../src/core/adapter-helpers.js';
import { newBudget } from '../../../../src/core/async.js';
import { McpDocError } from '../../../../src/core/errors.js';
import { makeLine, makeProduct, makeSource } from '../../../support/builders.js';
import type { FakeRepo } from '../../../support/fake-github.js';
import { readFixture } from '../../../support/fixtures.js';
import { makeCtx, type TestCtx } from '../../../support/make-ctx.js';
import { describeReferenceContract, rendererOf } from './contract.js';

const REPO = 'Esri/widgets-sdk';
const DIR = 'References/Widgets API';
const CORE_PATH = `${DIR}/Widgets.Core.XML`;
const DESKTOP_PATH = `${DIR}/Widgets.Desktop.xml`;
const CORE_URL = `https://github.com/${REPO}/blob/main/References/Widgets%20API/Widgets.Core.XML`;
const DESKTOP_URL = `https://github.com/${REPO}/blob/main/References/Widgets%20API/Widgets.Desktop.xml`;

const CORE = readFixture('cassettes', 'reference', 'docs', 'xmldoc-Widgets.Core.XML');
const DESKTOP = readFixture('cassettes', 'reference', 'docs', 'xmldoc-Widgets.Desktop.xml');

const repo = (files: Record<string, string>): FakeRepo => ({
  defaultBranch: 'main',
  files: { main: files, 'v1.2.0': files },
});
const FILES = {
  'README.md': '# Widgets SDK',
  [CORE_PATH]: CORE,
  [DESKTOP_PATH]: DESKTOP,
  [`${DIR}/notes.txt`]: 'Not documentation.',
  'Other/Elsewhere.xml': '<doc><members><member name="T:Other.Thing"/></members></doc>',
};

const source = makeSource(
  'xmldoc',
  { repo: REPO, dir: DIR, docUrlHost: 'doc.esri.com' },
  {
    id: 'api',
    title: 'API reference (IntelliSense XML)',
    kinds: ['api'],
    floor: false,
    capability: 'github',
    license: 'apache-2.0',
    probe: {
      url: `https://api.github.com/repos/${REPO}`,
      expect: 'json',
      mustContain: 'full_name',
    },
  },
);
const product = makeProduct({ sources: [source] });
const ctxWith = (files: Record<string, string>): TestCtx => {
  const ctx = makeCtx();
  ctx.github.addRepo(REPO, repo(files));
  return ctx;
};
const ctxOf = (): TestCtx => ctxWith(FILES);
const bound = () => bindSource(product, source, makeLine());

describeReferenceContract('xmldoc', () => ({
  adapter: xmldocAdapter,
  product,
  source,
  ctx: ctxOf,
  allowedHosts: ['github.com'],
  minRecords: 14,
  readRef: `${CORE_URL}#T:Widgets.Core.Widget`,
  failures: {
    renamedField: {
      arrange: (ctx) =>
        ctx.github.addRepo(
          REPO,
          repo({
            [CORE_PATH]: '<doc><members><member id="T:Widgets.Core.Widget"/></members></doc>',
          }),
        ),
      outcome: 'typed-failure',
      codes: ['UPSTREAM_UNAVAILABLE'],
    },
    missingFile: {
      arrange: (ctx) => ctx.github.addRepo(REPO, repo({ 'README.md': '# Widgets SDK' })),
      outcome: 'typed-failure',
      codes: ['UPSTREAM_UNAVAILABLE'],
    },
    emptyIndex: {
      arrange: (ctx) => ctx.github.addRepo(REPO, repo({ [CORE_PATH]: '<doc><members/></doc>' })),
      outcome: 'typed-failure',
      codes: ['UPSTREAM_UNAVAILABLE'],
    },
    htmlInsteadOfJson: {
      notApplicable: 'files come through the GitHub client, not from a website',
    },
    oversizedBody: { notApplicable: 'the GitHub client applies its own size cap to raw files' },
    secondary5xx: {
      arrange: (ctx) => {
        const raw = ctx.github.raw.bind(ctx.github);
        ctx.github.raw = async (name, ref, path, opts) => {
          if (path === DESKTOP_PATH) {
            throw new McpDocError(
              'UPSTREAM_UNAVAILABLE',
              'raw.githubusercontent.com is not responding',
              {
                why: 'HTTP 503',
                host: 'raw.githubusercontent.com',
                retryable: true,
              },
            );
          }
          return raw(name, ref, path, opts);
        };
      },
      outcome: 'degraded',
      minRecords: 12,
    },
  },
}));

describe('xmldoc: enumerate', () => {
  it('lists the types and members of every documentation file under the directory', async () => {
    const ctx = ctxOf();
    const records = await xmldocAdapter.enumerate!(ctx, bound());

    expect(
      records.map((record) => [record.title, record.symbolKind, record.parent ?? null]),
    ).toEqual([
      ['Widget', 'type', null],
      ['Widget.Widget(Int32)', 'constructor', 'Widgets.Core.Widget'],
      ['Widget.ResizeAsync(Int32,IEnumerable{Part})', 'method', 'Widgets.Core.Widget'],
      ['Widget.Size', 'property', 'Widgets.Core.Widget'],
      ['Widget.Resized', 'event', 'Widgets.Core.Widget'],
      ['Widget.Shape', 'type', 'Widgets.Core.Widget'],
      ['Shape.Round', 'field', 'Widgets.Core.Widget.Shape'],
      ['Part', 'type', null],
      ['Part.op_Addition(Part,Part)', 'operator', 'Widgets.Core.Part'],
      ['WidgetList', 'type', null],
      ['WidgetList.Add(`0)', 'method', 'Widgets.Core.WidgetList'],
      ['WidgetList.Dispose', 'method', 'Widgets.Core.WidgetList'],
      ['WidgetPane', 'type', null],
      ['WidgetPane.Show(Widget)', 'method', 'Widgets.Desktop.WidgetPane'],
    ]);
    expect(
      ctx.github.calls.map((call) => [call.method, call.ref ?? null, call.path ?? null]),
    ).toEqual([
      ['repoMeta', null, null],
      ['tree', 'main', null],
      ['raw', 'main', CORE_PATH],
      ['raw', 'main', DESKTOP_PATH],
    ]);
    expect(ctx.http.count()).toBe(0);
  });

  it('addresses a member by the blob URL of its file and its documentation id', async () => {
    const records = await xmldocAdapter.enumerate!(ctxOf(), bound());
    const byTitle = new Map(records.map((record) => [record.title, record]));

    expect(byTitle.get('Widget')).toMatchObject({
      ref: `${CORE_URL}#T:Widgets.Core.Widget`,
      symbol: 'Widget',
      qualified: 'Widgets.Core.Widget',
      breadcrumb: 'Widgets.Core',
      description: 'A widget holds parts. See Part for what a part is.',
      locator: { memberId: 'T:Widgets.Core.Widget' },
      license: 'apache-2.0',
    });
    expect(byTitle.get('Widget.Widget(Int32)')).toMatchObject({
      ref: `${CORE_URL}#M:Widgets.Core.Widget.#ctor(System.Int32)`,
      symbol: 'Widget',
      qualified: 'Widgets.Core.Widget.Widget',
    });
    expect(byTitle.get('Widget.ResizeAsync(Int32,IEnumerable{Part})')).toMatchObject({
      symbol: 'ResizeAsync',
      description: 'Resizes the widget & repaints its parts.',
    });
    expect(byTitle.get('WidgetList.Add(`0)')).toMatchObject({
      ref: `${CORE_URL}#M:Widgets.Core.WidgetList%601.Add(%600)`,
      qualified: 'Widgets.Core.WidgetList.Add',
      locator: { memberId: 'M:Widgets.Core.WidgetList`1.Add(`0)' },
    });
    expect(byTitle.get('Widget.Resized')?.description).toBeUndefined();
    expect(byTitle.get('WidgetPane')?.ref).toBe(`${DESKTOP_URL}#T:Widgets.Desktop.WidgetPane`);
  });

  it('drops excluded members, static constructors and ids that name nothing', () => {
    const records = xmldocRecords(bound(), CORE_URL, CORE);
    const ids = records.map((record) => record.locator?.memberId);

    expect(ids).not.toContain('M:Widgets.Core.Widget.InternalReset');
    expect(ids).not.toContain('M:Widgets.Core.Widget.#cctor');
    // Not API: an underscore name, the namespace of generated XAML helpers.
    expect(ids).not.toContain('F:Widgets.Core.Widget._cache');
    expect(ids.some((id) => id?.includes('XamlGeneratedNamespace'))).toBe(false);
    expect(ids.some((id) => id?.startsWith('!:'))).toBe(false);
    expect(records).toHaveLength(12);
  });

  it('uses a configured ref without asking for the default branch and caches a tag for good', async () => {
    const pinned = makeSource(
      'xmldoc',
      { repo: REPO, dir: `/${DIR}/`, ref: 'v1.2.0' },
      {
        id: 'api',
        capability: 'github',
        probe: source.probe,
      },
    );
    const ctx = ctxOf();
    const seen: unknown[] = [];
    const raw = ctx.github.raw.bind(ctx.github);
    ctx.github.raw = async (name, ref, path, opts) => {
      seen.push(opts?.ttl);
      return raw(name, ref, path, opts);
    };
    const records = await xmldocAdapter.enumerate!(ctx, bindSource(product, pinned, makeLine()));

    expect(ctx.github.count('repoMeta')).toBe(0);
    expect(seen).toEqual(['immutable', 'immutable']);
    expect(records[0]?.ref).toBe(
      `https://github.com/${REPO}/blob/v1.2.0/References/Widgets%20API/Widgets.Core.XML#T:Widgets.Core.Widget`,
    );
  });

  it('counts every GitHub call against the request budget', async () => {
    const ctx = ctxOf();
    const budget = newBudget(3, 60_000, ctx.clock);
    const src = bindSource(product, source, makeLine(), undefined, budget);
    await expect(xmldocAdapter.enumerate!(ctx, src)).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
    });
    expect(budget.used).toBe(3);
  });

  it('reports an exhausted GitHub quota as such', async () => {
    const ctx = ctxOf();
    ctx.github.exhaustQuota('2026-10-13T12:00:00Z');
    await expect(xmldocAdapter.enumerate!(ctx, bound())).rejects.toMatchObject({
      code: 'RATE_LIMITED_GITHUB',
    });
  });

  it('reads at most twenty files of a directory and says so', async () => {
    const many = Object.fromEntries(
      Array.from({ length: 23 }, (_, index) => [
        `${DIR}/File${String(index).padStart(2, '0')}.xml`,
        `<doc><members><member name="T:Ns.Type${index}"/></members></doc>`,
      ]),
    );
    const ctx = ctxWith(many);
    const records = await xmldocAdapter.enumerate!(ctx, bound());

    expect(records).toHaveLength(20);
    expect(ctx.github.count()).toBeLessThanOrEqual(xmldocAdapter.maxEnumerateRequests);
    expect(ctx.logger.messages('warn')).toHaveLength(1);
  });
});

describe('xmldoc: owns', () => {
  it('claims documentation files under its directory and nothing else of the repository', () => {
    const owns = (url: string) => xmldocAdapter.owns!(new URL(url), bound());

    expect(owns(`${CORE_URL}#T:Widgets.Core.Widget`)).toBe(true);
    expect(
      owns(
        `https://raw.githubusercontent.com/${REPO}/main/References/Widgets%20API/Widgets.Desktop.xml`,
      ),
    ).toBe(true);
    expect(
      owns(
        `https://github.com/esri/WIDGETS-SDK/blob/main/References/Widgets%20API/Widgets.Core.XML`,
      ),
    ).toBe(true);
    expect(owns(`https://github.com/${REPO}/blob/main/README.md`)).toBe(false);
    expect(owns(`https://github.com/${REPO}/blob/main/Other/Elsewhere.xml`)).toBe(false);
    expect(owns(`https://github.com/${REPO}/wiki/Home`)).toBe(false);
    expect(
      owns(`https://github.com/Esri/other/blob/main/References/Widgets%20API/Widgets.Core.XML`),
    ).toBe(false);
  });
});

describe('xmldoc: read', () => {
  it('hands the renderer the wanted type cut out of the file', async () => {
    const ctx = ctxOf();
    const page = await xmldocAdapter.read(ctx, bound(), {
      url: new URL(`${CORE_URL}#P:Widgets.Core.Widget.Size`),
      detail: 'summary',
    });
    const [call] = rendererOf(ctx).calls;
    const input = call?.input as { xml: string; memberId: string };

    expect(call).toMatchObject({
      kind: 'xmldoc',
      meta: {
        url: `${CORE_URL}#P:Widgets.Core.Widget.Size`,
        kind: 'api',
        license: 'apache-2.0',
        res: { url: `https://raw.githubusercontent.com/${REPO}/main/${CORE_PATH}` },
      },
      opts: { detail: 'summary' },
    });
    expect(input.memberId).toBe('P:Widgets.Core.Widget.Size');
    expect(input.xml).toContain('<assembly><name>Widgets.Core</name></assembly>');
    expect(input.xml).toContain('name="T:Widgets.Core.Widget"');
    expect(input.xml).toContain('name="F:Widgets.Core.Widget.Shape.Round"');
    expect(input.xml).not.toContain('Widgets.Core.Part.op_Addition');
    expect(input.xml).not.toContain('WidgetList');
    expect(input.xml).not.toContain('InternalReset');
    expect(input.xml).not.toContain('_cache');
    expect(page.notices).toEqual([
      'Declared types are not part of XML documentation; the rendered reference is on doc.esri.com.',
    ]);
    expect(ctx.github.calls).toEqual([{ method: 'raw', repo: REPO, ref: 'main', path: CORE_PATH }]);
  });

  it('reads a raw URL and takes a documentation id from the selector', async () => {
    const ctx = ctxOf();
    const page = await xmldocAdapter.read(ctx, bound(), {
      url: new URL(
        `https://raw.githubusercontent.com/${REPO}/main/References/Widgets%20API/Widgets.Core.XML`,
      ),
      select: { member: 'T:Widgets.Core.Part' },
    });

    expect(rendererOf(ctx).calls[0]?.meta.url).toBe(`${CORE_URL}#T:Widgets.Core.Part`);
    expect(page.ref).toBe(`${CORE_URL}#T:Widgets.Core.Part`);
  });

  it('reads a symbol record, generic ids included', async () => {
    const ctx = ctxOf();
    const records = await xmldocAdapter.enumerate!(ctx, bound());
    const add = records.find((record) => record.symbol === 'Add')!;
    await xmldocAdapter.symbol!(ctx, bound(), add, 'full');
    const input = rendererOf(ctx).calls[0]?.input as { xml: string; memberId: string };

    expect(input.memberId).toBe('M:Widgets.Core.WidgetList`1.Add(`0)');
    expect(input.xml).toContain('name="T:Widgets.Core.WidgetList`1"');
    expect(input.xml).toContain('System#IDisposable#Dispose');
    expect(rendererOf(ctx).calls[0]?.opts).toEqual({ detail: 'full' });
  });

  it('omits the note about declared types when the source names no reference host', async () => {
    const plain = makeSource(
      'xmldoc',
      { repo: REPO, dir: DIR },
      {
        id: 'api',
        capability: 'github',
        probe: source.probe,
      },
    );
    const page = await xmldocAdapter.read(ctxOf(), bindSource(product, plain, makeLine()), {
      url: new URL(`${CORE_URL}#T:Widgets.Core.Widget`),
    });
    expect(page.notices).toEqual([]);
  });

  it.each([
    CORE_URL,
    `${CORE_URL}#overview`,
    `https://github.com/${REPO}/blob/main/README.md#T:Widgets.Core.Widget`,
    `${CORE_URL}#%E0%A4%A`,
  ])('answers %s with DOC_NOT_FOUND without fetching', async (url) => {
    const ctx = ctxOf();
    await expect(xmldocAdapter.read(ctx, bound(), { url: new URL(url) })).rejects.toMatchObject({
      code: 'DOC_NOT_FOUND',
      details: {
        next: 'arcgis_docs_search({"query":"API reference (IntelliSense XML)","product":"widgets-sdk"})',
      },
    });
    expect(ctx.github.count()).toBe(0);
  });

  it('reports a file that does not exist at the ref', async () => {
    const ctx = ctxOf();
    await expect(
      xmldocAdapter.read(ctx, bound(), {
        url: new URL(
          `https://github.com/${REPO}/blob/main/References/Widgets%20API/Gone.xml#T:Gone.Type`,
        ),
      }),
    ).rejects.toMatchObject({ code: 'DOC_NOT_FOUND' });
  });

  it('cuts a type and its nested types out of a file', () => {
    const sliced = sliceType(CORE, 'T:Widgets.Core.Part');

    expect(sliced.match(/<member /g)).toHaveLength(2);
    expect(sliced).toContain('<summary>Joins two parts.</summary>');
    expect(sliceType('<doc/>', 'T:Missing.Type')).toContain('<assembly><name></name></assembly>');
  });
});

describe('xmldoc: probe', () => {
  it('counts the documentation files of the directory', async () => {
    const ctx = ctxOf();
    const result = await xmldocAdapter.probe(ctx, bound());

    expect(result).toMatchObject({ ok: true, records: 2 });
    expect(ctx.github.count()).toBe(2);
  });

  it('fails when the directory holds fewer files than the registry expects', async () => {
    const strict = { ...source, probe: { ...source.probe, minRecords: 5 } };
    const result = await xmldocAdapter.probe(ctxOf(), bindSource(product, strict, makeLine()));

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Expected at least 5 documentation files, found 2');
  });

  it('fails when the repository has no documentation directory', async () => {
    const result = await xmldocAdapter.probe(ctxWith({ 'README.md': '# Widgets SDK' }), bound());
    expect(result).toMatchObject({ ok: false, records: 0 });
  });
});
