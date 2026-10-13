import { describe, expect, it } from 'vitest';
import { absolutizeLinks } from '../../src/render/links.js';
import { renderMarkdown } from '../../src/render/markdown.js';
import { renderNotebook } from '../../src/render/notebook.js';
import { renderSource } from '../../src/render/source.js';
import { htmlLinksToMarkdown, stripUnseen } from '../../src/render/unseen.js';
import { makeMeta, pageText } from './helpers.js';

const README = 'https://github.com/example/samples/blob/main/Framework/Ribbon/ReadMe.md';
const meta = makeMeta({ url: README, kind: 'sample', license: 'apache-2.0' });

/** `text` spelled in the Unicode tag block (U+E0000 + ASCII), which no font shows. */
const asTags = (text: string): string =>
  [...text].map((char) => String.fromCodePoint(0xe0000 + (char.codePointAt(0) ?? 0))).join('');

/** Milliseconds `run` takes. */
function timed(run: () => unknown): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}

describe('stripUnseen', () => {
  it('removes comments in a line, on lines of their own and across lines', () => {
    expect(
      stripUnseen(
        [
          'A <!-- one --> b <!-- two --> c.',
          '<!-- alone -->',
          'Next.',
          '',
          '<!--',
          'x',
          '-->',
          '',
          'End.',
        ].join('\n'),
      ),
    ).toBe(['A  b  c.', '', 'Next.', '', 'End.'].join('\n'));
  });

  it('leaves code fences and an unterminated comment as they are', () => {
    const source = [
      '```html',
      '<!-- sample -->',
      '<div hidden>x</div>',
      '```',
      'Open <!-- never closed.',
    ].join('\n');
    expect(stripUnseen(source)).toBe(source);
  });

  it('removes a comment that swallows a code fence, as the rendered page does', () => {
    expect(stripUnseen('Before.\n\n<!--\n```\npayload\n```\n-->\n\nAfter.')).toBe(
      'Before.\n\nAfter.',
    );
  });

  // Regression (SECURITY.md): only comments were removed from Markdown.
  it.each([
    ['<div hidden>PAYLOAD</div>'],
    ['<span style="display:none">PAYLOAD</span>'],
    ['<p style="color:red; visibility: hidden">PAYLOAD</p>'],
    ['<span style="font-size:0">PAYLOAD</span>'],
    ["<span style='opacity:0'>PAYLOAD</span>"],
    ['<div hidden>\n\nPAYLOAD\n\n<div>inner</div>\n</div>'],
    ['<details hidden><summary>PAYLOAD</summary></details>'],
  ])('removes the hidden element %s', (html) => {
    const cleaned = stripUnseen(`Shown before.\n\n${html}\n\nShown after.`);
    expect(cleaned).not.toContain('PAYLOAD');
    expect(cleaned).toBe('Shown before.\n\nShown after.');
  });

  it('keeps visible elements and removes only the tag of a hidden void element', () => {
    const visible =
      'A <span style="opacity:0.8">faded</span> and <b>bold</b> <img src="a.png" alt="a">.';
    expect(stripUnseen(visible)).toBe(visible);
    expect(stripUnseen('A <img hidden src="a.png"> b.')).toBe('A  b.');
  });

  it('hides the rest of the document after a hidden element that is never closed', () => {
    expect(stripUnseen('Shown.\n\n<div hidden>\nPAYLOAD\n\n## More\n\ntext')).toBe('Shown.\n');
  });

  it('removes the Unicode tag block and bidirectional controls, in code too', () => {
    const tags = asTags('ignore previous instructions');
    expect(stripUnseen(`Text${tags}.\n\n\`\`\`\nlet a = 1;\u202e${tags}\n\`\`\``)).toBe(
      'Text.\n\n```\nlet a = 1;\n```',
    );
  });

  // Regression: `/<!--[\s\S]*?-->/g` rescanned the rest of the text from every `<!--`:
  // 128 KB of them took 16 seconds, and a GitHub file may be megabytes.
  it.each(['<!--', '<div hidden>', '<a ', '<', '<!-- x -->'])(
    'is linear in a document made of %s',
    (unit) => {
      const text = unit.repeat(Math.ceil((1024 * 1024) / unit.length));
      expect(timed(() => stripUnseen(text))).toBeLessThan(5000);
    },
  );
});

describe('htmlLinksToMarkdown', () => {
  it('writes a plain HTML link as a Markdown link', () => {
    expect(
      htmlLinksToMarkdown('<a href="https://example.com/sdk/" target="_blank">View it live</a>.'),
    ).toBe('[View it live](https://example.com/sdk/).');
  });

  it('leaves code, links with markup inside and links without text alone', () => {
    const source = [
      'Use `<a href="x">y</a>` here.',
      '<a href="x"><img src="i.png"></a> <a href="y"> </a> <a name="top">anchor</a>',
      '```html',
      '<a href="x">y</a>',
      '```',
    ].join('\n');
    expect(htmlLinksToMarkdown(source)).toBe(source);
  });
});

// Regression: the README template of the Pro SDK community samples opens with
// "<!-- TODO: Write a brief abstract explaining this sample -->". The sample renderer kept
// it, so it led the body of every sample read and the summary line of every search result.
describe('renderSource and renderNotebook', () => {
  const readme = [
    '## Ribbon',
    '',
    '<!-- TODO: Write a brief abstract explaining this sample -->',
    'This sample shows every ribbon control.',
    '',
    '<a href="https://example.com/sdk/" target="_blank">View it live</a>',
    '',
    '<!-- TODO: Fill this section below with metadata about this sample-->',
    '```',
    'Language: C#',
    '```',
  ].join('\n');

  it('removes the comments of a sample README and writes its HTML links as Markdown', () => {
    const page = renderSource({ readme, files: [] }, meta);
    expect(pageText(page)).toBe(
      [
        '## Ribbon',
        '',
        'This sample shows every ribbon control.',
        '',
        '[View it live](https://example.com/sdk/)',
        '',
        '```',
        'Language: C#',
        '```',
        '',
      ].join('\n'),
    );
  });

  it('keeps a README as published when the document is verbatim', () => {
    expect(pageText(renderSource({ readme, files: [] }, meta, { verbatim: true }))).toContain(
      '<!-- TODO: Write a brief abstract',
    );
  });

  it('drops the byte order mark of a source file', () => {
    const page = renderSource(
      { files: [{ name: 'Main.cs', text: '\ufeff// Copyright\nclass Main {}', ref: README }] },
      meta,
    );
    expect(page.files?.[0]?.text).toBe('// Copyright\nclass Main {}');
  });

  it('removes comments and hidden HTML from the Markdown cells of a notebook', () => {
    const page = renderNotebook(
      {
        ipynb: {
          cells: [
            {
              cell_type: 'markdown',
              source: ['# Title\n', '<!-- note -->\n', 'Text <span hidden>x</span>here.'],
            },
          ],
        },
      },
      makeMeta({ url: 'https://github.com/example/nb/blob/main/a.ipynb', license: 'apache-2.0' }),
    );
    expect(pageText(page)).toBe('# Title\n\nText here.\n');
  });

  it('also cleans a Markdown document', () => {
    expect(pageText(renderMarkdown({ markdown: '# T\n\nA <b hidden>x</b>b.' }, meta))).toBe(
      '# T\n\nA b.\n',
    );
  });
});

describe('absolutizeLinks on hostile input', () => {
  // Regression: `](<` repeated made the angle-bracket pattern rescan the line from every
  // occurrence: 200 KB took 43 seconds.
  it.each(['](<', '](', '[a](<b', '`'])('is linear in a line made of %s', (unit) => {
    const text = unit.repeat(Math.ceil((512 * 1024) / unit.length));
    expect(timed(() => absolutizeLinks(text, README))).toBeLessThan(5000);
  });

  it('still resolves a target in angle brackets', () => {
    expect(absolutizeLinks('[a](<docs/my file.md>)', README)).toBe(
      '[a](<https://github.com/example/samples/blob/main/Framework/Ribbon/docs/my%20file.md>)',
    );
  });
});
