import { describe, expect, it } from 'vitest';
import {
  asRecord,
  isRecord,
  list,
  num,
  records,
  scalar,
  str,
  strings,
} from '../../src/render/json.js';
import {
  blocks,
  bullets,
  fence,
  fencedExample,
  firstSentence,
  headingText,
  inlineCode,
  shiftHeadings,
  splitAtFirstHeading,
  summaryLine,
  table,
  tableCell,
} from '../../src/render/md.js';

describe('json accessors', () => {
  it('degrade to "absent" for the wrong type', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(asRecord('x')).toEqual({});
    expect(str('  ')).toBeUndefined();
    expect(str('a')).toBe('a');
    expect(str(1)).toBeUndefined();
    expect(num(Number.NaN)).toBeUndefined();
    expect(num(2)).toBe(2);
    expect(list('x')).toEqual([]);
    expect(records([1, { a: 1 }, null, [2]])).toEqual([{ a: 1 }]);
    expect(strings(['a', 1, 'b'])).toEqual(['a', 'b']);
    expect(scalar(null)).toBeUndefined();
    expect(scalar(false)).toBe('false');
    expect(scalar(['a'])).toBe('["a"]');
  });
});

describe('markdown writers', () => {
  it('fence picks a marker longer than any backtick run in the code', () => {
    expect(fence('a\r\nb\n\n', 'js')).toBe('```js\na\nb\n```');
    expect(fence('```\ninner\n```')).toBe('````\n```\ninner\n```\n````');
    expect(fencedExample('plain()', 'js')).toBe('```js\nplain()\n```');
    expect(fencedExample('Text first.\n\n```ts\nfenced()\n```\n', 'js')).toBe(
      'Text first.\n\n```ts\nfenced()\n```',
    );
  });

  it('inlineCode survives backticks', () => {
    expect(inlineCode('a  b\nc')).toBe('`a b c`');
    expect(inlineCode('a `b` c')).toBe('`` a `b` c ``');
  });

  it('firstSentence skips code, headings and tables and stops at a sentence end', () => {
    expect(firstSentence(undefined)).toBe('');
    expect(
      firstSentence('## Title\n\n```js\ncode();\n```\n\n| a |\n| --- |\n\nFirst one. Second one.'),
    ).toBe('First one.');
    expect(firstSentence('Use e.g. a buffer of 2.5 metres. Then stop.')).toBe(
      'Use e.g. a buffer of 2.5 metres.',
    );
    expect(firstSentence('> Quoted\n> text here.\n\nNext.')).toBe('Quoted text here.');
    expect(firstSentence('Done! **Note:** more.')).toBe('Done!');
    expect(firstSentence('No terminator\n```js\nx\n```')).toBe('No terminator');
  });

  it('summaryLine drops link targets', () => {
    expect(
      summaryLine(
        'See [the guide](https://example.com/guide) and [`Map`](https://example.com/Map). More.',
      ),
    ).toBe('See the guide and `Map`.');
  });

  it('table cells stay on one line', () => {
    expect(tableCell(undefined)).toBe('');
    expect(tableCell('a\nb\n\nc | d\n- one\n- two')).toBe('a b<br>c \\| d<br>- one<br>- two');
    expect(table(['A', 'B'], [])).toBe('');
    expect(table(['A', 'B'], [['1'], ['2', 'x\ny']])).toBe(
      '| A | B |\n| --- | --- |\n| 1 |  |\n| 2 | x y |',
    );
  });

  it('bullets indent continuation lines and blocks drop empty parts', () => {
    expect(bullets(['one', '', 'two\nmore'])).toBe('- one\n- two\n  more');
    expect(blocks('a', undefined, false, '  ', '\n\nb\n\n')).toBe('a\n\nb');
  });

  it('shiftHeadings moves headings down, never inside fences, never past level 6', () => {
    expect(shiftHeadings('## A\n\n```md\n# not a heading\n```\n\n### B', 4)).toBe(
      '#### A\n\n```md\n# not a heading\n```\n\n##### B',
    );
    expect(shiftHeadings('##### A\n\n###### B', 6)).toBe('###### A\n\n###### B');
    expect(shiftHeadings('### Deep enough', 2)).toBe('### Deep enough');
    expect(shiftHeadings('No headings', 3)).toBe('No headings');
  });

  it('splitAtFirstHeading separates the introduction from titled parts', () => {
    expect(splitAtFirstHeading('Intro.\n\n```\n# code\n```\n\n## Part\n\nText.')).toEqual({
      intro: 'Intro.\n\n```\n# code\n```',
      titled: '## Part\n\nText.',
    });
    expect(splitAtFirstHeading('Only intro.\n')).toEqual({ intro: 'Only intro.', titled: '' });
  });

  it('headingText protects names Markdown would restyle', () => {
    expect(headingText('queryFeatures')).toBe('queryFeatures');
    expect(headingText('__init__')).toBe('`__init__`');
    expect(headingText('Array<T>')).toBe('`Array<T>`');
  });
});
