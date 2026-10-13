import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HTML_FAMILIES } from '../../src/core/types.js';
import { measureMarkdown } from '../../src/extract/diagnostics.js';
import { fixturePath, hasFixture, readFixture } from '../support/fixtures.js';
import {
  extractFixture,
  FAMILY_CASES,
  fixtureHtml,
  pageMarkdown,
  sharedExtractor,
} from './support.js';

/**
 * One synthetic page per family, converted and compared byte for byte with its golden.
 * After an intended change of output, regenerate with
 * `UPDATE_GOLDENS=1 npx vitest run test/extract/golden.test.ts` and review the diff.
 */
const UPDATE = process.env.UPDATE_GOLDENS === '1';

describe('golden fixtures', () => {
  it('cover every page family', () => {
    expect(FAMILY_CASES.map((entry) => entry.family).sort()).toEqual([...HTML_FAMILIES].sort());
  });

  describe.each(FAMILY_CASES)('$family', ({ family }) => {
    const page = extractFixture(family);
    const markdown = pageMarkdown(page);

    it('is detected as its family', () => {
      expect(sharedExtractor().detectFamily(fixtureHtml(family))).toBe(family);
      expect(page.diagnostics.family).toBe(family);
      expect(page.diagnostics.renderer).toBe('html');
    });

    it('matches the golden byte for byte', () => {
      if (UPDATE) {
        writeFileSync(fixturePath('synthetic', 'html', family, 'page.expected.md'), markdown);
      }
      expect(hasFixture('synthetic', 'html', family, 'page.expected.md')).toBe(true);
      expect(markdown).toBe(readFixture('synthetic', 'html', family, 'page.expected.md'));
    });

    it('leaves no HTML outside code, apart from <br> in table cells', () => {
      expect(page.diagnostics.leftoverHtmlTags).toBe(0);
      expect(measureMarkdown(markdown).leftoverHtmlTags).toBe(0);
    });

    it('closes every fence and tags it with a language', () => {
      const metrics = measureMarkdown(markdown);
      expect(metrics.unclosedFence).toBe(false);
      expect(metrics.fencesWithLanguage).toBe(metrics.fences);
      expect(page.diagnostics.fencesWithLanguage).toBe(page.diagnostics.fences);
    });

    it('carries none of the known conversion defects', () => {
      expect(markdown).not.toContain('\x7f');
      expect(markdown).not.toContain('[](#');
      expect(markdown).not.toContain('react-syntax-highlighter');
      expect(markdown).not.toContain('<SPAN');
      // Private-use characters are internal markers (heading ids, cell line breaks).
      expect(markdown).not.toMatch(/[\ue000-\uf8ff]/);
      expect(markdown).not.toMatch(/\u00a0|[\u200b-\u200d\ufeff]/);
    });

    it('opens with the page title and keeps section ids unique', () => {
      expect(page.title).not.toBe('');
      expect(page.sections[0]?.level).toBe(1);
      expect(page.sections[0]?.title).toBe(page.title);
      const ids = page.sections.map((section) => section.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('is only degraded when no family profile applies', () => {
      if (family === 'generic') expect(page.degraded?.level).toBe('generic-extractor');
      else expect(page.degraded).toBeUndefined();
    });
  });
});
