import { describe, expect, it } from 'vitest';
import { joinSections } from '../../../src/core/budget.js';
import { McpDocError } from '../../../src/core/errors.js';
import type { DocPage } from '../../../src/core/types.js';
import {
  makeDocPage,
  makeHost,
  makeLine,
  makeProduct,
  makeSource,
} from '../../support/builders.js';
import { jsSdk } from '../support/catalogue.js';
import { makeHarness, type Harness, type HarnessOptions } from '../support/harness.js';

const DEV = 'https://developers.arcgis.com';
const JS = `${DEV}/javascript/latest`;
const GUIDE_URL = `${JS}/clustering/`;
const API_URL = `${JS}/references/core/layers/FeatureLayer/`;
const SAMPLE_URL = `${JS}/sample-code/editing-applyedits/`;

const GUIDE_MD = [
  '# Cluster points',
  '',
  'Clusters group nearby points.',
  '',
  '## Enable clustering',
  '',
  'Set the feature reduction of the layer.',
  '',
  '```js',
  'layer.featureReduction = { type: "cluster" };',
  '```',
  '',
  '## Cluster popups',
  '',
  'Describe the cluster in a popup.',
].join('\n');

const guidePage = (overrides: Partial<DocPage> = {}): DocPage =>
  makeDocPage({ url: GUIDE_URL, markdown: GUIDE_MD, product: 'js-maps-sdk', ...overrides });

const apiPage = (): DocPage =>
  makeDocPage({
    url: API_URL,
    kind: 'api',
    product: 'js-maps-sdk',
    source: 'core',
    header: 'import FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";',
    markdown: [
      '# FeatureLayer',
      '',
      'A layer of features.',
      '',
      '## Methods',
      '',
      '### queryFeatures',
      '',
      'Runs a query.',
      '',
      '### applyEdits',
      '',
      'Sends edits.',
    ].join('\n'),
    members: [
      { id: 'queryfeatures', name: 'queryFeatures', kind: 'method' },
      { id: 'applyedits', name: 'applyEdits', kind: 'method' },
    ],
  });

const samplePage = (): DocPage =>
  makeDocPage({
    url: SAMPLE_URL,
    kind: 'sample',
    product: 'js-maps-sdk',
    source: 'samples',
    markdown: '# Apply edits sample\n\nAdds and deletes features.',
    relevantApis: ['FeatureLayer.applyEdits'],
    files: [
      {
        name: 'index.html',
        language: 'html',
        text: '<script>layer.applyEdits(edits)</script>',
        ref: `${SAMPLE_URL}live/`,
        bytes: 40,
      },
      {
        name: 'style.css',
        language: 'css',
        text: 'body { margin: 0 }',
        ref: `${SAMPLE_URL}style.css`,
        bytes: 18,
      },
    ],
  });

/** Six sections of about 250 tokens each: several pages at the smallest tool budget. */
const LONG_MD = [
  '# Long guide',
  '',
  'Opening words.',
  ...Array.from({ length: 6 }, (_, i) => `\n## Part ${i}\n\n${`part${i} words `.repeat(70)}`),
].join('\n');

const longPage = (markdown = LONG_MD): DocPage =>
  makeDocPage({ url: GUIDE_URL, markdown, product: 'js-maps-sdk' });

function harness(options: HarnessOptions = {}): Harness {
  const h = makeHarness(options);
  h.adapter('gatsby').addPage(guidePage());
  h.adapter('astro').addPage(apiPage());
  h.adapter('docc').addPage(samplePage());
  return h;
}

const read = (
  h: Harness,
  request: {
    ref: string;
    section?: string;
    view?: 'auto' | 'outline' | 'full';
    maxTokens?: number;
    cursor?: string;
  },
) => h.services.docs.read({ view: 'auto', maxTokens: 6000, ...request }, h.call());

const unavailable = new McpDocError(
  'UPSTREAM_UNAVAILABLE',
  'developers.arcgis.com is not responding',
  {
    why: 'timeout',
    url: GUIDE_URL,
    host: 'developers.arcgis.com',
    retryable: true,
  },
);

describe('read: views', () => {
  it('returns a page that fits whole, with its outline', async () => {
    const h = harness();
    const response = await read(h, { ref: GUIDE_URL });
    expect(response.text).toBe(joinSections(guidePage().sections));
    expect(response).toMatchObject({
      truncated: false,
      page: { title: 'Cluster points', product: 'js-maps-sdk', source: 'guide', line: 'latest' },
    });
    expect(response.next).toBeUndefined();
    expect(response.nextCursor).toBeUndefined();
    expect(response.outline.map((entry) => entry.id)).toEqual([
      'cluster-points',
      'enable-clustering',
      'cluster-popups',
    ]);
    expect(h.adapter('gatsby').calls).toEqual([
      expect.objectContaining({
        method: 'read',
        product: 'js-maps-sdk',
        source: 'guide',
        ref: GUIDE_URL,
      }),
    ]);
  });

  it('adds what it read to the body index', async () => {
    const h = harness();
    await read(h, { ref: GUIDE_URL });
    const hits = h.index.queryBodies({
      text: 'feature reduction',
      products: ['js-maps-sdk'],
      limit: 3,
    });
    expect(hits[0]?.ref).toBe(`${GUIDE_URL}#enable-clustering`);
    expect(h.ctx.cache.derivedKeys()).toContainEqual(['bodies', 'js-maps-sdk']);
  });

  it('returns only the outline for view "outline"', async () => {
    const h = harness();
    const response = await read(h, { ref: GUIDE_URL, view: 'outline' });
    expect(response.text).toContain('- `cluster-points` Cluster points');
    expect(response.text).not.toContain('Clusters group nearby points');
    expect(response.truncated).toBe(false);
    expect(response.next).toBe(
      `arcgis_docs_read({"ref":"${GUIDE_URL}","section":"enable-clustering"})`,
    );
  });

  it('answers a large page with its opening, the outline and the next section to read', async () => {
    const h = harness();
    const big = guidePage({
      sections: makeDocPage({
        markdown: `${GUIDE_MD}\n\n## Reference tables\n\n${'cell '.repeat(3000)}`,
      }).sections,
    });
    h.adapter('gatsby').addPage(big);
    const response = await read(h, { ref: GUIDE_URL, maxTokens: 500 });
    expect(response.truncated).toBe(true);
    expect(response.text).toContain('Clusters group nearby points.');
    expect(response.text).toContain('- `reference-tables` Reference tables');
    expect(response.next).toBe(
      `arcgis_docs_read({"ref":"${GUIDE_URL}","section":"reference-tables"})`,
    );
    expect(response.nextCursor).toBeUndefined();
  });

  it('pages through a document with view "full" and a cursor', async () => {
    const h = harness();
    h.adapter('gatsby').addPage(longPage());
    const pages: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 20; guard++) {
      const response = await read(h, {
        ref: GUIDE_URL,
        view: 'full',
        maxTokens: 500,
        ...(cursor === undefined ? {} : { cursor }),
      });
      pages.push(response.text);
      cursor = response.nextCursor;
      if (cursor === undefined) {
        expect(response.truncated).toBe(false);
        break;
      }
      expect(response.truncated).toBe(true);
      expect(response.next).toBe(
        `arcgis_docs_read(${JSON.stringify({ ref: GUIDE_URL, view: 'full', max_tokens: 500, cursor })})`,
      );
    }
    expect(pages.length).toBeGreaterThan(2);
    expect(pages.join('\n\n')).toBe(joinSections(longPage().sections));
  });

  it('pages inside one oversized section and reassembles it exactly', async () => {
    const h = harness();
    const long = makeDocPage({
      url: GUIDE_URL,
      product: 'js-maps-sdk',
      markdown: `# Long\n\n${Array.from({ length: 40 }, (_, i) => `Paragraph ${i}: ${'lorem '.repeat(60)}`).join('\n\n')}`,
    });
    h.adapter('gatsby').addPage(long);
    const pages: string[] = [];
    let cursor: string | undefined;
    do {
      const response = await read(h, {
        ref: GUIDE_URL,
        maxTokens: 600,
        ...(cursor === undefined ? {} : { cursor }),
      });
      pages.push(response.text);
      cursor = response.nextCursor;
    } while (cursor !== undefined);
    expect(pages.length).toBeGreaterThan(3);
    expect(pages.join('\n\n')).toBe(joinSections(long.sections));
  });

  it('rejects a foreign, altered or outdated cursor with the call that restarts', async () => {
    const h = harness();
    h.adapter('gatsby').addPage(longPage());
    const first = await read(h, { ref: GUIDE_URL, view: 'full', maxTokens: 500 });
    const cursor = first.nextCursor ?? '';
    expect(cursor).not.toBe('');
    const restart = {
      code: 'CURSOR_EXPIRED',
      details: { next: `arcgis_docs_read({"ref":"${API_URL}","view":"full"})` },
    };
    await expect(read(h, { ref: API_URL, view: 'full', cursor })).rejects.toMatchObject(restart);
    await expect(
      read(h, { ref: API_URL, view: 'full', cursor: 'not-a-cursor!' }),
    ).rejects.toMatchObject(restart);
    await expect(
      read(h, { ref: GUIDE_URL, section: 'part-2', view: 'full', cursor }),
    ).rejects.toMatchObject({
      code: 'CURSOR_EXPIRED',
    });

    h.adapter('gatsby').addPage(longPage(`${LONG_MD}\n\nEdited since.`));
    await expect(read(h, { ref: GUIDE_URL, view: 'full', cursor })).rejects.toMatchObject({
      code: 'CURSOR_EXPIRED',
      details: { why: 'The underlying content changed since the cursor was issued' },
    });
  });
});

describe('read: sections', () => {
  it('reads one section and its children, asking the adapter to slice', async () => {
    const h = harness();
    const response = await read(h, { ref: API_URL, section: 'methods' });
    expect(response.text).toContain('## Methods');
    expect(response.text).toContain('### applyEdits');
    expect(response.text).not.toContain('A layer of features.');
    // The metadata block is always shown first.
    expect(response.text.startsWith('import FeatureLayer from')).toBe(true);
    expect(h.adapter('astro').calls[0]?.target?.select).toEqual({
      section: 'methods',
      member: 'methods',
    });
  });

  it('accepts heading text, a member name and a fuzzy spelling', async () => {
    const h = harness();
    expect((await read(h, { ref: GUIDE_URL, section: 'Cluster Popups' })).text).toBe(
      '## Cluster popups\n\nDescribe the cluster in a popup.',
    );
    expect((await read(h, { ref: API_URL, section: 'queryFeatures()' })).text).toContain(
      '### queryFeatures\n\nRuns a query.',
    );
    expect((await read(h, { ref: GUIDE_URL, section: 'cluster-popup' })).text).toContain(
      '## Cluster popups',
    );
  });

  it('works the same when the adapter returns only the selected slice', async () => {
    const h = harness({ adapters: { astro: { slices: true } } });
    h.adapter('astro').addPage(apiPage());
    const response = await read(h, { ref: API_URL, section: 'applyEdits' });
    expect(response.text).toBe(
      'import FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";\n\n### applyEdits\n\nSends edits.',
    );
    expect(response.page.members).toHaveLength(2);
  });

  it('treats the #fragment of the ref as the section', async () => {
    const h = harness();
    const response = await read(h, { ref: `${API_URL}#queryFeatures` });
    expect(response.text).toContain('### queryFeatures');
    expect(response.text).not.toContain('### applyEdits');
    // An explicit section wins over the fragment.
    expect(
      (await read(h, { ref: `${API_URL}#queryFeatures`, section: 'applyEdits' })).text,
    ).toContain('### applyEdits');
  });

  it('reads the whole page when a fragment names nothing', async () => {
    const h = harness();
    const response = await read(h, { ref: `${GUIDE_URL}#some-ui-tab` });
    expect(response.text).toBe(joinSections(guidePage().sections));
  });

  it('raises SECTION_NOT_FOUND with the outline ids for an explicit section that matches nothing', async () => {
    const h = harness();
    await expect(
      read(h, { ref: `${GUIDE_URL}#x`, section: 'licensing terms' }),
    ).rejects.toMatchObject({
      code: 'SECTION_NOT_FOUND',
      details: {
        candidates: ['cluster-points', 'enable-clustering', 'cluster-popups'],
        next: `arcgis_docs_read({"ref":"${GUIDE_URL}","view":"outline"})`,
      },
    });
  });

  it('lists at most thirty candidates', async () => {
    const h = harness();
    const markdown = Array.from({ length: 45 }, (_, i) => `## Heading ${i}\n\nBody.`).join('\n\n');
    h.adapter('gatsby').addPage(guidePage({ sections: makeDocPage({ markdown }).sections }));
    const error = await read(h, { ref: GUIDE_URL, section: 'zzzzzzzz' }).catch(
      (caught: unknown) => caught,
    );
    expect((error as McpDocError).details?.candidates).toHaveLength(30);
  });

  it('shows a sample as description and main file, and only code for section "source"', async () => {
    const h = harness();
    const whole = await read(h, { ref: SAMPLE_URL });
    expect(whole.text).toContain('Adds and deletes features.');
    expect(whole.text).toContain('## Relevant APIs\n\n- FeatureLayer.applyEdits');
    expect(whole.text).toContain('```html\n<script>layer.applyEdits(edits)</script>\n```');
    expect(whole.text).not.toContain('margin: 0');
    expect(whole.outline.map((entry) => entry.id)).toContain('source-2');

    const code = await read(h, { ref: SAMPLE_URL, section: 'source' });
    expect(code.text).not.toContain('Adds and deletes features.');
    expect(code.text).toContain('margin: 0');
    // A pseudo-section is assembled by the service: the adapter is not asked to slice.
    expect(h.adapter('docc').calls.at(-1)?.target?.select).toBeUndefined();

    const full = await read(h, { ref: SAMPLE_URL, view: 'full' });
    expect(full.text).toContain('margin: 0');
  });

  it('continues a paged sample over the list the cursor was issued for', async () => {
    const h = harness();
    const big = samplePage();
    h.adapter('docc').addPage({
      ...big,
      sections: makeDocPage({ markdown: '# Apply edits sample\n\nShort.' }).sections,
      files: [
        {
          name: 'index.html',
          language: 'html',
          text: Array.from(
            { length: 200 },
            (_, i) => `<p>line ${i} ${'x'.repeat(40)}</p>\n\n`,
          ).join(''),
          ref: 'r',
          bytes: 1,
        },
      ],
    });
    const first = await read(h, { ref: SAMPLE_URL, maxTokens: 500 });
    expect(first.next).toContain('"section":"source"');
    const paged = await read(h, { ref: SAMPLE_URL, view: 'full', maxTokens: 500 });
    expect(paged.nextCursor).toBeDefined();
    const second = await read(h, {
      ref: SAMPLE_URL,
      view: 'full',
      maxTokens: 500,
      cursor: paged.nextCursor ?? '',
    });
    expect(second.text.length).toBeGreaterThan(0);
  });
});

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

  it('answers an unknown brief with the nearest slugs', async () => {
    const h = harness();
    await expect(read(h, { ref: 'brief:ai/overvew' })).rejects.toMatchObject({
      code: 'DOC_NOT_FOUND',
      details: { candidates: ['brief:ai/overview'] },
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
