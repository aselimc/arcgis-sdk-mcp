import { describe, expect, it } from 'vitest';
import { sectionSubtree } from '../../src/core/sections.js';
import type { DocPage } from '../../src/core/types.js';
import { extractHtml } from './support.js';

const ids = (page: DocPage): string[] => page.sections.map((section) => section.id);
const text = (page: DocPage): string =>
  page.sections.map((section) => section.markdown).join('\n\n');

/**
 * The layout of a generated class page: the class heading in a `<section>` of its own, the
 * member groups in sibling sections, and every member in a box whose heading sits in a
 * `<header>` next to a kind label.
 */
const member = (name: string): string =>
  `<div class="box"><header><h4 id="${name}">${name}</h4><div></div><span>Class Method</span></header>` +
  `<code>${name}(value): void</code><p>Sets ${name}.</p><pre>${name}(1);</pre><h5>Returns</h5><code>void</code></div>`;

const CLASS_PAGE =
  '<html><head><title>WebForm</title></head><body><main>' +
  '<section><h2>Class</h2><p>The web form class.</p></section>' +
  `<section><h3 id="Constructors">Constructors</h3><div>${member('constructor')}</div></section>` +
  `<section><h3 id="Methods">Methods</h3><div><div><button>Collapse</button></div>${member('setValue')}${member('setStyle')}</div></section>` +
  '<section><h2 id="events">Events</h2><p>None.</p></section>' +
  '</main></body></html>';

// Regression: a section was its heading plus the heading's following siblings. On the
// Survey123 web app API page, section "class" was 95 of 4,700 tokens and a member section
// was its heading and the words "Class Method".
describe('sections whose heading sits in a wrapper', () => {
  const full = extractHtml(CLASS_PAGE);

  it('runs a section to the next heading of the same or a higher level, across wrappers', () => {
    const sliced = extractHtml(CLASS_PAGE, { select: { section: 'class' } });
    expect(ids(sliced)).toEqual([
      'class',
      'Constructors',
      'constructor',
      'returns',
      'Methods',
      'setValue',
      'returns-1',
      'setStyle',
      'returns-2',
    ]);
    expect(text(sliced)).not.toContain('## Events');
  });

  it('returns a member with its signature, description, example and sub-headings', () => {
    const sliced = extractHtml(CLASS_PAGE, { select: { section: 'setValue' } });
    expect(text(sliced)).toBe(
      '#### setValue\n\nClass Method\n\n`setValue(value): void`\n\nSets setValue.\n\n```\nsetValue(1);\n```\n\n##### Returns\n\n`void`',
    );
  });

  it('gives every sliced section the text it has in the full page', () => {
    for (const section of full.sections.filter((entry) => entry.level > 1)) {
      const expected = sectionSubtree(full.sections, section.id);
      const sliced = extractHtml(CLASS_PAGE, { select: { section: section.id } });
      expect(text(sliced), section.id).toBe(expected.map((part) => part.markdown).join('\n\n'));
    }
  });

  it('takes what precedes the next heading inside a wrapper that also holds that heading', () => {
    const html =
      '<html><head><title>T</title></head><body><main><h2 id="a">A</h2><p>one</p>' +
      '<div><p>two</p><h2 id="b">B</h2><p>three</p></div></main></body></html>';
    expect(text(extractHtml(html, { select: { section: 'a' } }))).toBe('## A\n\none\n\ntwo');
    expect(text(extractHtml(html, { select: { section: 'b' } }))).toBe('## B\n\nthree');
  });
});
