import { describe, expect, it } from 'vitest';
import { fixCodeLinks } from '../../src/extract/passes/fix-code-links.js';
import { fixExpressiveCode } from '../../src/extract/passes/fix-expressive-code.js';
import { fixGatsbyCode } from '../../src/extract/passes/fix-gatsby-code.js';
import { fixGenericPre } from '../../src/extract/passes/fix-generic-pre.js';
import { fixGlossary } from '../../src/extract/passes/fix-glossary.js';
import { applyPass, passEnv, runPasses } from './support.js';

/** An Expressive Code block; `&#127;` is the line separator of the copy button. */
const expressive = (options: { button?: string; language?: string; title?: string; body: string }): string =>
  `<div class="expressive-code"><figure class="frame"><figcaption class="header">${
    options.title === undefined ? '' : `<span class="title">${options.title}</span>`
  }</figcaption><pre data-language="${options.language ?? 'js'}"><code>${options.body}</code></pre><div class="copy">${
    options.button === undefined ? '' : `<button data-code="${options.button}"></button>`
  }</div></figure></div>`;

const line = (text: string): string => `<div class="ec-line"><div class="code">${text}</div></div>`;
const collapsed = (label: string, lines: string): string =>
  `<details class="ec-section"><summary>${line(label)}</summary>${lines}</details>`;

describe('fixGlossary', () => {
  it('keeps the term and drops the definition popover', () => {
    const html =
      '<p>Add a <span data-term=""><a class="term" href="/g/layer/">layer</a><calcite-tooltip><span class="term-tooltip-wrapper">A layer is a set of features. <a href="/g/layer/">Learn more</a></span></calcite-tooltip></span> to it.</p>';
    expect(applyPass(html, fixGlossary)).toBe('<p>Add a layer to it.</p>');
  });

  it('unlinks a bare term and uses the span text when it holds no term link', () => {
    expect(applyPass('<p><a class="term" href="/g/x/">tile &amp; cache</a></p>', fixGlossary)).toBe(
      '<p>tile &amp; cache</p>',
    );
    expect(applyPass('<p><span data-term="">basemap</span></p>', fixGlossary)).toBe('<p>basemap</p>');
  });
});

describe('fixExpressiveCode', () => {
  it('takes the code from the copy button, with U+007F as newline', () => {
    const html = expressive({ button: 'const a = 1;&#127;&#127;const b = &quot;x&quot;;', body: line('const a = 1;') });
    const $ = runPasses(html, [fixExpressiveCode]);
    expect($('pre').attr('data-md-lang')).toBe('js');
    expect($('pre').text()).toBe('const a = 1;\n\nconst b = "x";');
    expect($('button, figure, .ec-line').length).toBe(0);
  });

  it('replaces the whole code-block wrapper, including its strip of links', () => {
    const html = `<div data-codeblock="{}"><div>${expressive({ button: 'x()', body: line('x()') })}</div><ul class="list-none"><li>View in CodePen</li></ul></div><p>after</p>`;
    expect(applyPass(html, fixExpressiveCode)).toBe('<pre data-md-lang="js">x()</pre><p>after</p>');
  });

  it('falls back to the rendered lines, without the collapsed-lines summary rows', () => {
    const body = collapsed('2 collapsed lines', line('import a;') + line('import b;')) + line('run();');
    const $ = runPasses(expressive({ body, language: 'typescript' }), [fixExpressiveCode]);
    expect($('pre').text()).toBe('import a;\nimport b;\nrun();');
    expect($('pre').attr('data-md-lang')).toBe('ts');
  });

  it('keeps only the expanded lines in focused mode and marks each collapsed run', () => {
    const body = collapsed('29 collapsed lines', line('a();')) + line('b();') + collapsed('3 collapsed lines', line('c();'));
    const block = (language: string): string => expressive({ button: 'a();&#127;b();&#127;c();', body, language });
    const focused = passEnv({ focusedCode: true });
    expect(runPasses(block('js'), [fixExpressiveCode], focused)('pre').text()).toBe(
      '// \u2026 29 collapsed lines \u2026\nb();\n// \u2026 3 collapsed lines \u2026',
    );
    expect(runPasses(block('html'), [fixExpressiveCode], focused)('pre').text()).toContain(
      '<!-- \u2026 29 collapsed lines \u2026 -->',
    );
    expect(runPasses(block('python'), [fixExpressiveCode], focused)('pre').text()).toContain(
      '# \u2026 29 collapsed lines \u2026',
    );
  });

  it('uses the full code in focused mode when nothing is collapsed', () => {
    const html = expressive({ button: 'a();&#127;b();', body: line('a();') + line('b();') });
    expect(runPasses(html, [fixExpressiveCode], passEnv({ focusedCode: true }))('pre').text()).toBe('a();\nb();');
  });

  it('writes a file title before the block', () => {
    const html = expressive({ button: 'x', body: line('x'), title: 'main.js' });
    expect(applyPass(html, fixExpressiveCode)).toBe('<p><em>main.js</em></p><pre data-md-lang="js">x</pre>');
  });
});

describe('fixGatsbyCode', () => {
  const block = (language: string): string =>
    `<div class="code-block"><div><calcite-button></calcite-button><calcite-tooltip>Copy</calcite-tooltip></div><pre data-language="${language}" class="syntax-highlighter"><code style="white-space:pre"><code style="display: none">1\n2\n</code><span><span class="react-syntax-highlighter-line-number">1</span>first\n</span><span><span class="linenumber">2</span>second\n</span></code></pre></div>`;

  it('drops the gutter, the hidden copy and the buttons', () => {
    expect(applyPass(block('javascript'), fixGatsbyCode)).toBe('<pre data-md-lang="js">first\nsecond\n</pre>');
  });

  it('maps the placeholder language "other" to no language', () => {
    expect(runPasses(block('other'), [fixGatsbyCode])('pre').attr('data-md-lang')).toBe('');
  });

  it('reads the language from the code class when the pre has none', () => {
    const html = '<div class="code-block"><pre><code class="hl language-json">{}</code></pre></div>';
    expect(applyPass(html, fixGatsbyCode)).toBe('<pre data-md-lang="json">{}</pre>');
  });

  it('handles highlighter blocks outside a code-block wrapper and skips wrappers without code', () => {
    const html =
      '<div class="code-block"><p>no code here</p></div><pre class="syntax-highlighter" data-language="sh"><span class="react-syntax-highlighter-line-number">1</span>ls</pre>';
    expect(applyPass(html, fixGatsbyCode)).toBe(
      '<div class="code-block"><p>no code here</p></div><pre data-md-lang="bash">ls</pre>',
    );
  });
});

describe('fixGenericPre', () => {
  const languageOf = (html: string, defaultLanguage = ''): string | undefined =>
    runPasses(html, [fixGenericPre], passEnv({ defaultLanguage }))('pre').attr('data-md-lang');

  it.each([
    ['<pre><code class="lang-csharp hljs">x</code></pre>', 'csharp'],
    ['<pre><code class="language-python">x</code></pre>', 'python'],
    ['<pre class="cpp">x</pre>', 'cpp'],
    ['<pre class="brush: js">x</pre>', 'js'],
    ['<pre data-language="c#">x</pre>', 'csharp'],
    ['<pre><code data-language="shell">x</code></pre>', 'bash'],
    ['<pre class="highlight-json notranslate">x</pre>', 'json'],
  ])('reads the language of %s', (html, language) => {
    expect(languageOf(html)).toBe(language);
  });

  it('uses the family default when no language is named, also for bare hljs', () => {
    expect(languageOf('<pre>x</pre>', 'kotlin')).toBe('kotlin');
    expect(languageOf('<pre><code class="hljs">x</code></pre>', 'csharp')).toBe('csharp');
    expect(languageOf('<pre class="language-text">x</pre>', 'java')).toBe('java');
    expect(languageOf('<pre>x</pre>')).toBe('');
  });

  it('leaves normalised blocks alone and turns <br> into newlines', () => {
    expect(languageOf('<pre data-md-lang="ts" class="language-python">x</pre>')).toBe('ts');
    expect(runPasses('<pre>a<br>b</pre>', [fixGenericPre])('pre').text()).toBe('a\nb');
  });
});

describe('fixCodeLinks', () => {
  it('turns a link inside a code span inside out', () => {
    expect(applyPass('<p><code><a href="/api/Chart/">Chart</a></code></p>', fixCodeLinks)).toBe(
      '<p><a href="/api/Chart/"><code>Chart</code></a></p>',
    );
  });

  it('keeps only the text when the code holds links among other text', () => {
    const html = '<code>find(<a href="/a">Filter</a> filter,\n  <a href="/b">Options</a> options)</code>';
    expect(applyPass(html, fixCodeLinks)).toBe('<code>find(Filter filter, Options options)</code>');
  });

  it('leaves code blocks, plain code and anchors without href alone', () => {
    const html = '<pre><code><a href="/a">x</a></code></pre><code>plain</code>';
    expect(applyPass(html, fixCodeLinks)).toBe(html);
    expect(applyPass('<code><a name="x">T</a></code>', fixCodeLinks)).toBe('<a><code>T</code></a>');
  });
});
