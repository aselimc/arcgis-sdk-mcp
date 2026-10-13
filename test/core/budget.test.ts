import { describe, expect, it } from 'vitest';
import {
  estimateTokens,
  fitSections,
  formatCall,
  joinSections,
  splitBlocks,
  truncationNext,
} from '../../src/core/budget.js';
import { sectionsFromMarkdown } from '../../src/core/sections.js';
import type { DocSection } from '../../src/core/types.js';
import { forSeeds, type Prng } from '../support/prng.js';

const FENCE = '```';

/** Pages through a document the way a `view: "full"` read does. */
function paginate(sections: readonly DocSection[], maxTokens: number): string[] {
  const pages: string[] = [];
  let offset: number | undefined = 0;
  while (offset !== undefined) {
    const page = fitSections(sections, maxTokens, offset);
    if (page.nextOffset !== undefined) expect(page.nextOffset).toBeGreaterThan(offset);
    pages.push(page.text);
    offset = page.nextOffset;
    expect(pages.length, 'pagination terminates').toBeLessThan(10_000);
  }
  return pages;
}

function fenceLines(text: string): number {
  return text.split('\n').filter((line) => /^ {0,3}(`{3,}|~{3,})/.test(line)).length;
}

/**
 * A random document made of headings, paragraphs, lists, fences (with blank lines) and
 * tables. `atomic` lists the fences and tables exactly as generated: the blocks a page break
 * must never fall inside.
 */
function randomDocument(rng: Prng): { markdown: string; atomic: string[] } {
  const blocks: string[] = [];
  const atomic: string[] = [];
  const pushAtomic = (block: string): void => {
    blocks.push(block);
    atomic.push(block);
  };
  if (rng.chance(0.4)) blocks.push(rng.words(rng.int(3, 30)));
  const count = rng.int(1, 40);
  for (let i = 0; i < count; i++) {
    const kind = rng.int(0, 9);
    if (kind === 0) blocks.push(`${'#'.repeat(rng.int(1, 4))} ${rng.words(rng.int(1, 5))}`);
    else if (kind <= 2) {
      const lines = Array.from({ length: rng.int(1, 25) }, () =>
        rng.chance(0.2) ? '' : `${' '.repeat(rng.int(0, 4))}${rng.words(rng.int(1, 8))};`,
      );
      // Headings and table rows inside a fence are code and must stay inside it.
      if (rng.chance(0.3)) lines.push('# not a heading', '| not | a table |');
      const marker = rng.chance(0.2) ? '~~~' : FENCE;
      pushAtomic(
        [`${marker}${rng.pick(['ts', 'python', 'json', ''])}`, ...lines, marker].join('\n'),
      );
    } else if (kind === 3) {
      const rows = Array.from(
        { length: rng.int(1, 12) },
        () => `| ${rng.words(rng.int(1, 3))} | ${rng.words(rng.int(1, 6))} |`,
      );
      pushAtomic(['| Name | Description |', '| --- | --- |', ...rows].join('\n'));
    } else if (kind === 4) {
      blocks.push(
        Array.from({ length: rng.int(1, 8) }, () => `- ${rng.words(rng.int(1, 9))}`).join('\n'),
      );
    } else blocks.push(rng.words(rng.int(3, 120)));
  }
  return { markdown: blocks.join(rng.chance(0.2) ? '\n\n\n' : '\n\n'), atomic };
}

describe('estimateTokens', () => {
  it('is ceil(chars / 4) for prose', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a')).toBe(1);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('x'.repeat(4000))).toBe(1000);
  });

  it('is ceil(chars / 3.5) when more than half of the text is inside code fences', () => {
    const code = `${FENCE}ts\n${'const a = 1;\n'.repeat(20)}${FENCE}`;
    expect(estimateTokens(code)).toBe(Math.ceil(code.length / 3.5));
    const mostlyCode = `Short intro.\n\n${code}`;
    expect(estimateTokens(mostlyCode)).toBe(Math.ceil(mostlyCode.length / 3.5));
  });

  it('stays at chars / 4 when code is half of the text or less', () => {
    const code = `${FENCE}\nconst a = 1;\n${FENCE}`;
    const mostlyProse = `${'word '.repeat(40)}\n\n${code}`;
    expect(estimateTokens(mostlyProse)).toBe(Math.ceil(mostlyProse.length / 4));
  });

  it('counts an unclosed fence to the end of the text', () => {
    const text = `${FENCE}js\n${'x();\n'.repeat(30)}`;
    expect(estimateTokens(text)).toBe(Math.ceil(text.length / 3.5));
  });
});

describe('splitBlocks', () => {
  it('splits on blank lines and keeps fences with blank lines whole', () => {
    const md = `Para one\nstill one\n\n\n${FENCE}js\na();\n\nb();\n${FENCE}\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nLast`;
    expect(splitBlocks(md)).toEqual([
      'Para one\nstill one',
      `${FENCE}js\na();\n\nb();\n${FENCE}`,
      '| a | b |\n| - | - |\n| 1 | 2 |',
      'Last',
    ]);
  });

  it('keeps an unclosed fence as one block and preserves hard line breaks', () => {
    expect(splitBlocks(`Intro\n\n${FENCE}\ncode\n\nmore code`)).toEqual([
      'Intro',
      `${FENCE}\ncode\n\nmore code`,
    ]);
    expect(splitBlocks('line one  \nline two')).toEqual(['line one  \nline two']);
  });

  it('normalises CRLF and gives [] for blank input', () => {
    expect(splitBlocks('a\r\n\r\nb')).toEqual(['a', 'b']);
    expect(splitBlocks('')).toEqual([]);
    expect(splitBlocks(' \n\t\n')).toEqual([]);
  });
});

describe('fitSections', () => {
  const sections = sectionsFromMarkdown(
    [
      '# Title',
      'Lead paragraph.',
      '',
      '## Install',
      'Run the installer.',
      '',
      `${FENCE}bash`,
      'npm install @example/widgets',
      '',
      'npm test',
      FENCE,
      '',
      '## Options',
      '| Option | Default |',
      '| --- | --- |',
      '| size | medium |',
      '',
      'Closing paragraph.',
    ].join('\n'),
  );

  it('returns everything when it fits', () => {
    const page = fitSections(sections, 10_000);
    expect(page.text).toBe(joinSections(sections));
    expect(page.used).toBe(estimateTokens(page.text));
    expect(page.nextOffset).toBeUndefined();
    expect(page.cutInside).toBeUndefined();
  });

  it('cuts between blocks, reports where to continue and which section was cut', () => {
    const first = fitSections(sections, 12);
    expect(first.text).toBe('# Title\nLead paragraph.');
    expect(first.nextOffset).toBe(first.text.length + 2);
    // The cut falls on a section boundary.
    expect(first.cutInside).toBeUndefined();

    const second = fitSections(sections, 12, first.nextOffset);
    expect(second.text).toBe('## Install\nRun the installer.');
    expect(second.cutInside).toBe('install');
    expect(second.used).toBeLessThanOrEqual(12);
  });

  it('returns a block larger than the budget whole rather than splitting it', () => {
    const start = joinSections(sections).indexOf(FENCE);
    const page = fitSections(sections, 1, start);
    expect(page.text).toBe(`${FENCE}bash\nnpm install @example/widgets\n\nnpm test\n${FENCE}`);
    expect(page.used).toBeGreaterThan(1);
  });

  it('moves an offset inside a block forward to the next boundary', () => {
    const start = joinSections(sections).indexOf(FENCE);
    const page = fitSections(sections, 10_000, start + 5);
    expect(page.text.startsWith('## Options')).toBe(true);
  });

  it('gives an empty page at or past the end, and for no sections', () => {
    const total = joinSections(sections).length;
    expect(fitSections(sections, 100, total)).toEqual({ text: '', used: 0 });
    expect(fitSections(sections, 100, total + 1000)).toEqual({ text: '', used: 0 });
    expect(fitSections([], 100)).toEqual({ text: '', used: 0 });
  });

  it('does not strand a heading at the end of a page', () => {
    const doc = sectionsFromMarkdown(`Intro text here.\n\n## Details\n\n${'word '.repeat(60)}`);
    // Budget fits the intro and the heading, but not the paragraph under the heading.
    const first = fitSections(doc, 8);
    expect(first.text).toBe('Intro text here.');
    const second = fitSections(doc, 8, first.nextOffset);
    expect(second.text.startsWith('## Details\n\nword')).toBe(true);
  });

  it('keeps a heading-only page when the heading is all that fits', () => {
    const doc = sectionsFromMarkdown(`## Details\n\n${'word '.repeat(60)}`);
    const first = fitSections(doc, 3);
    expect(first.text).toBe('## Details');
    expect(first.cutInside).toBe('details');
  });

  describe('properties', () => {
    it('pages concatenate to the full text', () => {
      forSeeds(150, (rng) => {
        const sections = sectionsFromMarkdown(randomDocument(rng).markdown);
        const pages = paginate(sections, rng.int(1, 400));
        expect(pages.join('\n\n')).toBe(joinSections(sections));
      });
    });

    it('never splits a code fence or a table', () => {
      forSeeds(200, (rng) => {
        const { markdown, atomic } = randomDocument(rng);
        const pages = paginate(sectionsFromMarkdown(markdown), rng.int(1, 200));
        for (const page of pages) expect(fenceLines(page) % 2, page).toBe(0);
        // Every fence and table is found whole inside one page.
        for (const block of atomic) {
          expect(
            pages.some((page) => page.includes(block)),
            block,
          ).toBe(true);
        }
      });
    });

    it('stays within the budget unless a single block is larger than it', () => {
      forSeeds(150, (rng) => {
        const sections = sectionsFromMarkdown(randomDocument(rng).markdown);
        const maxTokens = rng.int(1, 300);
        let offset: number | undefined = 0;
        while (offset !== undefined) {
          const page = fitSections(sections, maxTokens, offset);
          expect(page.used).toBe(estimateTokens(page.text));
          if (page.used > maxTokens) expect(splitBlocks(page.text)).toHaveLength(1);
          offset = page.nextOffset;
        }
      });
    });

    it('fills pages greedily: the next block would not have fitted', () => {
      forSeeds(100, (rng) => {
        const sections = sectionsFromMarkdown(randomDocument(rng).markdown);
        const maxTokens = rng.int(20, 300);
        const full = joinSections(sections);
        let offset: number | undefined = 0;
        while (offset !== undefined) {
          const page = fitSections(sections, maxTokens, offset);
          if (page.nextOffset !== undefined) {
            const nextBlock = splitBlocks(full.slice(page.nextOffset))[0] ?? '';
            const withNext = `${page.text}\n\n${nextBlock}`;
            const headingHeldBack = /^ {0,3}#{1,6} /.test(nextBlock);
            if (!headingHeldBack) expect(estimateTokens(withNext)).toBeGreaterThan(maxTokens);
          }
          offset = page.nextOffset;
        }
      });
    });

    it('reports cutInside exactly when the next page continues a section', () => {
      forSeeds(100, (rng) => {
        const sections = sectionsFromMarkdown(randomDocument(rng).markdown);
        const starts = new Map<number, string>();
        let position = 0;
        for (const section of sections) {
          starts.set(position, section.id);
          position += splitBlocks(section.markdown).join('\n\n').length + 2;
        }
        let offset: number | undefined = 0;
        while (offset !== undefined) {
          const page = fitSections(sections, rng.int(1, 200), offset);
          if (page.nextOffset !== undefined) {
            expect(page.cutInside === undefined).toBe(starts.has(page.nextOffset));
          } else expect(page.cutInside).toBeUndefined();
          offset = page.nextOffset;
        }
      });
    });
  });
});

describe('formatCall and truncationNext', () => {
  it('formats a complete, copyable call', () => {
    expect(formatCall('arcgis_docs_read', { ref: 'https://h.example/a', section: 'usage' })).toBe(
      'arcgis_docs_read({"ref":"https://h.example/a","section":"usage"})',
    );
    expect(formatCall('arcgis_docs_list_products', {})).toBe('arcgis_docs_list_products({})');
  });

  it('omits undefined arguments and escapes quotes', () => {
    expect(formatCall('arcgis_docs_search', { query: 'say "hi"', product: undefined })).toBe(
      'arcgis_docs_search({"query":"say \\"hi\\""})',
    );
  });

  it('prefixes the truncation line with Next:', () => {
    const line = truncationNext('arcgis_docs_read', { ref: 'https://h.example/a', cursor: 'abc' });
    expect(line).toBe('Next: arcgis_docs_read({"ref":"https://h.example/a","cursor":"abc"})');
    expect(JSON.parse(line.slice(line.indexOf('(') + 1, -1))).toEqual({
      ref: 'https://h.example/a',
      cursor: 'abc',
    });
  });
});
