import { describe, expect, it } from 'vitest';
import { estimateTokens } from '../../../src/core/budget.js';
import type { MemberEntry } from '../../../src/core/types.js';
import { MAX_OUTLINE_TOKENS, renderOutline } from '../../../src/services/doc/view.js';
import { makeDocPage } from '../../support/builders.js';

const GUIDE = [
  '# Styling widgets',
  '',
  'An introduction to themes.',
  '',
  '## Colours',
  '',
  'Pick a palette.',
  '',
  '### Dark mode',
  '',
  'Invert the palette.',
  '',
  '## Typography & fonts',
  '',
  'Choose a typeface.',
  '',
  '## Parameters',
  '',
  '| Name | Type |',
  '| --- | --- |',
  '| `theme` | string |',
].join('\n');

describe('renderOutline', () => {
  it('lists ids, titles and subtree sizes, two levels deep', () => {
    const page = makeDocPage({ markdown: GUIDE });
    const outline = renderOutline(page, page.sections, 600);
    expect(outline.split('\n')).toEqual([
      'Outline (pass an id as "section" to read that part):',
      '',
      expect.stringMatching(/^- `styling-widgets` Styling widgets \(~\d+ tokens\)$/),
      expect.stringMatching(/^ {2}- `colours` Colours \(~\d+ tokens\)$/),
      expect.stringMatching(/^ {2}- `typography-fonts` Typography & fonts \(~\d+ tokens\)$/),
      expect.stringMatching(/^ {2}- `parameters` Parameters \(~\d+ tokens\)$/),
    ]);
  });

  it('reports the size of a section with its children', () => {
    const page = makeDocPage({ markdown: GUIDE });
    const sizeOf = (id: string): number =>
      Number(
        new RegExp(`\`${id}\`.*\\(~(\\d+) tokens\\)`).exec(
          renderOutline(page, page.sections, 600),
        )?.[1],
      );
    const own = (id: string): number => page.sections.find((s) => s.id === id)?.tokens ?? 0;
    expect(sizeOf('colours')).toBe(own('colours') + own('dark-mode'));
    expect(sizeOf('styling-widgets')).toBe(page.sections.reduce((sum, s) => sum + s.tokens, 0));
  });

  it('names a lead without heading', () => {
    const page = makeDocPage({ markdown: 'Lead text.\n\n## One\n\na' });
    expect(renderOutline(page, page.sections, 600)).toContain('- `_lead` Introduction (~');
  });

  it('counts the members of a member-heavy page instead of listing them', () => {
    const many: MemberEntry[] = Array.from({ length: 40 }, (_, i) => ({
      id: `m${i}`,
      name: `member${i}`,
      kind: i % 2 === 0 ? 'method' : 'property',
    }));
    const markdown = [
      '# Big',
      '',
      'Lead.',
      '',
      ...many.flatMap((m) => [`## ${m.name} {#${m.id}}`, '', 'Doc.', '']),
    ].join('\n');
    const page = makeDocPage({ markdown, kind: 'api', members: many });
    const outline = renderOutline(page, page.sections, 600);
    expect(outline).not.toContain('`m7`');
    expect(outline).toContain('Members: 20 method, 20 property.');

    // A page with a handful of members lists them like any other section.
    const few = makeDocPage({ markdown, kind: 'api', members: many.slice(0, 5) });
    expect(renderOutline(few, few.sections.slice(0, 6), 600)).toContain('`m3`');
  });

  it('stays within 600 tokens by cutting rows when one level would say nothing', () => {
    const wide = ['# Top', '', 'Lead.', ''];
    for (let i = 0; i < 120; i++) {
      wide.push(`## Section number ${i} with a fairly long heading`, '', 'Body.', '');
    }
    const page = makeDocPage({ markdown: wide.join('\n') });
    const outline = renderOutline(page, page.sections, 5000);
    expect(estimateTokens(outline)).toBeLessThanOrEqual(MAX_OUTLINE_TOKENS);
    expect(outline).toContain('`section-number-0-with-a-fairly-long-heading`');
    // Regression: the rows that did not fit were only counted ("14 more sections; ask for
    // one by its heading text"), so their ids, "Breaking changes" among them, could not be
    // asked for. They are named as far as the budget reaches, with the way to all of them.
    expect(outline).toMatch(/- \.\.\. \d+ more sections: `section-number-\d+-with/);
    expect(outline).toMatch(/and \d+ more; pass max_tokens with view "outline" for all of them$/);
  });

  it('lists every section when the caller sets the budget of the outline', () => {
    const wide = ['# Top', '', 'Lead.', ''];
    for (let i = 0; i < 120; i++) {
      wide.push(`## Section number ${i} with a fairly long heading`, '', 'Body.', '');
    }
    const page = makeDocPage({ markdown: wide.join('\n') });
    const outline = renderOutline(page, page.sections, 12_000, 12_000);
    expect(outline).toContain('`section-number-119-with-a-fairly-long-heading`');
    expect(outline).not.toContain('more sections');
  });

  it('drops to one level when the document has several top-level sections', () => {
    const deep = ['Lead.', ''];
    for (let i = 0; i < 12; i++) {
      deep.push(`## Part ${i}`, '', 'Body.', '');
      for (let j = 0; j < 8; j++) deep.push(`### Detail ${i}-${j} of this part`, '', 'Body.', '');
    }
    const page = makeDocPage({ markdown: deep.join('\n') });
    const outline = renderOutline(page, page.sections, 5000);
    expect(outline).toContain('`part-11`');
    expect(outline).not.toContain('detail-0-0');
    expect(estimateTokens(outline)).toBeLessThanOrEqual(MAX_OUTLINE_TOKENS);
  });

  it('honours a budget below the cap', () => {
    const page = makeDocPage({ markdown: GUIDE });
    const outline = renderOutline(page, page.sections, 40);
    expect(estimateTokens(outline)).toBeLessThanOrEqual(60);
    expect(outline).toContain('more sections');
  });
});
