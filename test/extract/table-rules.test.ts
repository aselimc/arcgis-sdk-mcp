import { gfm } from '@joplin/turndown-plugin-gfm';
import TurndownService from 'turndown';
import { describe, expect, it } from 'vitest';
import { addLinearTableRules } from '../../src/extract/table-rules.js';

/** A converter with the GFM plugin alone, or with the linear rules on top of it. */
function converter(linear: boolean): (html: string) => string {
  const service = new TurndownService({ headingStyle: 'atx' });
  service.use(gfm);
  if (linear) addLinearTableRules(service);
  return (html) => service.turndown(html);
}

const plugin = converter(false);
const linear = converter(true);

// The linear rules replace the plugin's quadratic ones for plain tables; they must write
// the same Markdown, and leave every table they do not recognise to the plugin.
describe('linear table rules', () => {
  const SHAPES: ReadonlyArray<[name: string, html: string]> = [
    [
      'a header row and escaped pipes and breaks',
      '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>x|y</td></tr><tr><td>3</td><td>4<br>5</td></tr></tbody></table>',
    ],
    ['no header row', '<table><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></table>'],
    [
      'alignment',
      '<table><tr><th>h1</th><th align="right">h2</th></tr><tr><td>3</td><td align="right">4</td></tr></table>',
    ],
    [
      'a caption',
      '<table><caption>Cap</caption><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>',
    ],
    ['one cell', '<table><tr><td>only</td></tr></table>'],
    [
      'a code block in a cell',
      '<table><tr><td><pre><code>x</code></pre></td><td>2</td></tr></table>',
    ],
    ['a list in a cell', '<table><tr><td><ul><li>x</li></ul></td><td>2</td></tr></table>'],
    [
      'a colspan',
      '<table><thead><tr><th>a</th><th>b</th><th>c</th></tr></thead><tbody><tr><td colspan="2">wide</td><td>z</td></tr></tbody></table>',
    ],
    [
      'inline markup and empty cells between paragraphs',
      '<p>before</p><table><thead><tr><th></th><th>b</th></tr></thead><tbody><tr><td></td><td><code>q</code> <a href="/u">l</a></td></tr></tbody></table><p>after</p>',
    ],
    [
      'a header row of th cells in the body',
      '<table><tbody><tr><th>x</th><th>y</th></tr><tr><td>1</td><td>2</td></tr></tbody></table>',
    ],
  ];

  it.each(SHAPES)('writes what the plugin writes for %s', (_name, html) => {
    expect(linear(html)).toBe(plugin(html));
  });

  it('writes a plain table as a GFM table', () => {
    expect(
      linear(
        '<table><thead><tr><th>Name</th><th>Type</th></tr></thead><tbody><tr><td><code>id</code></td><td>string</td></tr></tbody></table>',
      ),
    ).toBe('| Name | Type |\n| --- | --- |\n| `id` | string |');
  });
});
