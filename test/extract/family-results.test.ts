import { describe, expect, it } from 'vitest';
import {
  caseOf,
  extractFixture,
  extractHtml,
  fixtureHtml,
  metaFor,
  pageMarkdown,
  sharedExtractor,
} from './support.js';

describe('family results', () => {
  it('keeps only the expanded lines of tutorial code when focused', () => {
    const full = pageMarkdown(extractFixture('astro'));
    const focused = pageMarkdown(extractFixture('astro', { focusedCode: true }));
    expect(full).toContain('const chart = new Chart("view");');
    expect(focused).not.toContain('const chart = new Chart("view");');
    expect(focused).toContain(
      '// \u2026 2 collapsed lines \u2026\n   const stations = new TideLayer({ source: "gauges" });',
    );
  });

  it('returns sample source as files, not in the sections', () => {
    const page = extractFixture('astro-sample');
    expect(page.files).toHaveLength(1);
    const [file] = page.files ?? [];
    expect(file).toMatchObject({
      name: 'index.html',
      language: 'html',
      ref: caseOf('astro-sample').url,
    });
    expect(file?.text.split('\n')).toHaveLength(9);
    expect(file?.text).toContain('new Chart("view", { center: [4.9, 52.4] });');
    expect(file?.bytes).toBe(Buffer.byteLength(file?.text ?? ''));
    expect(pageMarkdown(page)).not.toContain('center: [4.9, 52.4]');
  });

  it('names sample files by caption, and numbers the ones without', () => {
    const block = (language: string, caption: string, code: string): string =>
      `<div class="expressive-code"><figure><figcaption>${caption}</figcaption><pre data-language="${language}"><code></code></pre><button data-code="${code}"></button></figure></div>`;
    const html = `<html><head><link href="/_astro/a.css"></head><body><main id="main"><header class="page-header"><h2 class="page-title">Sample</h2></header><div id="skip-to-content" class="page-content"><p>${'A sample with three files. '.repeat(10)}</p></div><div class="sample-code-source" hidden>${block('html', '', '&lt;p&gt;')}${block('javascript', '<span class="title">app.js</span>', 'run();')}${block('', '', 'notes')}<div class="expressive-code"><pre><code></code></pre></div></div></main></body></html>`;
    const page = extractHtml(html);
    expect(page.diagnostics.family).toBe('astro-sample');
    expect(page.files?.map((file) => [file.name, file.language, file.text])).toEqual([
      ['index.html', 'html', '<p>'],
      ['app.js', 'js', 'run();'],
      ['file-3.txt', '', 'notes'],
      ['file-4.html', 'html', ''],
    ]);
  });

  it('lists every member of a JavaScript reference page', () => {
    const members = extractFixture('astro-js-ref').members ?? [];
    expect(members.map((member) => member.id)).toEqual([
      'Constructor',
      'id',
      'labelField',
      'queryGauges',
      'event-refresh',
      'RefreshEvent',
      'RefreshEvent-count',
    ]);
    expect(members[1]).toEqual({
      id: 'id',
      name: 'id',
      kind: 'property',
      signature: 'string',
      summary: 'The unique id given to the layer when it is created.',
      inheritedFrom: 'Layer',
      readonly: true,
    });
    expect(members[3]).toMatchObject({
      kind: 'method',
      signature: 'queryGauges (filter?: GaugeFilter): Promise<Gauge[]>',
    });
    expect(members[4]).toEqual({
      id: 'event-refresh',
      name: 'refresh',
      kind: 'event',
      summary: 'Fires after new readings have been drawn.',
    });
  });

  it('documents each member in the section that carries its id', () => {
    for (const family of ['astro-js-ref', 'javadoc', 'javadoc-legacy', 'qdoc'] as const) {
      const page = extractFixture(family);
      const ids = new Set(page.sections.map((section) => section.id));
      for (const member of page.members ?? [])
        expect(ids.has(member.id), `${family} ${member.id}`).toBe(true);
      expect(page.members?.length, family).toBeGreaterThan(0);
    }
  });

  it('returns the overview of a reference page for a detail below full', () => {
    const overview = extractFixture('astro-js-ref', { detail: 'summary' });
    const markdown = pageMarkdown(overview);
    expect(overview.sections.map((section) => section.id)).toEqual([
      'tidelayer',
      'overview',
      'constructors',
      'properties',
      'methods',
      'events',
      'type-definitions',
    ]);
    expect(markdown).toContain('| `labelField` | `string \\| null` |');
    expect(markdown).not.toContain('### labelField');
    expect(overview.members).toHaveLength(7);
    expect(pageMarkdown(extractFixture('astro-js-ref', { detail: 'signature' }))).toBe(markdown);
    expect(pageMarkdown(extractFixture('astro-js-ref', { detail: 'full' }))).toContain(
      '### labelField',
    );
  });

  it('ignores the overview detail for families without member bodies to drop', () => {
    expect(pageMarkdown(extractFixture('javadoc', { detail: 'summary' }))).toBe(
      pageMarkdown(extractFixture('javadoc')),
    );
  });

  it('reads javadoc members with kind, signature and deprecation', () => {
    expect(extractFixture('javadoc').members).toEqual([
      {
        id: '<init>(com.example.harbor.mapping.Basemap)',
        name: 'HarborChart',
        kind: 'constructor',
        signature: 'public HarborChart(Basemap basemap)',
        summary: 'Creates a chart on top of a basemap.',
      },
      {
        id: 'getMaxScale()',
        name: 'getMaxScale',
        kind: 'method',
        signature: 'public double getMaxScale()',
        summary: 'Gets the largest scale the chart can be shown at.',
      },
      {
        id: 'setMaxScale(double)',
        name: 'setMaxScale',
        kind: 'method',
        signature: 'public void setMaxScale(double maxScale)',
        summary: 'Sets the largest scale the chart can be shown at.',
        deprecated: true,
      },
    ]);
  });

  it('reads javadoc 1.8 and QDoc members', () => {
    expect(extractFixture('javadoc-legacy').members).toEqual([
      {
        id: 'getBerthName-int-',
        name: 'getBerthName',
        kind: 'method',
        signature: 'java.lang.String getBerthName(int index) throws java.io.IOException',
        summary: 'Name of the berth at an index.',
      },
      {
        id: 'getBerthCount--',
        name: 'getBerthCount',
        kind: 'method',
        signature: 'int getBerthCount()',
        summary: 'Deprecated. Counts every call.',
        deprecated: true,
      },
    ]);
    expect(extractFixture('qdoc').members).toEqual([
      {
        id: 'Chart',
        name: 'Chart',
        kind: 'function',
        signature: '[explicit] Chart::Chart(QObject *parent = nullptr)',
        summary: 'Creates an empty chart.',
      },
      {
        id: 'maxScale',
        name: 'maxScale',
        kind: 'function',
        signature: 'double Chart::maxScale() const',
        summary: 'Returns the largest scale the chart can be shown at.',
      },
    ]);
  });

  it('shows the metadata block of a page as its header', () => {
    expect(extractFixture('gatsby-rest').header).toBe(
      '- **URL:** `https://<root>/<portName>/BerthServer/find`\n- **Methods:** `GET`, `POST`\n- **Version Introduced:** 3.1',
    );
    expect(extractFixture('docfx-esri').header).toBe(
      '```python\nharbor.channel.Dredge(in_channel, target_depth, {method})\n```',
    );
    expect(extractFixture('dokka').header).toBe('`com.example.harbor.mapping.HarborChart`');
    expect(extractFixture('javadoc-legacy').header).toBe('`com.example.harbor.server`');
    expect(extractFixture('astro-js-ref').header).toContain(
      '**CDN**\n\n```js\nconst TideLayer = await $harbor.import(',
    );
    expect(extractFixture('support-kb').header).toContain('- **Article ID:** 000990001');
    expect(extractFixture('astro').header).toBeUndefined();
    expect(extractFixture('generic').header).toBeUndefined();
  });

  it('omits a header that has nothing to show', () => {
    const bare = fixtureHtml('legacy-help').replace(
      /<meta name="(?:product|version|last-modified)"[^>]*>/g,
      '',
    );
    expect(
      sharedExtractor().extract({ html: bare }, metaFor(caseOf('legacy-help').url)).header,
    ).toBeUndefined();
    const noGrid = fixtureHtml('gatsby-rest').replace(
      'class="grid grid-cols-4 gap-2"',
      'class="plain"',
    );
    expect(extractHtml(noGrid, {}, caseOf('gatsby-rest').url).diagnostics.family).toBe('gatsby');
    const hinted = sharedExtractor().extract(
      { html: noGrid, familyHint: 'gatsby-rest' },
      metaFor(caseOf('gatsby-rest').url),
    );
    expect(hinted.header).toBeUndefined();
    expect(hinted.diagnostics.family).toBe('gatsby-rest');
  });

  it('guesses Python in knowledge-base code and leaves other code untagged', () => {
    const html = fixtureHtml('support-kb').replace(
      'print(open(r"C:\\temp\\n4.txt").read())',
      'type C:\\temp\\n4.txt',
    );
    const page = sharedExtractor().extract({ html }, metaFor(caseOf('support-kb').url));
    expect(page.diagnostics).toMatchObject({ fences: 2, fencesWithLanguage: 1 });
    expect(pageMarkdown(page)).toContain('```\ntype C:\\temp\\n4.txt\n```');
  });

  it('drops a section heading that is left without content', () => {
    const html = fixtureHtml('astro-js-ref').replace(
      /<h2 id="type-definitions"[\s\S]*?(?=<\/div>\s*<div class="sidebar-container">)/,
      '<h2 id="type-definitions">Type definitions</h2>',
    );
    const page = sharedExtractor().extract({ html }, metaFor(caseOf('astro-js-ref').url));
    expect(page.sections.map((section) => section.id)).not.toContain('type-definitions');
    expect(page.sections.at(-1)?.id).toBe('event-refresh');
  });
});
