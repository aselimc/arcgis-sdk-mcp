import { describe, expect, it } from 'vitest';
import { absolutize } from '../../src/extract/passes/absolutize.js';
import { fixAsides } from '../../src/extract/passes/fix-asides.js';
import { fixDl } from '../../src/extract/passes/fix-dl.js';
import { fixIslands } from '../../src/extract/passes/fix-islands.js';
import { fixTabs } from '../../src/extract/passes/fix-tabs.js';
import { iconLabelsToText } from '../../src/extract/passes/icon-labels.js';
import { COMMON_REMOVE, removeCommon } from '../../src/extract/passes/remove-common.js';
import { unwrapBlockyInline } from '../../src/extract/passes/unwrap-blocky-inline.js';
import { applyPass, passEnv } from './support.js';

const island = (component: string, inner: string): string =>
  `<astro-island component-url="/x/_astro/${component}.Ab12.js">${inner}</astro-island>`;

describe('fixIslands', () => {
  it('keeps the slot of a MoreInfo island as a block quote', () => {
    const html = island(
      'MoreInfoReact',
      '<button>More info</button><astro-slot><p>Details.</p></astro-slot>',
    );
    expect(applyPass(html, fixIslands)).toBe(
      '<blockquote><p><strong>More info:</strong></p><p>Details.</p></blockquote>',
    );
  });

  it('turns a CodePen link in prose into its text and drops it in a link strip', () => {
    const link = island('CodePenLinkReact', '<a href="https://pen.example/x">  starter\n pen </a>');
    expect(applyPass(`<p>Start from the ${link}.</p>`, fixIslands)).toBe(
      '<p>Start from the starter pen.</p>',
    );
    expect(applyPass(`<ul class="list-none"><li>${link}</li></ul>`, fixIslands)).toBe(
      '<ul class="list-none"><li></li></ul>',
    );
  });

  it('removes page chrome silently and reports components it does not know', () => {
    const env = passEnv();
    const html =
      island('DemoAppReact', 'demo') +
      island('TableOfContents', 'toc') +
      island('FeedbackWidget', 'feedback') +
      island('PricingTable', 'pricing') +
      '<astro-island>anonymous</astro-island><p>kept</p>';
    expect(applyPass(html, fixIslands, env)).toBe('<p>kept</p>');
    expect([...env.counters.unknownIslands].sort()).toEqual(['PricingTable', 'unknown']);
  });

  it('processes nested islands innermost first', () => {
    const html = island(
      'MoreInfoReact',
      `<astro-slot><p>See ${island('CodePenLinkReact', 'the pen')}.</p></astro-slot>`,
    );
    expect(applyPass(html, fixIslands)).toBe(
      '<blockquote><p><strong>More info:</strong></p><p>See the pen.</p></blockquote>',
    );
  });
});

describe('fixTabs', () => {
  it('labels every panel, shows the hidden ones and drops the tab strip', () => {
    const html =
      '<div role="tablist"><button role="tab" aria-controls="p0">GET</button><button role="tab" aria-controls="p1" data-label="POST">Send</button></div>' +
      '<div id="p0" role="tabpanel"><p>read</p></div><div id="p1" role="tabpanel" hidden="" aria-hidden="true"><p>write</p></div>';
    expect(applyPass(html, fixTabs)).toBe(
      '<div id="p0" role="tabpanel"><p><strong>GET</strong></p><p>read</p></div>' +
        '<div id="p1" role="tabpanel"><p><strong>POST</strong></p><p>write</p></div>',
    );
  });

  it('finds a panel through aria-labelledby when the tab names no panel', () => {
    const html =
      '<div role="tablist"><button role="tab" id="t0">ESM</button></div><div role="tabpanel" aria-labelledby="t0" hidden="">import x;</div>';
    expect(applyPass(html, fixTabs)).toBe(
      '<div role="tabpanel" aria-labelledby="t0"><p><strong>ESM</strong></p>import x;</div>',
    );
  });

  it('drops placeholder panels and survives tabs without a panel or a label', () => {
    const html =
      '<div role="tablist"><button role="tab" aria-controls="missing">Gone</button><button role="tab" aria-controls="p0"> </button></div>' +
      '<div id="p0" role="tabpanel">body</div><div id="set-no-results" role="tabpanel">No results</div><div id="set-error" role="tabpanel">Error</div>';
    expect(applyPass(html, fixTabs)).toBe('<div id="p0" role="tabpanel">body</div>');
  });
});

describe('iconLabelsToText', () => {
  it('writes the meaning of an icon-only cell as text', () => {
    const svg = (label: string): string =>
      `<svg aria-label="${label}"><path d="M0 0"></path></svg>`;
    const html = `<table><tr><th>${svg('Required')}</th><td>${svg('Supported')}</td><td>${svg('Not supported')}</td><td>${svg('Beta & preview')}</td></tr></table>`;
    expect(applyPass(html, iconLabelsToText)).toBe(
      '<table><tbody><tr><th>Required</th><td>yes</td><td>no</td><td>Beta &amp; preview</td></tr></tbody></table>',
    );
  });

  it('leaves icons outside table cells to the bulk removal', () => {
    const html = '<p><svg aria-label="Supported"></svg></p>';
    expect(applyPass(html, iconLabelsToText)).toBe(html);
  });
});

describe('removeCommon', () => {
  it('removes page chrome and non-content elements', () => {
    const html =
      '<script>x()</script><style>p{}</style><noscript>n</noscript><svg></svg><link rel="x"><template>t</template><iframe></iframe>' +
      '<calcite-icon></calcite-icon><calcite-button>b</calcite-button><calcite-tooltip>t</calcite-tooltip><calcite-chip>c</calcite-chip>' +
      '<astro-island>i</astro-island><starship-popover></starship-popover><nav>n</nav><form>f</form><button>b</button>' +
      '<div class="table-of-contents">toc</div><div class="sidebar-container">s</div><aside class="supplementary-content">a</aside>' +
      '<h2 id="a">Title<a class="anchor-link" href="#a"></a></h2><p>kept</p>';
    expect(applyPass(html, removeCommon)).toBe('<h2 id="a">Title</h2><p>kept</p>');
  });

  it('removes <wbr> without inserting a space', () => {
    expect(applyPass('<code>Feature<wbr>Layer</code>', removeCommon)).toBe(
      '<code>FeatureLayer</code>',
    );
    expect(COMMON_REMOVE).toContain('wbr');
  });
});

describe('fixAsides', () => {
  it('rewrites a theme note with its label', () => {
    const html =
      '<aside role="note" class="note"><header><calcite-icon></calcite-icon><span>Warning</span></header><div class="contents"><p>Careful.</p></div></aside>';
    expect(applyPass(html, fixAsides)).toBe(
      '<blockquote><p><strong>Warning:</strong></p><p>Careful.</p></blockquote>',
    );
  });

  it('labels a theme note "Note" when it has no label', () => {
    expect(applyPass('<aside class="note"><p>Plain.</p></aside>', fixAsides)).toBe(
      '<blockquote><p><strong>Note:</strong></p><p>Plain.</p></blockquote>',
    );
  });

  it.each([
    [
      'a doc.esri.com alert',
      '<div class="alert alert-license"><h5>License:</h5><p>Standard only.</p></div>',
      'License',
    ],
    ['a DocFX note', '<div class="WARNING"><h5>Warning</h5><p>Standard only.</p></div>', 'Warning'],
    [
      'a legacy help panel',
      '<div class="panel trailer-1"><h5 class="icon">Tip:</h5><p>Standard only.</p></div>',
      'Tip',
    ],
    ['a legacy help note', '<div class="note"><h5>Note: </h5><p>Standard only.</p></div>', 'Note'],
    [
      'a Sphinx admonition',
      '<div class="admonition warning"><p class="admonition-title">Caution</p><p>Standard only.</p></div>',
      'Caution',
    ],
  ])('rewrites %s', (_kind, html, label) => {
    expect(applyPass(html, fixAsides)).toBe(
      `<blockquote><p><strong>${label}:</strong></p><p>Standard only.</p></blockquote>`,
    );
  });

  it('names an untitled admonition after its class', () => {
    expect(applyPass('<div class="admonition tip"><p>Short.</p></div>', fixAsides)).toBe(
      '<blockquote><p><strong>Tip:</strong></p><p>Short.</p></blockquote>',
    );
    expect(applyPass('<div class="admonition"><p>Short.</p></div>', fixAsides)).toBe(
      '<blockquote><p><strong>Note:</strong></p><p>Short.</p></blockquote>',
    );
  });

  it('quotes a box that carries its own bold label without adding a second one', () => {
    expect(
      applyPass('<div class="admonition note"><p><b>Note:</b> Inline label.</p></div>', fixAsides),
    ).toBe('<blockquote><p><b>Note:</b> Inline label.</p></blockquote>');
    expect(
      applyPass(
        '<div class="note"><p><strong>Known limits</strong></p><p>Five.</p></div>',
        fixAsides,
      ),
    ).toBe('<blockquote><p><strong>Known limits</strong></p><p>Five.</p></blockquote>');
  });

  it('leaves layout boxes without a label alone', () => {
    const html =
      '<div class="panel"><p>Just a box.</p></div><div class="alert"><p>Banner.</p></div>';
    expect(applyPass(html, fixAsides)).toBe(html);
  });

  it('rewrites nested notes innermost first', () => {
    const html =
      '<aside class="note"><header><span>Note</span></header><div class="contents"><p>Outer.</p><div class="alert"><h5>Tip:</h5><p>Inner.</p></div></div></aside>';
    expect(applyPass(html, fixAsides)).toBe(
      '<blockquote><p><strong>Note:</strong></p><p>Outer.</p><blockquote><p><strong>Tip:</strong></p><p>Inner.</p></blockquote></blockquote>',
    );
  });
});

describe('fixDl', () => {
  it('turns terms and definitions into bullets and strips the trailing colon', () => {
    const html =
      '<dl><dt>Since:</dt><dd>2.1</dd><dt><span>Type:</span></dt><dd><code>string</code></dd></dl>';
    expect(applyPass(html, fixDl)).toBe(
      '<ul><li><strong>Since:</strong> 2.1</li><li><strong><span>Type</span>:</strong> <code>string</code></li></ul>',
    );
  });

  it('nests several definitions of one term and keeps a definition without a term', () => {
    const html = '<dl><dd>orphan</dd><dt>Throws</dt><dd>A</dd><dd>B</dd></dl>';
    expect(applyPass(html, fixDl)).toBe(
      '<ul><li>orphan</li><li><strong>Throws:</strong> <ul><li>A</li><li>B</li></ul></li></ul>',
    );
  });

  it('reads grouped entries (dl > div > dt + dd)', () => {
    const html =
      '<dl><div><dt>Kind</dt><dd>class</dd></div><div><p>stray</p></div><p>stray</p></dl>';
    expect(applyPass(html, fixDl)).toBe('<ul><li><strong>Kind:</strong> class</li></ul>');
  });

  it('formats the REST metadata grid: URL as one code span, chips separated by commas', () => {
    const html =
      '<dl class="grid"><dt>URL:</dt><dd><span>https://<a href="/c/">&lt;root&gt;</a><span>/find</span></span></dd><dt>Methods:</dt><dd><code>GET</code><code>POST</code></dd></dl>';
    expect(applyPass(html, fixDl)).toBe(
      '<ul><li><strong>URL:</strong> <code>https://&lt;root&gt;/find</code></li><li><strong>Methods:</strong> <code>GET</code>, <code>POST</code></li></ul>',
    );
  });

  it('rewrites nested lists innermost first and removes empty lists', () => {
    const html = '<dl><dt>Outer</dt><dd><dl><dt>Inner</dt><dd>value</dd></dl></dd></dl><dl></dl>';
    expect(applyPass(html, fixDl)).toBe(
      '<ul><li><strong>Outer:</strong> <ul><li><strong>Inner:</strong> value</li></ul></li></ul>',
    );
  });
});

describe('unwrapBlockyInline', () => {
  it('drops emphasis that wraps block content and keeps inline emphasis', () => {
    const html =
      '<em><p>Block.</p></em><strong><ul><li>x</li></ul></strong><p><em>inline</em> <b>bold</b></p>';
    expect(applyPass(html, unwrapBlockyInline)).toBe(
      '<p>Block.</p><ul><li>x</li></ul><p><em>inline</em> <b>bold</b></p>',
    );
  });
});

describe('absolutize', () => {
  const env = passEnv({ url: 'https://docs.example.com/guide/page/' });

  it('resolves links and images against the page URL and drops titles', () => {
    const html =
      '<a href="../other/" title="Other">o</a><a href="/root/">r</a><a href="#part">p</a><a href="https://x.example/y">x</a><img src="img/a.png" title="A" alt="a">';
    expect(applyPass(html, absolutize, env)).toBe(
      '<a href="https://docs.example.com/guide/other/">o</a><a href="https://docs.example.com/root/">r</a>' +
        '<a href="https://docs.example.com/guide/page/#part">p</a><a href="https://x.example/y">x</a>' +
        '<img src="https://docs.example.com/guide/page/img/a.png" alt="a">',
    );
  });

  it('keeps the text of script links and bare fragment links, without the link', () => {
    const html =
      '<a href="javascript:void(0)">run</a> <a href="#" onclick="go()">Top <b>now</b></a> <a href="">empty</a>';
    expect(applyPass(html, absolutize, env)).toBe('run Top <b>now</b> empty');
  });

  it('leaves a target that cannot be resolved as it is', () => {
    const html = '<a href="http://[bad">x</a><img src="http://[bad">';
    expect(applyPass(html, absolutize, env)).toBe(html);
  });
});
