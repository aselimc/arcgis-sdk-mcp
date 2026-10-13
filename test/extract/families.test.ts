import { describe, expect, it } from 'vitest';
import type { RenderOptions } from '../../src/core/ports.js';
import { HTML_FAMILIES, type DocPage, type HtmlFamily } from '../../src/core/types.js';
import { PROFILES } from '../../src/extract/families/registry.js';
import type { Pass } from '../../src/extract/types.js';
import { applyPass, metaFor, pageMarkdown, passEnv, sharedExtractor } from './support.js';

/** The `prepare` rules of a family, applied to a fragment. */
function prepared(family: HtmlFamily, html: string): string {
  const prepare: Pass | undefined = PROFILES[family].prepare;
  if (prepare === undefined) throw new Error(`${family} has no prepare step`);
  return applyPass(html, prepare, passEnv({ defaultLanguage: PROFILES[family].defaultLanguage }));
}

/** Converts a body with a family hint, at a fictional URL. */
function convertAs(family: HtmlFamily, body: string, opts?: RenderOptions, head = ''): DocPage {
  const html = `<html><head>${head}</head><body>${body}</body></html>`;
  return sharedExtractor().extract(
    { html, familyHint: family },
    metaFor('https://docs.example.com/api/page.html', 'api'),
    opts,
  );
}

const body = (page: DocPage): string =>
  pageMarkdown(page)
    .replace(/^# .*\n\n/, '')
    .trimEnd();

describe('family registry', () => {
  it('has one profile per family, registered under its own id', () => {
    expect(Object.keys(PROFILES).sort()).toEqual([...HTML_FAMILIES].sort());
    for (const family of HTML_FAMILIES) expect(PROFILES[family].id).toBe(family);
  });
});

describe('gatsby rules', () => {
  it('turns illustration cards into one list and leaves other grouped links alone', () => {
    const page = convertAs(
      'gatsby',
      '<main id="main"><header class="page-header"><h1 class="page-title">T</h1></header><div id="skip-to-content" class="page-content">' +
        '<a class="group" href="/a/"><h3>Alpha</h3><div><p>First card.</p></div></a><a class="group"><h3>Beta</h3></a>' +
        '<p><a class="group" href="/home/"><span>Home</span></a></p><ul><li>plain</li></ul><ul><li>other</li></ul></div></main>',
    );
    expect(body(page)).toBe(
      '- [Alpha](https://docs.example.com/a/): First card.\n- Beta\n\n[Home](https://docs.example.com/home/)\n\n- plain\n\n- other',
    );
  });
});

describe('dokka rules', () => {
  it('renders a member row without link or brief, and has no header without pageIds', () => {
    const page = convertAs(
      'dokka',
      '<div id="content" class="main-content"><div class="cover"><h1 class="cover"><span>Tide</span><wbr><span>Gauge</span></h1></div>' +
        '<h2 class="tableheader">Functions</h2><div class="table"><div class="table-row"><div class="main-subrow"><span>read</span></div>' +
        '<div class="symbol monospace">fun read(): Double</div></div></div></div>',
    );
    expect(page.title).toBe('TideGauge');
    expect(page.header).toBeUndefined();
    expect(body(page)).toBe('## Functions\n\n```kotlin\nfun read(): Double\n```');
  });

  // Regression: a member page was headed `pkg.Type.member.#.PointingToDeclaration..123`,
  // because only type pages end their name at the first `///`.
  it.each([
    ['m::com.example.tide/TideGauge///PointingToDeclaration//-15', 'com.example.tide.TideGauge'],
    [
      'm::com.example.tide/TideGauge/level/#/PointingToDeclaration//99',
      'com.example.tide.TideGauge.level',
    ],
    [
      'm::com.example.tide/TideGauge/read/#kotlin.Int#kotlin.String/PointingToDeclaration//7',
      'com.example.tide.TideGauge.read',
    ],
    [
      'm::com.example.tide//nearestGauge/#kotlin.Double/PointingToDeclaration//7',
      'com.example.tide.nearestGauge',
    ],
    ['m::com.example.tide////PointingToDeclaration//7', 'com.example.tide'],
  ])('reads the qualified name out of pageIds %s', (pageIds, expected) => {
    const page = convertAs(
      'dokka',
      `<div id="content" class="main-content" pageIds="${pageIds}"><div class="cover"><h1 class="cover">level</h1></div><p>The water level.</p></div>`,
    );
    expect(page.header).toBe(`\`${expected}\``);
  });

  it('gives overloaded names in different sections distinct, stable ids', () => {
    const row = (name: string): string =>
      `<div class="table-row"><div class="main-subrow"><a href="${name}.html"><span>${name}</span></a></div><div class="symbol monospace">val ${name}: Int</div></div>`;
    const html =
      '<div id="content" class="main-content" pageIds="m::pkg/Type///X"><div class="cover"><h1 class="cover">Type</h1></div>' +
      `<h2 class="tableheader">Properties</h2><div class="table">${row('size')}</div><h2 class="tableheader">Inherited properties</h2><div class="table">${row('size')}</div></div>`;
    const full = convertAs('dokka', html);
    expect(full.sections.map((section) => section.id)).toEqual([
      'type',
      'properties',
      'size',
      'inherited-properties',
      'size-1',
    ]);
    const sliced = convertAs('dokka', html, { select: { section: 'inherited-properties' } });
    expect(sliced.sections.map((section) => section.id)).toEqual([
      'inherited-properties',
      'size-1',
    ]);
    expect(convertAs('dokka', html, { select: { section: 'size-1' } }).sections).toHaveLength(1);
  });
});

describe('dartdoc rules', () => {
  it('fences a multi-line signature and lists a member without link or description', () => {
    const html =
      '<h1>load method</h1><section class="multi-line-signature">\n  <span class="returntype">Future&lt;void&gt;</span>\n  <span class="name">load</span>(\n    <span class="parameter">bool   force</span>\n  )\n</section>' +
      '<section class="summary"><h2>Methods</h2><dl class="callables"><dt id="x" class="callable"><span class="name">x</span>()</dt><dd></dd></dl></section>';
    expect(prepared('dartdoc', html)).toBe(
      '<pre data-md-lang="dart">Future&lt;void&gt; load(bool force)</pre><section class="summary"><h2>Methods</h2><ul><li><code>x()</code></li></ul></section>',
    );
  });

  // Regression: the signature block has one token per line in the page source, and was
  // fenced that way: a getter read `LoadStatus`, `get`, `loadStatus` on three lines.
  const signature = (inner: string): string =>
    prepared('dartdoc', `<section class="multi-line-signature">\n${inner}\n</section>`)
      .replace(/^<pre data-md-lang="dart">|<\/pre>$/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  const parameter = (type: string, name: string, after: string): string =>
    `<li><span class="parameter"><span class="type-annotation">${type}</span> <span class="parameter-name">${name}</span>${after}</span></li>`;

  it('writes a getter on one line', () => {
    expect(
      signature(
        '  <span class="returntype"><a href="../TideState.html">TideState</a></span>\n  get\n  <span class="name ">tideState</span>\n',
      ),
    ).toBe('TideState get tideState');
  });

  it('writes a method with its parameters on one line, annotations above it', () => {
    expect(
      signature(
        '<div><ol class="annotation-list"><li>@<a href="x.html">awaitNotRequired</a></li></ol></div>\n' +
          '<span class="returntype">Future<span class="signature">&lt;<wbr><span class="type-parameter">bool</span>&gt;</span></span>\n' +
          `<span class="name ">moveTo</span>(<wbr><ol class="parameter-list"> ${parameter('Berth', 'berth', ', {')}\n${parameter('double?', 'speed', ', ')}\n</ol>})`,
      ),
    ).toBe('@awaitNotRequired\nFuture<bool> moveTo(Berth berth, {double? speed})');
  });

  it('writes one parameter per line when the declaration is long', () => {
    const names = ['harbourMasterApproval', 'tideWindowInMinutes', 'pilotBoatCallSign'];
    const list = names
      .map((name, index) => parameter('NavigationClearance?', name, index === 0 ? ', {' : ', '))
      .join('\n');
    expect(
      signature(
        `<span class="returntype">void</span>\n<span class="name ">requestDeparture</span>(<wbr><ol class="parameter-list"> ${list}\n</ol>})`,
      ),
    ).toBe(
      [
        'void requestDeparture(',
        '  NavigationClearance? harbourMasterApproval, {',
        '  NavigationClearance? tideWindowInMinutes,',
        '  NavigationClearance? pilotBoatCallSign,',
        '})',
      ].join('\n'),
    );
  });
});

describe('docfx rules', () => {
  it('keeps the heading of a note for the aside pass and turns other h5 into labels', () => {
    const html =
      '<h5>Remarks</h5><h6>Assembly: Harbor.dll</h6><div class="TIP"><h5>Tip</h5><p>x</p></div><div class="derived"><h5>Derived</h5><div><a href="A.html">A</a></div><div><span class="xref">B</span></div></div>';
    expect(prepared('docfx-net', html)).toBe(
      '<p><strong>Remarks</strong></p><p><strong>Assembly:</strong> <code>Harbor.dll</code></p><div class="TIP"><h5>Tip</h5><p>x</p></div>' +
        '<p><strong>Derived:</strong> <a href="A.html">A</a>, <span class="xref">B</span></p>',
    );
  });

  it('writes the label of a tool parameter and leaves tab sets without a Python tab alone', () => {
    const html =
      '<table data-param-table="dialog"><tbody><tr data-param="in_channel"><td><p><span data-label="">Input Channel</span></p></td><td data-desc=""><p>The polygon.</p></td><td></td></tr></tbody></table>' +
      '<ul role="tablist"><li role="tab" aria-controls="a">A</li></ul><section id="a" role="tabpanel" data-tab="a">kept</section>';
    expect(prepared('docfx-esri', html)).toBe(
      '<div><p><strong><code>in_channel</code></strong> (Input Channel), required</p><p>The polygon.</p></div>' +
        '<ul role="tablist"><li role="tab" aria-controls="a">A</li></ul><section id="a" role="tabpanel" data-tab="a">kept</section>',
    );
  });

  it('has no header on a doc.esri.com page without a tool signature', () => {
    const page = convertAs(
      'docfx-esri',
      '<article id="main" data-uid="9"><h1>Cursor</h1><h2 id="summary">Summary</h2><p>Reads rows.</p></article>',
    );
    expect(page.header).toBeUndefined();
    expect(page.title).toBe('Cursor');
    expect(body(page)).toBe('## Summary\n\nReads rows.');
  });
});

describe('documentx rules', () => {
  it('keeps a link that wraps a named anchor and removes an emptied "top" paragraph only', () => {
    const html =
      '<p>Intro <a href="#top">Top</a></p><p><a href="#top">Top</a></p><a name="x"></a><a name="y">kept</a><h4 class="i-sub-heading">Reference</h4>';
    expect(prepared('documentx', html)).toBe(
      '<p>Intro </p><a name="y">kept</a><p><strong>Reference</strong></p>',
    );
  });

  it('keeps a member table that has no icon column', () => {
    const html =
      '<table class="i-filtered-item-list"><tbody><tr><th>Name</th><th>Description</th></tr></tbody></table>';
    expect(prepared('documentx', html)).toBe(html);
  });
});

describe('javadoc rules', () => {
  it('regroups summary grids of two and four columns, with or without header cells', () => {
    const two =
      '<div class="summary-table two-column-summary"><div class="table-header col-first">Class</div><div class="table-header col-last">Description</div><div class="col-first">A</div><div class="col-last">First.</div></div>';
    expect(prepared('javadoc', two)).toBe(
      '<table><thead><tr><th>Class</th><th>Description</th></tr></thead><tbody><tr><td>A</td><td>First.</td></tr></tbody></table>',
    );
    const four = `<div class="details-table four-column-summary">${'<div>c</div>'.repeat(8)}</div>`;
    expect(prepared('javadoc', four)).toContain(
      `<tbody>${'<tr><td>c</td><td>c</td><td>c</td><td>c</td></tr>'.repeat(2)}</tbody>`,
    );
    const three = `<div class="summary-table">${'<div>c</div>'.repeat(3)}</div>`;
    expect(prepared('javadoc', three)).toContain(
      '<tbody><tr><td>c</td><td>c</td><td>c</td></tr></tbody>',
    );
  });

  it('flattens a one-level inheritance block and labels unknown member groups', () => {
    expect(prepared('javadoc', '<div class="inheritance">java.lang.Object</div>')).toBe(
      '<p><strong>Inheritance:</strong> <code>java.lang.Object</code></p>',
    );
    const page = convertAs(
      'javadoc',
      '<main role="main"><div class="header"><h1 class="title">Record Point</h1></div><section class="detail" id="x()"><h3>x</h3><div class="member-signature">int x()</div></section></main>',
    );
    expect(page.members).toEqual([{ id: 'x()', name: 'x', kind: 'member', signature: 'int x()' }]);
  });
});

describe('javadoc-legacy rules', () => {
  it('reads field members, skips group anchors and anchors without a member body', () => {
    const page = convertAs(
      'javadoc-legacy',
      '<div class="header"><h2 class="title">Class Pier</h2></div><div class="contentContainer"><div class="details"><ul class="blockList"><li class="blockList">' +
        '<a name="field_detail"></a><h3>Field Detail</h3><a name="LENGTH"></a><ul class="blockListLast"><li class="blockList"><h4>LENGTH</h4><pre>static final int LENGTH</pre></li></ul>' +
        '<a name="stray"></a><p>No member here.</p></li></ul></div></div>',
    );
    expect(page.header).toBeUndefined();
    expect(page.members).toEqual([
      { id: 'LENGTH', name: 'LENGTH', kind: 'field', signature: 'static final int LENGTH' },
    ]);
    expect(page.sections.map((section) => section.id)).toEqual([
      'class-pier',
      'field_detail',
      'LENGTH',
    ]);
    expect(
      convertAs('javadoc-legacy', '<div class="contentContainer"><p>x</p></div>', {
        select: { member: 'none' },
      }).members,
    ).toEqual([]);
  });
});

describe('legacy-help rules', () => {
  it('finds the content without the content-section wrapper and the title without a page header', () => {
    const page = convertAs(
      'legacy-help',
      '<h1>Loose title</h1><main><section class="section1" id="S1"><h2>Part</h2><p>Press <kbd>Ctrl</kbd> in the <span class="wintitle">Options</span> window.</p>' +
        '<figure><figcaption>No picture</figcaption></figure><figure><img src="a.png"><figcaption>Shown</figcaption></figure><figure><img src="b.png"></figure></section></main>',
    );
    expect(page.title).toBe('Loose title');
    expect(page.header).toBeUndefined();
    expect(body(page)).toBe(
      '## Part\n\nPress `Ctrl` in the **Options** window.\n\n![Shown](https://docs.example.com/api/a.png)\n\n![figure](https://docs.example.com/api/b.png)',
    );
  });
});

describe('qdoc rules', () => {
  it('lists a summary row without a link and names a member after its id when it has no name span', () => {
    const page = convertAs(
      'qdoc',
      '<main id="main"><header class="page-header"><h1 class="page-title">Pier Class</h1></header><div class="qdoc-html">' +
        '<h2 id="public-functions">Public Functions</h2><table class="alignedsummary"><tr><td class="memItemLeft">void</td><td class="memItemRight">close()</td></tr></table>' +
        '<h3 class="fn" id="close">void Pier::close()</h3><div class="table"><p>Closes the pier.</p></div></div></main>',
    );
    expect(page.members).toEqual([
      { id: 'close', name: 'close', kind: 'function', signature: 'void Pier::close()' },
    ]);
    expect(body(page)).toBe(
      '## Public Functions\n\n- `void close()`\n\n### close\n\n```cpp\nvoid Pier::close()\n```\n\nCloses the pier.',
    );
    expect(
      convertAs('qdoc', '<main id="main"><div class="qdoc-html"><p>x</p></div></main>', {
        select: { member: 'nothing' },
      }).members,
    ).toEqual([]);
  });
});

describe('theme root', () => {
  it('accepts a content root without the skip-to-content id', () => {
    const page = convertAs(
      'astro',
      '<main id="main"><header class="page-header"><h1 class="page-title">Older shell</h1></header><div class="page-content"><p>Body text.</p></div></main>',
    );
    expect(pageMarkdown(page)).toBe('# Older shell\n\nBody text.\n');
  });
});
