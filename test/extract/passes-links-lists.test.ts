import { describe, expect, it } from 'vitest';
import { fixCodeSwitchers } from '../../src/extract/passes/fix-code-switchers.js';
import { fixLinkGroups } from '../../src/extract/passes/fix-link-groups.js';
import { fixLists } from '../../src/extract/passes/fix-lists.js';
import { createMarkdownConverter, linkDestination } from '../../src/extract/turndown.js';
import { applyPass, extractHtml, pageMarkdown } from './support.js';

/** Converts a body fragment through the whole pipeline (generic family) and drops the title. */
const markdownOf = (body: string): string =>
  pageMarkdown(
    extractHtml(`<html><head><title>T</title></head><body><main>${body}</main></body></html>`),
  )
    .replace(/^# T\n\n/, '')
    .trimEnd();

describe('fixLists', () => {
  // Regression: legacy help puts a note between two steps (`</li><div>..</div><li>`). The
  // note ended the list in Markdown and the following steps were numbered one too high.
  it('moves a block between two items into the item before it', () => {
    expect(
      applyPass('<ol><li>one</li><li>two</li><p>stray</p><li>three</li></ol>', fixLists),
    ).toBe('<ol><li>one</li><li>two<p>stray</p></li><li>three</li></ol>');
  });

  it('keeps the numbers of the steps that follow', () => {
    expect(
      markdownOf('<ol><li>one</li><li>two</li><div><p>stray</p></div><li>three</li></ol>'),
    ).toBe('1. one\n2. two\n\n   stray\n3. three');
  });

  it('leaves content before the first item, whitespace and well-formed lists alone', () => {
    const html = '<ul><p>lead</p> <li>a</li> <!-- c --> <li>b</li></ul>';
    expect(applyPass(html, fixLists)).toBe(html);
  });
});

describe('list numbering', () => {
  const convert = createMarkdownConverter();

  it('counts items only, also when another element sits between them', () => {
    expect(convert('<ol start="3"><li>a</li><div>x</div><li>b</li></ol>').markdown).toContain(
      '4. b',
    );
  });
});

describe('fixLinkGroups', () => {
  // Regression: every card of a JavaScript SDK sample page printed as "[", an image, a
  // "###" heading, a label and "](url)" on lines of their own.
  it('turns cards into one list of links with their label', () => {
    const md = markdownOf(
      '<h2 id="related">Related</h2><div class="card-group"> ' +
        '<a class="card is-link" href="/a/"><div class="card-image"><img src="t.avif" alt="A"></div><div class="card-body"><h3>Alpha</h3></div><div class="card-footer"><span>Sample Code</span></div></a>' +
        '<a class="card is-link" href="/b/"><div class="card-header"><h4>Beta</h4></div><div class="card-body"><p>What beta is.</p></div></a></div>',
    );
    expect(md).toBe(
      '## Related\n\n- [Alpha](https://docs.example.com/a/): Sample Code\n- [Beta](https://docs.example.com/b/): What beta is.',
    );
  });

  it('does not take the heading of a card for a section of the page', () => {
    const page = extractHtml(
      '<html><head><title>T</title></head><body><main><h2 id="pie">Pie charts</h2><p>Text.</p>' +
        '<a class="card" href="/x/"><h3 id="pie">Pie charts</h3></a></main></body></html>',
    );
    expect(page.sections.map((section) => section.id)).toEqual(['t', 'pie']);
  });

  it('keeps a heading that only links to itself as a heading', () => {
    expect(applyPass('<a href="#setup"><h2>Setup</h2></a>', fixLinkGroups)).toBe('<h2>Setup</h2>');
  });

  // Regression: chips laid out with CSS `gap` printed as `[A](..)[B](..)`, read "AB".
  it('puts a comma between links that touch', () => {
    expect(
      applyPass(
        '<div><a href="/js/"><span>JavaScript</span></a><a href="/kt/">Kotlin</a> <a href="/sw/">Swift</a><a href="/e/"></a></div>',
        fixLinkGroups,
      ),
    ).toBe(
      '<div><a href="/js/"><span>JavaScript</span></a>, <a href="/kt/">Kotlin</a> <a href="/sw/">Swift</a><a href="/e/"></a></div>',
    );
  });
});

describe('fixCodeSwitchers', () => {
  const dropdown = (shown: string, ...labels: string[]): string =>
    `<div data-header class="code-switcher"><calcite-dropdown><calcite-button slot="trigger"><span>${shown}</span></calcite-button>` +
    `<calcite-dropdown-group>${labels
      .map((label) => `<calcite-dropdown-item><span>${label}</span></calcite-dropdown-item>`)
      .join('')}</calcite-dropdown-group></calcite-dropdown></div>`;

  // Regression: the dropdown lost its button to the bulk removal and printed "GETPOST".
  it('labels the block with the selected variant and names the ones the page does not hold', () => {
    const md = markdownOf(
      `${dropdown('GET', 'GET', 'POST')}<div class="code-block"><pre data-language="curl"><code>GET /find</code></pre></div>`,
    );
    expect(md).toBe(
      '**GET** _(the page also offers POST; only GET is in its HTML)_\n\n```curl\nGET /find\n```',
    );
    expect(md).not.toContain('GETPOST');
  });

  it('writes no note for a switcher with one variant', () => {
    expect(applyPass(dropdown('Python', 'Python'), fixCodeSwitchers)).toBe(
      '<p><strong>Python</strong></p>',
    );
  });

  // Regression: native SDK sample pages printed the file names as one run-on line and left
  // every code block without the name of its file.
  it('drops the strip when every variant is in the page, and names each block', () => {
    const block = (label: string, code: string, hidden = ''): string =>
      `<div data-codeblock='{"label":"${label}","language":"kt"}'${hidden}><div class="expressive-code"><figure><figcaption></figcaption>` +
      `<pre data-language="kt"><code></code></pre><button data-code="${code}"></button></figure></div></div>`;
    const md = markdownOf(
      `<starship-code-switcher-dropdown>${dropdown('Main.kt', 'Main.kt', 'Screen.kt')}` +
        `${block('Main.kt', 'fun main() {}')}${block('Screen.kt', 'fun screen() {}', ' hidden')}</starship-code-switcher-dropdown>`,
    );
    expect(md).toBe(
      '_Main.kt_\n\n```kotlin\nfun main() {}\n```\n\n_Screen.kt_\n\n```kotlin\nfun screen() {}\n```',
    );
  });

  it('leaves an ARIA tab strip of the same class to the tab pass', () => {
    const html =
      '<div class="tab-nav code-switcher" role="tablist"><button role="tab">ESM</button></div>';
    expect(applyPass(html, fixCodeSwitchers)).toBe(html);
  });

  it('removes a menu that no rule knows instead of printing its items run together', () => {
    expect(
      markdownOf(
        '<p>Before.</p><calcite-dropdown><calcite-dropdown-item>One</calcite-dropdown-item><calcite-dropdown-item>Two</calcite-dropdown-item></calcite-dropdown>',
      ),
    ).toBe('Before.');
  });
});

describe('link destinations', () => {
  // Regression: DocC member URLs were written as `.../tojson\(\)/`; passed back as a ref,
  // the backslashes became path separators and the read failed with a garbled DOC_NOT_FOUND.
  it('writes paired parentheses of a URL as they are', () => {
    const md = markdownOf(
      '<p><a href="https://docs.example.com/swift/jsonserializable/tojson()/"><code>toJson()</code></a> and ' +
        '<a href="https://docs.example.com/swift/display/init(datasource:)">init</a></p>',
    );
    expect(md).toBe(
      '[`toJson()`](https://docs.example.com/swift/jsonserializable/tojson()/) and [init](https://docs.example.com/swift/display/init(datasource:))',
    );
    expect(md).not.toContain('\\');
  });

  it('percent-encodes a parenthesis without a partner, and spaces', () => {
    expect(linkDestination('https://e.com/a(b')).toBe('https://e.com/a%28b');
    expect(linkDestination('https://e.com/a)b(')).toBe('https://e.com/a%29b%28');
    expect(linkDestination('https://e.com/a b')).toBe('https://e.com/a%20b');
    expect(linkDestination('https://e.com/f(g(h))')).toBe('https://e.com/f(g(h))');
  });
});
