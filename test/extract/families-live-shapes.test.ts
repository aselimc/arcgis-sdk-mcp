/**
 * Markup shapes that live pages showed and the family fixtures did not hold. Every case is a
 * synthetic reduction of the page structure, never page content.
 */
import { describe, expect, it } from 'vitest';
import type { RenderOptions } from '../../src/core/ports.js';
import type { DocPage, HtmlFamily } from '../../src/core/types.js';
import { refineLanguage } from '../../src/extract/dom.js';
import { fixCodeLinks } from '../../src/extract/passes/fix-code-links.js';
import { COLLAPSED_MARK } from '../../src/extract/passes/fix-gatsby-code.js';
import { applyPass, metaFor, pageMarkdown, sharedExtractor } from './support.js';

const URL = 'https://docs.example.com/api/page.html';

function convert(html: string, family?: HtmlFamily, opts?: RenderOptions): DocPage {
  return sharedExtractor().extract(
    { html, ...(family === undefined ? {} : { familyHint: family }) },
    metaFor(URL, 'api'),
    opts,
  );
}

const body = (page: DocPage): string =>
  pageMarkdown(page)
    .replace(/^# .*\n\n/, '')
    .trimEnd();

/** A page of the developers.arcgis.com theme (Gatsby or Astro shell). */
const themed = (content: string, generator = 'Gatsby 5'): string =>
  `<html><head><meta name="generator" content="${generator}"></head><body><main id="main">` +
  '<header class="page-header"><h1 class="page-title">T</h1></header>' +
  `<div id="skip-to-content" class="page-content">${content}</div></main></body></html>`;

describe('docfx-net inheritance', () => {
  const page = (entries: string): string =>
    `<html><body><article id="_content" data-uid="E.Layer"><h1>Class Layer</h1><div class="inheritance"><h5>Inheritance</h5>${entries}</div></article></body></html>`;

  // Regression: the derived types that DocFX lists one level below the type were joined to
  // the chain, so twenty sibling subclasses of Layer read as a twenty-deep hierarchy.
  it('ends the chain at the type and lists the derived types apart', () => {
    const md = body(
      convert(
        page(
          '<div class="level0"><a class="xref" href="https://e.com/object">object</a></div>' +
            '<div class="level1"><span class="xref">Layer</span></div>' +
            '<div class="level2"><a class="xref" href="E.AnnotationLayer.html">AnnotationLayer</a></div>' +
            '<div class="level2"><a class="xref" href="E.FeatureLayer.html">FeatureLayer</a></div>',
        ),
      ),
    );
    expect(md).toBe(
      '**Inheritance:** [object](https://e.com/object) → Layer\n\n' +
        '**Derived:** [AnnotationLayer](https://docs.example.com/api/E.AnnotationLayer.html), [FeatureLayer](https://docs.example.com/api/E.FeatureLayer.html)',
    );
  });

  it('writes a chain without derived types on one line', () => {
    const md = body(
      convert(
        page(
          '<div class="level0"><a class="xref" href="https://e.com/object">object</a></div>' +
            '<div class="level1"><a class="xref" href="E.Layer.html">Layer</a></div>' +
            '<div class="level2"><span class="xref">FeatureLayer</span></div>',
        ),
      ),
    );
    expect(md).toBe(
      '**Inheritance:** [object](https://e.com/object) → [Layer](https://docs.example.com/api/E.Layer.html) → FeatureLayer',
    );
  });

  it('falls back to the levels when the type itself is linked too', () => {
    const md = body(
      convert(
        page(
          '<div class="level0"><a href="o.html">object</a></div><div class="level1"><a href="l.html">Layer</a></div>' +
            '<div class="level2"><a href="a.html">A</a></div><div class="level2"><a href="b.html">B</a></div>',
        ),
      ),
    );
    expect(md).toContain('→ [Layer](https://docs.example.com/api/l.html)\n\n**Derived:** [A]');
  });
});

describe('dokka signatures', () => {
  // Regression: `@Composablefun MapView(` - the annotation is a block of its own in the page.
  it('keeps an annotation on its own line', () => {
    const html =
      '<html><body><div class="main-content" id="content" pageIds="m::p/T///PointingToDeclaration//1"><h1 class="cover">T</h1>' +
      '<div class="symbol monospace"><div class="block"><div class="block"><span class="token annotation">@</span><a href="c.html"><span>Composable</span></a></div></div>' +
      '<span class="token keyword">inline </span><span class="token keyword">fun </span><span>remember</span>(): <a href="d.html">Display</a></div></div></body></html>';
    expect(body(convert(html))).toContain(
      '```kotlin\n@Composable\ninline fun remember(): Display\n```',
    );
  });
});

describe('legacy help steps', () => {
  const page = (content: string): string =>
    `<html><body><header class="trailer-1"><h1>T</h1></header><div class="content-section"><main>${content}</main></div></body></html>`;

  // Regression: `_distance_—_float_How many units to extrude.`
  it('keeps the bare text of a step result apart from the step command', () => {
    const md = body(
      convert(
        page(
          '<ol><li purpose="step"><span purpose="cmd"><i>distance</i>—<i>float</i></span><div class="stepresult">How many units.</div></li>' +
            '<li purpose="step"><span purpose="cmd">Next</span><div class="stepinfo"><p>Info.</p></div></li></ol>',
        ),
      ),
    );
    expect(md).toBe('1. _distance_—_float_\n\n   How many units.\n2. Next\n\n   Info.');
  });

  it('attaches a note between two steps to the step before it', () => {
    const md = body(
      convert(
        page(
          '<ol><li purpose="step"><span>Open the file.</span></li><div class="stepinfo"><p>CSV only.</p></div><li purpose="step"><span>Choose.</span></li></ol>',
        ),
      ),
    );
    expect(md).toBe('1. Open the file.\n\n   CSV only.\n2. Choose.');
  });
});

describe('native SDK sample pages', () => {
  const file = (label: string, code: string, hidden = ''): string =>
    `<div data-codeblock='{"label":"${label}","language":"kt"}'${hidden}><div class="expressive-code"><figure><figcaption></figcaption>` +
    `<pre data-language="kt"><code></code></pre><button data-code="${code}"></button></figure></div></div>`;
  const sample = themed(
    '<div class="button-group"><calcite-label><span>View in</span><calcite-segmented-control>' +
      '<calcite-segmented-control-item data-url="/net/maui/s/" checked="true">MAUI</calcite-segmented-control-item>' +
      '<calcite-segmented-control-item data-url="/net/wpf/s/">WPF</calcite-segmented-control-item></calcite-segmented-control></calcite-label>' +
      '<calcite-button href="https://github.com/example/samples/tree/main/s/">View on GitHub</calcite-button>' +
      '<calcite-button href="https://store.example.com/app">Get the app</calcite-button></div>' +
      '<p>Shows a thing.</p><h2 id="use-case">Use case</h2><p>Why.</p><h2 id="sample-code">Sample code</h2>' +
      '<starship-code-switcher-dropdown><div data-header class="code-switcher"><calcite-dropdown data-file="true">' +
      '<calcite-button slot="trigger"><span>Main.kt</span></calcite-button><calcite-dropdown-item data-label="Main.kt"><span>Main.kt</span></calcite-dropdown-item>' +
      '<calcite-dropdown-item data-label="Screen.kt"><span>Screen.kt</span></calcite-dropdown-item></calcite-dropdown></div>' +
      `${file('Main.kt', '\ufefffun main() {}')}${file('Screen.kt', 'fun screen() {}', ' hidden')}</starship-code-switcher-dropdown>`,
    'Astro v5',
  ).replace('</head>', '<link href="/_astro/x.css"></head>');

  // Regression: `section: "source"` did not exist on these pages and the file names were lost.
  it('returns the source as named files, like a JavaScript sample', () => {
    const page = convert(sample, 'astro');
    expect(page.diagnostics.family).toBe('astro-sample');
    expect(page.files?.map(({ name, language, text }) => ({ name, language, text }))).toEqual([
      { name: 'Main.kt', language: 'kotlin', text: 'fun main() {}' },
      { name: 'Screen.kt', language: 'kotlin', text: 'fun screen() {}' },
    ]);
    expect(page.sections.map((section) => section.id)).toEqual(['t', 'use-case']);
    expect(pageMarkdown(page)).not.toContain('fun main');
  });

  it('turns the platform switcher into links instead of a run of words', () => {
    const md = body(convert(sample, 'astro'));
    expect(md).toContain(
      'Also available for: [WPF](https://docs.example.com/net/wpf/s/) · [View on GitHub](https://github.com/example/samples/tree/main/s/)',
    );
    expect(md).not.toContain('View in');
    expect(md).not.toContain('Get the app');
  });

  it('does not take a file switcher in a tutorial step for the source of a sample', () => {
    const tutorial = sample.replace(
      '<h2 id="sample-code">Sample code</h2>',
      '<h2 id="step">Step</h2><p>Add the files.</p>',
    );
    const page = convert(tutorial, 'astro');
    expect(page.diagnostics.family).toBe('astro');
    expect(page.files).toBeUndefined();
    expect(body(page)).toContain('_Main.kt_\n\n```kotlin\nfun main() {}\n```\n\n_Screen.kt_');
  });
});

describe('generated API pages of the Gatsby theme', () => {
  // Regression: `**Inheritance:** Survey123WebFormSurvey123JsApiCommon`.
  it('separates the classes of an inheritance row', () => {
    const md = body(
      convert(
        themed(
          '<section><h2>Class</h2><p>A class.</p><div><b>Inheritance: </b><span>WebForm<svg></svg></span><span><span>ApiCommon</span></span></div></section>',
        ),
      ),
    );
    expect(md).toContain('**Inheritance:** `WebForm` → `ApiCommon`');
  });

  it('writes the kind icon of a member row as its alternative text', () => {
    const md = body(
      convert(
        themed(
          '<table><thead><tr><th></th><th>Name</th></tr></thead><tbody><tr><td><img src="../bitmaps/Method.gif" alt="Method" title="Method"></td><td>GetSchema</td></tr></tbody></table>',
        ),
      ),
    );
    expect(md).toContain('| Method | GetSchema |');
    expect(md).not.toContain('.gif');
  });

  // Regression: a block the page shows collapsed holds only its first lines; the request
  // example ended in the middle of an object with nothing to say so.
  it('marks a collapsed code block and says so in a notice', () => {
    const page = convert(
      themed(
        '<div class="code-block"><pre data-language="json"><code>{\n  "stops": [</code></pre>' +
          '<div><calcite-button data-component-link="Expand/Collapse Code Block">Expand</calcite-button></div></div>' +
          '<div class="code-block"><pre data-language="json"><code>{ "a": 1 }</code></pre></div>',
      ),
    );
    expect(body(page)).toBe(
      `\`\`\`json\n{\n  "stops": [\n${COLLAPSED_MARK}\n\`\`\`\n\n\`\`\`json\n{ "a": 1 }\n\`\`\``,
    );
    expect(page.notices).toHaveLength(1);
    expect(page.notices[0]).toContain('1 code block is collapsed on the source page');
    expect(page.notices[0]).toContain(URL);
  });

  it('has no notice when nothing is collapsed', () => {
    expect(convert(themed('<p>Text.</p>')).notices).toEqual([]);
  });
});

describe('landing pages of the theme', () => {
  const landing =
    '<html><head><meta name="generator" content="Gatsby 5"></head><body><main id="main">' +
    '<header class="page-banner"><h1 class="page-banner-title">Developer documentation</h1></header>' +
    '<div class="top-site-header"><span>Jump to:</span><nav><a href="#guides">Guides</a></nav></div>' +
    '<section id="guides"><header><h2 id="guides">Guides</h2></header><div class="card-group">' +
    '<a class="card is-link" href="/mapping/"><div class="card-header"><h4>Mapping</h4></div><div class="card-body"><p>Build maps.</p></div></a>' +
    '<a class="card is-link" href="/data/"><div class="card-header"><h4>Data</h4></div><div class="card-body"><p>Host data.</p></div></a>' +
    '</div></section></main></body></html>';

  // Regression: the home page of a registered source had no content root for its family and
  // was reported as layout drift on every read, with its cards as broken multi-line links.
  it('is converted by the family profile, one link per card', () => {
    const page = convert(landing, 'gatsby');
    expect(page.degraded).toBeUndefined();
    expect(page.diagnostics.family).toBe('gatsby');
    expect(page.title).toBe('Developer documentation');
    expect(pageMarkdown(page)).toBe(
      '# Developer documentation\n\n## Guides\n\n' +
        '- [Mapping](https://docs.example.com/mapping/): Build maps.\n- [Data](https://docs.example.com/data/): Host data.\n',
    );
  });
});

describe('code spans and fence languages', () => {
  // Regression: `Promise<_any_>` - emphasis markers inside a code span.
  it('writes styled parts of a code span as plain code', () => {
    expect(applyPass('<code><span>Promise</span>&lt;<em>any</em>&gt;</code>', fixCodeLinks)).toBe(
      '<code>Promise&lt;any&gt;</code>',
    );
  });

  it('names Visual Basic that a page tags as C#', () => {
    expect(refineLanguage('csharp', 'Public Function GetSchema ( _\n) As String')).toBe('vb');
    expect(refineLanguage('csharp', 'Dim x As Integer')).toBe('vb');
    expect(refineLanguage('csharp', 'public string GetSchema (\n);')).toBe('csharp');
    expect(refineLanguage('csharp', 'public class Function { }')).toBe('csharp');
  });

  it('names JavaScript that a page tags as JSON', () => {
    expect(refineLanguage('json', 'webform.setQuestionValue({\n  a: 1\n});')).toBe('js');
    expect(refineLanguage('json', '// set it\nconst value = {};')).toBe('js');
    expect(refineLanguage('json', '{ "a": 1 }')).toBe('json');
    expect(refineLanguage('json', '// a comment\n[1, 2]')).toBe('json');
    expect(refineLanguage('json', 'true')).toBe('json');
    // Request parameters listed as `name=value` are not JavaScript.
    expect(refineLanguage('json', 'singleline=1033 SC, Amsterdam\nstart=1')).toBe('json');
    expect(refineLanguage('python', 'print(1)')).toBe('python');
  });
});
