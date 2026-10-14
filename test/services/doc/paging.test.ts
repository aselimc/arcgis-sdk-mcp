import { describe, expect, it } from 'vitest';

import {
  estimateTokens,
  fitSections,
  joinSections,
  splitBlocks,
} from '../../../src/core/budget.js';
import type { DocSection } from '../../../src/core/types.js';
import { CHUNK_CHARS, chunkFences, mergeChunks } from '../../../src/services/doc/paging.js';

function section(markdown: string): DocSection {
  return { id: 'body', level: 2, title: 'Body', markdown, tokens: estimateTokens(markdown) };
}

/** Every page of `sections` at `maxTokens`, as a reader sees it. */
function pagesOf(sections: readonly DocSection[], maxTokens: number): string[] {
  const pages: string[] = [];
  let offset: number | undefined = 0;
  while (offset !== undefined) {
    const fit = fitSections(sections, maxTokens, offset);
    pages.push(mergeChunks(fit.text));
    offset = fit.nextOffset;
  }
  return pages;
}

const LIST = Array.from({ length: 400 }, (_, i) => `- Item ${i}: ${'change '.repeat(8)}`).join(
  '\n',
);
const TABLE = [
  '| Name | Description |',
  '| --- | --- |',
  ...Array.from({ length: 300 }, (_, i) => `| row${i} | ${'text '.repeat(6)}|`),
].join('\n');
const FENCE = [
  '```swift',
  ...Array.from({ length: 500 }, (_, i) => `let x${i} = ${i}`),
  '```',
].join('\n');
const HTML = [
  '<table><tr><th>TypeID</th><th>FilterFlags</th></tr>',
  '',
  ...Array.from({ length: 300 }, (_, i) => `<tr><td>id_${i}</td><td>flag</td></tr>`),
  '</table>',
].join('\n');

describe('chunkFences', () => {
  it.each([
    ['a long list', LIST],
    ['a long Markdown table', TABLE],
    ['a long code fence', FENCE],
    ['a long HTML table', HTML],
    ['a single very long line', `Text ${'word '.repeat(2000)}end`],
  ])('divides %s into pieces that reassemble exactly on one page', (_, markdown) => {
    const sections = [section(markdown)];
    const chunked = chunkFences(sections);
    expect(splitBlocks(chunked[0]?.markdown ?? '').length).toBeGreaterThan(1);
    expect(mergeChunks(joinSections(chunked))).toBe(joinSections(sections));
    // Dividing again changes nothing.
    expect(chunkFences(chunked)).toEqual(chunked);
  });

  it.each([
    ['a long list', LIST],
    ['a long Markdown table', TABLE],
    ['a long code fence', FENCE],
    ['a long HTML table', HTML],
  ])('keeps every page of %s within max_tokens', (_, markdown) => {
    const pages = pagesOf(chunkFences([section(markdown)]), 500);
    expect(pages.length).toBeGreaterThan(3);
    for (const page of pages) expect(estimateTokens(page)).toBeLessThanOrEqual(500);
  });

  it('reopens a fence and repeats a table header on the next page', () => {
    for (const page of pagesOf(chunkFences([section(FENCE)]), 500)) {
      expect(page.startsWith('```swift\n')).toBe(true);
      expect(page.endsWith('\n```')).toBe(true);
    }
    for (const page of pagesOf(chunkFences([section(TABLE)]), 500)) {
      expect(page.startsWith('| Name | Description |\n| --- | --- |\n')).toBe(true);
    }
    for (const page of pagesOf(chunkFences([section(HTML)]), 500)) {
      expect(page.startsWith('<table><tr><th>TypeID</th><th>FilterFlags</th></tr>')).toBe(true);
      expect(page.endsWith('</table>')).toBe(true);
    }
  });

  it('repeats an HTML header row written on lines of its own', () => {
    const table = [
      '<table class="tg">',
      '<tr>',
      '<th>TypeID</th>',
      '</tr>',
      '',
      ...Array.from({ length: 300 }, (_, i) => `<tr><td>id_${i}</td></tr>`),
      '</table>',
    ].join('\n');
    const pages = pagesOf(chunkFences([section(table)]), 500);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      expect(page.startsWith('<table class="tg">\n<tr>\n<th>TypeID</th>\n</tr>')).toBe(true);
    }
  });

  it('loses no line of a list across pages', () => {
    const text = pagesOf(chunkFences([section(LIST)]), 500).join('\n');
    expect(text.split('\n').filter((line) => line.startsWith('- Item'))).toHaveLength(400);
  });

  it('leaves blocks of up to CHUNK_CHARS alone', () => {
    const small = section('x'.repeat(CHUNK_CHARS));
    expect(chunkFences([small])).toEqual([small]);
  });
});

describe('splitBlocks with raw HTML', () => {
  it('keeps an HTML table with blank lines between rows in one block', () => {
    expect(splitBlocks(`Intro\n\n${HTML}\n\nAfter`)).toHaveLength(3);
  });

  it('does not treat prose that names <table> as a table', () => {
    expect(splitBlocks('Use the `<table>` element.\n\nNext paragraph.')).toHaveLength(2);
  });
});
