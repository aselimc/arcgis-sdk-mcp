import { describe, expect, it } from 'vitest';
import { estimateTokens } from '../../src/core/budget.js';
import {
  LEAD_SECTION_ID,
  outlineOf,
  sectionSubtree,
  sectionsFromMarkdown,
} from '../../src/core/sections.js';

const DOC = [
  'Intro paragraph before any heading.',
  '',
  '# Widgets',
  '',
  'Overview text.',
  '',
  '## Install',
  '',
  '```bash',
  '# not a heading',
  'npm install @example/widgets',
  '```',
  '',
  '### Requirements',
  '',
  'Node 22.',
  '',
  '## Usage',
  '',
  'Call `create()`.',
  '',
  '# Reference',
  '',
  'Tables follow.',
].join('\n');

describe('sectionsFromMarkdown', () => {
  it('splits at ATX headings into flat sections in document order', () => {
    const sections = sectionsFromMarkdown(DOC);
    expect(sections.map(({ id, level, title, parent }) => ({ id, level, title, parent }))).toEqual([
      { id: LEAD_SECTION_ID, level: 0, title: '', parent: undefined },
      { id: 'widgets', level: 1, title: 'Widgets', parent: undefined },
      { id: 'install', level: 2, title: 'Install', parent: 'widgets' },
      { id: 'requirements', level: 3, title: 'Requirements', parent: 'install' },
      { id: 'usage', level: 2, title: 'Usage', parent: 'widgets' },
      { id: 'reference', level: 1, title: 'Reference', parent: undefined },
    ]);
  });

  it('keeps each heading line in its own section and ignores headings inside fences', () => {
    const sections = sectionsFromMarkdown(DOC);
    const install = sections.find((section) => section.id === 'install');
    expect(install?.markdown).toBe(
      '## Install\n\n```bash\n# not a heading\nnpm install @example/widgets\n```',
    );
    expect(sections[0]?.markdown).toBe('Intro paragraph before any heading.');
  });

  it('reassembles into the document when sections are joined with a blank line', () => {
    expect(
      sectionsFromMarkdown(DOC)
        .map((section) => section.markdown)
        .join('\n\n'),
    ).toBe(DOC);
  });

  it('estimates tokens of each section’s own text', () => {
    for (const section of sectionsFromMarkdown(DOC)) {
      expect(section.tokens).toBe(estimateTokens(section.markdown));
      expect(section.tokens).toBeGreaterThan(0);
    }
  });

  it('omits the parent key on top-level sections', () => {
    const [lead, top] = sectionsFromMarkdown(DOC);
    expect(lead !== undefined && 'parent' in lead).toBe(false);
    expect(top !== undefined && 'parent' in top).toBe(false);
  });

  it('has no lead section when the document starts with a heading or blank lines', () => {
    expect(sectionsFromMarkdown('# Title\n\nBody').map((section) => section.id)).toEqual(['title']);
    expect(sectionsFromMarkdown('\n\n  \n# Title').map((section) => section.id)).toEqual(['title']);
  });

  it('numbers repeated ids in document order', () => {
    const md = '## Parameters\n\na\n\n## Returns\n\nb\n\n## Parameters\n\nc\n\n## Parameters\n\nd';
    expect(sectionsFromMarkdown(md).map((section) => section.id)).toEqual([
      'parameters',
      'returns',
      'parameters-1',
      'parameters-2',
    ]);
  });

  it('strips inline Markdown from titles and honours explicit ids', () => {
    const md = [
      '## The `queryFeatures()` **method** ##',
      '## [Linked *title*](https://example.com/x) ![icon](i.png)',
      '## Custom anchor {#my-anchor}',
      '## <a id="x"></a>Escaped \\*star\\* __strong__ ~~gone~~',
    ].join('\n\n');
    expect(sectionsFromMarkdown(md).map(({ id, title }) => ({ id, title }))).toEqual([
      { id: 'the-queryfeatures-method', title: 'The queryFeatures() method' },
      { id: 'linked-title-icon', title: 'Linked title icon' },
      { id: 'my-anchor', title: 'Custom anchor' },
      { id: 'escaped-star-strong-gone', title: 'Escaped *star* strong gone' },
    ]);
  });

  it('requires a space after the hashes and at most three spaces of indent', () => {
    const md = '#NotAHeading\n\n    # indented code\n\n   # Real heading\n\n####### seven hashes';
    const sections = sectionsFromMarkdown(md);
    expect(sections.map((section) => section.id)).toEqual([LEAD_SECTION_ID, 'real-heading']);
  });

  it('treats an unclosed fence as running to the end', () => {
    const sections = sectionsFromMarkdown('# A\n\n```js\n# still code\n## also code');
    expect(sections).toHaveLength(1);
    expect(sections[0]?.markdown).toContain('## also code');
  });

  it('distinguishes tilde and backtick fences and longer closing fences', () => {
    const md = '# A\n\n~~~\n```\n# code\n~~~\n\n# B\n\n````\n```\n# code\n`````\n\n# C';
    expect(sectionsFromMarkdown(md).map((section) => section.id)).toEqual(['a', 'b', 'c']);
  });

  it('normalises CRLF and a byte-order mark', () => {
    const sections = sectionsFromMarkdown('\uFEFF# Title\r\n\r\nBody\r\n\r\n## Next\r\nMore\r');
    expect(sections.map((section) => section.markdown)).toEqual([
      '# Title\n\nBody',
      '## Next\nMore',
    ]);
  });

  it('gives a heading without text the fallback id and [] for empty input', () => {
    expect(sectionsFromMarkdown('## ???\n\ntext')[0]).toMatchObject({
      id: 'section',
      title: '???',
    });
    expect(sectionsFromMarkdown('')).toEqual([]);
    expect(sectionsFromMarkdown('  \n\n')).toEqual([]);
  });

  it('resets ancestry when a shallower heading follows a deeper one', () => {
    const md = '### Deep\n\n# Top\n\n#### Under top\n\n## Sibling';
    expect(sectionsFromMarkdown(md).map(({ id, parent }) => [id, parent])).toEqual([
      ['deep', undefined],
      ['top', undefined],
      ['under-top', 'top'],
      ['sibling', 'top'],
    ]);
  });
});

describe('sectionSubtree', () => {
  const sections = sectionsFromMarkdown(DOC);

  it('returns a section with all of its descendants', () => {
    expect(sectionSubtree(sections, 'widgets').map((section) => section.id)).toEqual([
      'widgets',
      'install',
      'requirements',
      'usage',
    ]);
    expect(sectionSubtree(sections, 'install').map((section) => section.id)).toEqual([
      'install',
      'requirements',
    ]);
    expect(sectionSubtree(sections, 'reference').map((section) => section.id)).toEqual([
      'reference',
    ]);
  });

  it('gives the lead alone and nothing for an unknown id', () => {
    expect(sectionSubtree(sections, LEAD_SECTION_ID).map((section) => section.id)).toEqual([
      LEAD_SECTION_ID,
    ]);
    expect(sectionSubtree(sections, 'missing')).toEqual([]);
  });
});

describe('outlineOf', () => {
  const sections = sectionsFromMarkdown(DOC);
  const tokens = (id: string): number => sections.find((section) => section.id === id)?.tokens ?? 0;

  it('lists every section with the token size of its subtree', () => {
    const outline = outlineOf(sections);
    expect(outline.map((entry) => entry.id)).toEqual(sections.map((section) => section.id));
    expect(outline.find((entry) => entry.id === 'widgets')?.tokens).toBe(
      tokens('widgets') + tokens('install') + tokens('requirements') + tokens('usage'),
    );
    expect(outline.find((entry) => entry.id === 'requirements')).toEqual({
      id: 'requirements',
      title: 'Requirements',
      level: 3,
      tokens: tokens('requirements'),
    });
  });

  it('limits depth relative to the shallowest heading and always keeps the lead', () => {
    expect(outlineOf(sections, 1).map((entry) => entry.id)).toEqual([
      LEAD_SECTION_ID,
      'widgets',
      'reference',
    ]);
    expect(outlineOf(sections, 2).map((entry) => entry.id)).toEqual([
      LEAD_SECTION_ID,
      'widgets',
      'install',
      'usage',
      'reference',
    ]);
    const deepOnly = sectionsFromMarkdown('### A\n\n#### B\n\n##### C');
    expect(outlineOf(deepOnly, 2).map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('gives [] for no sections', () => {
    expect(outlineOf([])).toEqual([]);
  });
});
