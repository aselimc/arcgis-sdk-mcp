import { describe, expect, it } from 'vitest';
import {
  content,
  fragmentsText,
  inline,
  referenceLink,
  type DoccContext,
} from '../../src/render/docc-content.js';

function makeContext(): DoccContext {
  return {
    baseUrl: 'https://developers.arcgis.com/tides-swift/api-reference',
    unknown: new Set(),
    references: {
      'doc://t/Harbour': {
        type: 'topic',
        kind: 'symbol',
        title: 'Harbour',
        url: '/documentation/tides/harbour',
      },
      'doc://t/Guide': {
        type: 'topic',
        kind: 'article',
        title: 'Guide',
        url: '/documentation/tides/guide',
      },
      'doc://t/External': { type: 'link', title: 'Primer', url: 'https://example.com/primer' },
      'doc://t/Missing': { type: 'unresolvable', title: 'Swift.Int' },
      'dial.png': {
        type: 'image',
        alt: 'A dial',
        variants: [{ url: '/images/dial.png', traits: ['1x'] }],
      },
      'remote.png': {
        type: 'image',
        alt: 'Remote',
        variants: [{ url: 'https://example.com/r.png' }],
      },
      'broken.png': { type: 'image', alt: 'No file', variants: [] },
    },
  };
}

const text = (value: string): unknown => ({ type: 'text', text: value });
const paragraph = (...nodes: unknown[]): unknown => ({ type: 'paragraph', inlineContent: nodes });

describe('docc inline content', () => {
  it('renders every inline node type of the schema', () => {
    const context = makeContext();
    const rendered = inline(
      [
        text('Plain '),
        { type: 'codeVoice', code: 'let x' },
        text(' '),
        { type: 'emphasis', inlineContent: [text('soft')] },
        text(' '),
        { type: 'strong', inlineContent: [text('loud')] },
        text(' '),
        { type: 'newTerm', inlineContent: [text('term')] },
        text(' '),
        { type: 'inlineHead', inlineContent: [text('Head')] },
        text(' '),
        { type: 'strikethrough', inlineContent: [text('gone')] },
        text(' H'),
        { type: 'subscript', inlineContent: [text('2')] },
        text('O m'),
        { type: 'superscript', inlineContent: [text('2')] },
      ],
      context,
    );
    expect(rendered).toBe('Plain `let x` _soft_ **loud** _term_ **Head** ~~gone~~ H2O m2');
    expect(context.unknown.size).toBe(0);
  });

  it('renders references, links and images', () => {
    const context = makeContext();
    expect(
      inline(
        [
          { type: 'reference', identifier: 'doc://t/Harbour' },
          text(', '),
          { type: 'reference', identifier: 'doc://t/Harbour', overridingTitle: 'a harbour' },
          text(', '),
          { type: 'link', destination: 'https://example.com', title: 'site' },
          text(', '),
          { type: 'link', destination: 'https://example.com/bare' },
          text(', '),
          { type: 'image', identifier: 'dial.png' },
          text(', '),
          { type: 'image', identifier: 'remote.png' },
          text(', '),
          { type: 'image', identifier: 'broken.png' },
        ],
        context,
      ),
    ).toBe(
      '[`Harbour`](https://developers.arcgis.com/tides-swift/api-reference/documentation/tides/harbour), ' +
        '[`a harbour`](https://developers.arcgis.com/tides-swift/api-reference/documentation/tides/harbour), ' +
        '[site](https://example.com), [https://example.com/bare](https://example.com/bare), ' +
        '![A dial](https://developers.arcgis.com/tides-swift/api-reference/images/dial.png), ' +
        '![Remote](https://example.com/r.png), No file',
    );
  });

  it('shows an unknown inline node as its text and records the type', () => {
    const context = makeContext();
    expect(
      inline(
        [
          {
            type: 'sparkle',
            inlineContent: [text('nested '), { type: 'codeVoice', code: 'code' }],
          },
          { text: ' untyped' },
        ],
        context,
      ),
    ).toBe('nested code untyped');
    expect([...context.unknown]).toEqual(['docc:sparkle', 'docc:inline']);
  });
});

describe('referenceLink', () => {
  it('styles symbols as code, articles and links as text, and names what it cannot resolve', () => {
    const context = makeContext();
    expect(referenceLink('doc://t/Guide', context)).toBe(
      '[Guide](https://developers.arcgis.com/tides-swift/api-reference/documentation/tides/guide)',
    );
    expect(referenceLink('doc://t/External', context)).toBe('[Primer](https://example.com/primer)');
    expect(referenceLink('doc://t/Missing', context)).toBe('`Swift.Int`');
    // Not in the reference map at all: the last path segment stands in.
    expect(referenceLink('doc://t/documentation/Tides/Unknown', context)).toBe('Unknown');
  });
});

describe('docc block content', () => {
  it('renders the block types the fixtures never showed', () => {
    const context = makeContext();
    const rendered = content(
      [
        { type: 'heading', level: 3, text: 'Details', anchor: 'details' },
        { type: 'heading', text: 'No level' },
        { type: 'small', inlineContent: [text('Fine print.')] },
        {
          type: 'tabNavigator',
          tabs: [
            { title: 'Swift', content: [paragraph(text('Swift text.'))] },
            { title: 'Objective-C', content: [paragraph(text('ObjC text.'))] },
          ],
        },
        {
          type: 'row',
          numberOfColumns: 2,
          columns: [
            { size: 1, content: [paragraph(text('Left.'))] },
            { size: 1, content: [paragraph(text('Right.'))] },
          ],
        },
        { type: 'links', style: 'list', items: ['doc://t/Harbour', 'doc://t/Guide'] },
        { type: 'thematicBreak' },
        { type: 'codeListing', code: ['plain'] },
        {
          type: 'unorderedList',
          items: [
            {
              content: [
                paragraph(text('Outer')),
                { type: 'unorderedList', items: [{ content: [paragraph(text('Inner'))] }] },
              ],
            },
          ],
        },
        {
          type: 'table',
          header: 'none',
          rows: [[[paragraph(text('a'))], [paragraph(text('b'))]]],
        },
        { type: 'table', rows: [] },
        { type: 'aside', style: 'tip', content: [paragraph(text('Short.'))] },
        { type: 'video', identifier: 'clip.mp4', inlineContent: [text('A clip.')] },
      ],
      context,
    );
    expect(rendered).toBe(
      [
        '### Details',
        '## No level',
        'Fine print.',
        '**Swift**',
        'Swift text.',
        '**Objective-C**',
        'ObjC text.',
        'Left.',
        'Right.',
        '- [`Harbour`](https://developers.arcgis.com/tides-swift/api-reference/documentation/tides/harbour)\n- [Guide](https://developers.arcgis.com/tides-swift/api-reference/documentation/tides/guide)',
        '---',
        '```\nplain\n```',
        '- Outer\n\n  - Inner',
        '|  |  |\n| --- | --- |\n| a | b |',
        '> **Tip:** Short.',
        'A clip.',
      ].join('\n\n'),
    );
    expect([...context.unknown]).toEqual(['docc:video']);
  });
});

describe('fragmentsText', () => {
  it('joins token texts and ignores malformed tokens', () => {
    expect(
      fragmentsText([
        { kind: 'keyword', text: 'var' },
        { kind: 'text', text: ' ' },
        { kind: 'identifier' },
        'x',
        { text: 'level' },
      ]),
    ).toBe('var level');
    expect(fragmentsText(undefined)).toBe('');
  });
});
