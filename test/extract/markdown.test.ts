import { describe, expect, it } from 'vitest';
import { buildSections, stripHeadingMarks } from '../../src/extract/build-sections.js';
import { measureMarkdown, scanLines } from '../../src/extract/diagnostics.js';
import { BR_PLACEHOLDER } from '../../src/extract/dom.js';
import { postProcess } from '../../src/extract/post-process.js';
import { createMarkdownConverter, fence } from '../../src/extract/turndown.js';

const convert = createMarkdownConverter();
/** Converted and post-processed Markdown without heading markers. */
const md = (html: string): string => stripHeadingMarks(postProcess(convert(html).markdown));

describe('fence', () => {
  it('fences code with its language', () => {
    expect(fence('a = 1', 'python')).toBe('```python\na = 1\n```');
    expect(fence('plain', '')).toBe('```\nplain\n```');
  });

  it('uses a fence one backtick longer than the longest run inside the code', () => {
    expect(fence('use ```js fences', 'md')).toBe('````md\nuse ```js fences\n````');
    expect(fence('a `b` ````c````', '')).toBe('`````\na `b` ````c````\n`````');
  });

  it('normalises NBSP, line endings and surrounding blank lines, and keeps indentation', () => {
    expect(fence('\n\n  if x:\r\n    y = 1  \r\n\n', 'python')).toBe('```python\n  if x:\n    y = 1\n```');
  });
});

describe('createMarkdownConverter', () => {
  it('fences a normalised pre with the language of its attribute', () => {
    expect(md('<pre data-md-lang="ts">const a: number = 1;</pre>')).toBe('```ts\nconst a: number = 1;\n```');
    expect(md('<pre><code>&lt;div&gt;</code></pre>')).toBe('```\n<div>\n```');
  });

  it('reports heading ids in order, preferring the stamped id', () => {
    const result = convert('<h1>Title</h1><h2 id="a">A</h2><h3 id="b" data-md-id="b-1">B</h3><h2 id="">C</h2>');
    expect(result.headingIds).toEqual([undefined, 'a', 'b-1', undefined]);
    expect(stripHeadingMarks(result.markdown)).toBe('# Title\n\n## A\n\n### B\n\n## C');
  });

  it('resets the heading ids on every call', () => {
    convert('<h2 id="first">First</h2>');
    expect(convert('<h2 id="second">Second</h2>').headingIds).toEqual(['second']);
  });

  it('drops empty headings and writes a heading on one line', () => {
    const result = convert('<h2 id="x"> </h2><h3 id="y">Two\n  lines</h3>');
    expect(result.headingIds).toEqual(['y']);
    expect(stripHeadingMarks(result.markdown)).toBe('### Two lines');
  });

  it('drops links without text, keeps image links', () => {
    expect(md('<h2>Title<a href="#title"></a></h2><p><a href="/x"><img src="/i.png" alt="pic"></a></p>')).toBe(
      '## Title\n\n[![pic](/i.png)](/x)',
    );
  });

  it('removes scripts, styles, buttons, forms and inline SVG', () => {
    expect(md('<p>a</p><script>x()</script><style>p{}</style><button>b</button><form>f</form><svg><text>t</text></svg><p>z</p>')).toBe('a\n\nz');
  });

  it('writes compact list items', () => {
    expect(md('<ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul>')).toBe('- one\n- two\n  - nested');
    expect(md('<ol><li>first</li><li>second</li></ol>')).toBe('1. first\n2. second');
    expect(md('<ol start="9"><li>nine</li><li>ten</li></ol>')).toBe('9. nine\n10. ten');
    expect(md('<ol start="x"><li>one</li></ol>')).toBe('1. one');
  });

  it('indents the blocks of a list item by the width of its marker', () => {
    expect(md('<ol><li><p>Run it:</p><pre data-md-lang="bash">make\n\nmake test</pre></li><li><p>Done.</p></li></ol>')).toBe(
      '1. Run it:\n\n   ```bash\n   make\n\n   make test\n   ```\n2. Done.',
    );
  });

  it('writes a clean table as a GFM table and emphasis with underscores', () => {
    expect(md('<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td><em>x</em></td><td><strong>y</strong></td></tr></tbody></table>')).toBe(
      '| A   | B   |\n| --- | --- |\n| _x_ | **y** |',
    );
    expect(md('<hr>')).toBe('---');
  });
});

describe('postProcess', () => {
  it('collapses blank lines outside fences and keeps them inside', () => {
    expect(postProcess('a\n\n\n\nb\n\n```js\nx\n\n\ny\n```\n\n\n')).toBe('a\n\nb\n\n```js\nx\n\n\ny\n```');
  });

  it('strips trailing whitespace everywhere and leading blank lines', () => {
    expect(postProcess('\n\n a  \n```\ncode   \n```  ')).toBe('a\n```\ncode\n```');
  });

  it('writes cell line breaks, NBSP and zero-width characters', () => {
    expect(postProcess(`| a${BR_PLACEHOLDER}b |\nx y\u200b\u200c\u200d\ufeffz`)).toBe('| a<br>b |\nx yz');
  });

  it('keeps special characters inside fences', () => {
    expect(postProcess('```\na b\n```')).toBe('```\na b\n```');
  });

  it('removes a lone leading space but keeps real indentation', () => {
    expect(postProcess(' **Label**\n- a\n  - b\n   c')).toBe('**Label**\n- a\n  - b\n   c');
  });

  it('normalises Windows line endings', () => {
    expect(postProcess('a\r\n\r\nb\rc')).toBe('a\n\nb\nc');
  });
});

describe('scanLines and measureMarkdown', () => {
  it('tracks fences at any indentation and inside block quotes', () => {
    const lines = scanLines('- item\n    ```js\n    # not a heading\n    ```\n> ~~~\n> quoted\n> ~~~\ntext');
    expect(lines.map((line) => line.fenced)).toEqual([false, true, true, true, true, true, true, false]);
    expect(lines[1]?.opens).toBe('js');
    expect(lines[3]?.closes).toBe(true);
    expect(lines[4]?.opens).toBe('');
  });

  it('closes a fence only on the same character, at least as long, with nothing after it', () => {
    const lines = scanLines('````\n```\n~~~~\n```` js\n````\nafter');
    expect(lines.map((line) => line.fenced)).toEqual([true, true, true, true, true, false]);
  });

  it('counts fences and the ones with a language', () => {
    const metrics = measureMarkdown('```js\na\n```\n\n```\nb\n```\n\n~~~python\nc\n~~~');
    expect(metrics).toEqual({ fences: 3, fencesWithLanguage: 2, leftoverHtmlTags: 0, unclosedFence: false });
  });

  it('reports an unclosed fence', () => {
    expect(measureMarkdown('text\n\n```js\nnever closed').unclosedFence).toBe(true);
    expect(measureMarkdown('```js').unclosedFence).toBe(true);
  });

  it('counts HTML and custom-element tags outside code, but not <br>, type parameters or code spans', () => {
    const text = [
      'A <div class="x">box</div> and <calcite-icon scale="s"></calcite-icon>.',
      'Cell one<br>cell two<br/>.',
      'Returns Promise<FeatureSet> or List<T>, see `<span>` and `<table>`.',
      '```html',
      '<section><p>in code</p></section>',
      '```',
    ].join('\n');
    expect(measureMarkdown(text).leftoverHtmlTags).toBe(4);
  });
});

describe('buildSections', () => {
  const sections = (html: string) => {
    const converted = convert(html);
    return buildSections({ markdown: postProcess(converted.markdown), headingIds: converted.headingIds });
  };

  it('uses the page ids of headings and slugs for the rest', () => {
    const result = sections('<h1>Guide</h1><p>Lead.</p><h2 id="set-up">Set up</h2><p>x</p><h3>Next steps</h3><p>y</p>');
    expect(result.map((section) => [section.id, section.level, section.title, section.parent])).toEqual([
      ['guide', 1, 'Guide', undefined],
      ['set-up', 2, 'Set up', 'guide'],
      ['next-steps', 3, 'Next steps', 'set-up'],
    ]);
    expect(result[1]?.markdown).toBe('## Set up\n\nx');
    expect(result.every((section) => section.tokens > 0)).toBe(true);
  });

  it('keeps ids that no selector could hold, such as erased Java signatures', () => {
    const result = sections('<h3 data-md-id="&lt;init&gt;(com.example.Item,int)">Chart</h3><p>x</p>');
    expect(result[0]?.id).toBe('<init>(com.example.Item,int)');
    expect(result[0]?.title).toBe('Chart');
  });

  it('numbers repeated ids in document order and points parents at the final ids', () => {
    const result = sections('<h2>Parameters</h2><h3>Notes</h3><h2>Parameters</h2><h3>Notes</h3><h2 id="parameters-1">Clash</h2>');
    expect(result.map((section) => [section.id, section.parent])).toEqual([
      ['parameters', undefined],
      ['notes', 'parameters'],
      ['parameters-1', undefined],
      ['notes-1', 'parameters-1'],
      ['parameters-1-1', undefined],
    ]);
  });

  it('gives text before the first heading the lead id', () => {
    const result = sections('<p>Intro.</p><h2 id="a">A</h2>');
    expect(result.map((section) => [section.id, section.level, section.title])).toEqual([
      ['_lead', 0, ''],
      ['a', 2, 'A'],
    ]);
  });

  it('strips the markers of headings that are not sections of their own', () => {
    const result = sections('<h2 id="a">A</h2><blockquote><h3 id="quoted">Quoted</h3><p>x</p></blockquote>');
    expect(result).toHaveLength(1);
    expect(result[0]?.markdown).toBe('## A\n\n> ### Quoted\n>\n> x');
  });

  it('does not split at heading-like lines inside code', () => {
    const result = sections('<h2 id="a">A</h2><pre data-md-lang="python"># a comment\nx = 1</pre>');
    expect(result).toHaveLength(1);
    expect(result[0]?.markdown).toContain('# a comment');
  });
});
