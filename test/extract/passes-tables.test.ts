import { describe, expect, it } from 'vitest';
import { BR_PLACEHOLDER } from '../../src/extract/dom.js';
import { fixTables } from '../../src/extract/passes/fix-tables.js';
import { SHARED_PASSES } from '../../src/extract/pipeline.js';
import { applyPass, extractHtml, pageMarkdown, passEnv } from './support.js';

/** Converts a body fragment through the whole pipeline (generic family) and drops the title. */
const markdownOf = (body: string): string =>
  pageMarkdown(
    extractHtml(`<html><head><title>T</title></head><body><main>${body}</main></body></html>`),
  )
    .replace(/^# T\n\n/, '')
    .trimEnd();

describe('fixTables', () => {
  it('rebuilds a simple table with a header section and flattened cells', () => {
    const env = passEnv();
    const html =
      '<table><colgroup><col></colgroup><tr><th>Name</th><th>Use</th></tr><tr><td><p>id</p></td><td><div>Key</div></td></tr></table>';
    expect(applyPass(html, fixTables, env)).toBe(
      '<table><thead><tr><th>Name</th><th>Use</th></tr></thead><tbody><tr><td>id</td><td>Key</td></tr></tbody></table>',
    );
    expect(env.counters.tables).toEqual({ gfm: 1 });
  });

  it('marks paragraph and <br> breaks inside a cell and pads short rows', () => {
    const html =
      '<table><thead><tr><th>A</th><th>B</th><th>C</th></tr></thead><tbody><tr><td><p>one</p><p>two</p></td><td>x<br>y</td></tr></tbody></table>';
    expect(applyPass(html, fixTables)).toBe(
      `<table><thead><tr><th>A</th><th>B</th><th>C</th></tr></thead><tbody><tr><td>one${BR_PLACEHOLDER}two</td><td>x${BR_PLACEHOLDER}y</td><td></td></tr></tbody></table>`,
    );
  });

  it('moves the caption to a bold paragraph before the table', () => {
    const html =
      '<table><caption>Scale limits</caption><tr><th>A</th></tr><tr><td>1</td></tr></table>';
    expect(applyPass(html, fixTables)).toBe(
      '<p><strong>Scale limits</strong></p><table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>',
    );
  });

  it('turns a headerless two-column table into key and value bullets', () => {
    const env = passEnv();
    const html =
      '<table><tr><td>Header:</td><td><code>Chart.h</code></td></tr><tr><td>Since</td></tr></table>';
    expect(applyPass(html, fixTables, env)).toBe(
      '<ul><li><strong>Header:</strong> <code>Chart.h</code></li><li><strong>Since:</strong> </li></ul>',
    );
    expect(env.counters.tables).toEqual({ 'key-value': 1 });
  });

  // Regression: the parameter tables of the Python reference printed "**`Parameter`**" and
  // "**Description**" as if they were the first parameter.
  it('takes a first row of bold cells for the header', () => {
    const env = passEnv();
    const html =
      '<table><tbody><tr><td><p><strong>Parameter</strong></p></td><td><p><strong>Description</strong></p></td></tr><tr><td><p>url</p></td><td><p>Optional string.</p></td></tr></tbody></table>';
    expect(applyPass(html, fixTables, env)).toBe(
      '<table><thead><tr><th><strong>Parameter</strong></th><th><strong>Description</strong></th></tr></thead><tbody><tr><td>url</td><td>Optional string.</td></tr></tbody></table>',
    );
    expect(env.counters.tables).toEqual({ gfm: 1 });
  });

  it('does not take a partly bold first row for a header', () => {
    const html =
      '<table><tr><td><strong>Note</strong> first</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>';
    expect(applyPass(html, fixTables)).toContain(
      '<li><strong><strong>Note</strong> first:</strong> b</li>',
    );
  });

  it('gives a headerless table of another width an empty header', () => {
    const html = '<table><tr><td>a</td><td>b</td><td>c</td></tr></table>';
    expect(applyPass(html, fixTables)).toBe(
      '<table><thead><tr><th></th><th></th><th></th></tr></thead><tbody><tr><td>a</td><td>b</td><td>c</td></tr></tbody></table>',
    );
  });

  it('writes a two-column table with block content as definition blocks', () => {
    const env = passEnv();
    const html =
      '<table><thead><tr><th>Parameter</th><th>Details</th></tr></thead><tbody>' +
      '<tr><td><code>where</code><p>(Required)</p></td><td><p>A filter.</p><pre>a = 1</pre></td></tr>' +
      '<tr><td>plain key</td><td><ul><li>x</li></ul></td></tr><tr><td><a href="/k">linked</a></td></tr></tbody></table>';
    expect(applyPass(html, fixTables, env)).toBe(
      '<div><p><em>Parameter / Details</em></p>' +
        '<p><strong><code>where</code> (Required)</strong></p><p>A filter.</p><pre>a = 1</pre>' +
        '<p><strong><code>plain key</code></strong></p><ul><li>x</li></ul>' +
        '<p><strong><a href="/k">linked</a></strong></p></div>',
    );
    expect(env.counters.tables).toEqual({ definition: 1 });
  });

  it('writes a wider table with block content as one record list per row', () => {
    const env = passEnv();
    const html =
      '<table><tr><th>Field</th><th>Type</th><th></th></tr><tr><td><code>berths</code></td><td>array</td><td><ul><li>max 50</li></ul></td></tr><tr><td></td><td>x</td><td><pre>y</pre></td></tr></table>';
    expect(applyPass(html, fixTables, env)).toBe(
      '<div><p><strong><code>berths</code></strong></p><ul><li><strong>Type:</strong> array</li><li><strong>Column 3:</strong> <ul><li>max 50</li></ul></li></ul>' +
        '<p><strong>(row)</strong></p><ul><li><strong>Type:</strong> x</li><li><strong>Column 3:</strong> <pre>y</pre></li></ul></div>',
    );
    expect(env.counters.tables).toEqual({ records: 1 });
  });

  it('rewrites a nested table first and treats its parent as a table with block content', () => {
    const env = passEnv();
    const html =
      '<table><tr><th>K</th><th>V</th></tr><tr><td>outer</td><td><table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table></td></tr></table>';
    const out = applyPass(html, fixTables, env);
    expect(out).toContain('<p><strong><code>outer</code></strong></p><table><thead>');
    expect(env.counters.tables).toEqual({ gfm: 1, definition: 1 });
  });

  it('removes a table without rows and ignores the caption of a nested table', () => {
    expect(applyPass('<p>a</p><table><caption>Empty</caption></table>', fixTables)).toBe(
      '<p>a</p><p><strong>Empty</strong></p>',
    );
  });

  it('produces Markdown without raw HTML for every strategy', () => {
    expect(
      markdownOf(
        '<table><tr><th>A</th><th>B</th></tr><tr><td><p>1</p><p>2</p></td><td>x | y</td></tr></table>',
      ),
    ).toBe('| A   | B   |\n| --- | --- |\n| 1<br>2 | x \\| y |');
    expect(markdownOf('<table><tr><td>Header:</td><td>Chart.h</td></tr></table>')).toBe(
      '- **Header:** Chart.h',
    );
    expect(
      markdownOf(
        '<table><tr><th>P</th><th>D</th></tr><tr><td><code>f</code></td><td><p>Format.</p><pre class="language-json">{}</pre></td></tr></table>',
      ),
    ).toBe('_P / D_\n\n**`f`**\n\nFormat.\n\n```json\n{}\n```');
    expect(
      markdownOf(
        '<table><tr><th>F</th><th>T</th><th>N</th></tr><tr><td>b</td><td>array</td><td><ul><li>x</li></ul></td></tr></table>',
      ),
    ).toBe('**b**\n\n- **T:** array\n- **N:**\n  - x');
  });
});

describe('the shared pass order', () => {
  it('is the fixed order of the design', () => {
    expect(SHARED_PASSES.map((pass) => pass.name)).toEqual([
      'fixGlossary',
      'fixExpressiveCode',
      'fixGatsbyCode',
      'fixIslands',
      'fixTabs',
      'iconLabelsToText',
      'removeCommon',
      // Not in the design's list: added when live pages showed `<details>` toggle labels.
      'fixDetails',
      'fixCodeLinks',
      'fixAsides',
      'fixDl',
      'unwrapBlockyInline',
      'fixTables',
      'fixGenericPre',
      'absolutize',
    ]);
  });

  it('reads code and tab labels from buttons before buttons are removed', () => {
    const md = markdownOf(
      '<div role="tablist"><button role="tab" aria-controls="p">Request</button></div><div id="p" role="tabpanel" hidden="">' +
        '<div class="expressive-code"><pre data-language="bash"><code></code></pre><button data-code="curl -I /x">Copy</button></div></div>',
    );
    expect(md).toBe('**Request**\n\n```bash\ncurl -I /x\n```');
  });

  it('reads icon labels before SVGs are removed, and rewrites tables after asides and lists', () => {
    const md = markdownOf(
      '<table><tr><th>Name</th><th>Facts</th><th>Required</th></tr><tr><td>id</td><td><dl><dt>Type</dt><dd>key</dd></dl></td><td><svg aria-label="Not required"></svg></td></tr></table>',
    );
    // The definition list is a bullet list, hence block content, when tables are classified.
    expect(md).toBe('**id**\n\n- **Facts:**\n  - **Type:** key\n- **Required:** no');
  });
});
