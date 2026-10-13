import { describe, expect, it } from 'vitest';
import { estimateTokens, joinSections } from '../../../src/core/budget.js';
import { renderView } from '../../../src/services/doc/view.js';
import { makeDocPage } from '../../support/builders.js';
import { forSeeds } from '../../support/prng.js';

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

describe('renderView', () => {
  const guide = makeDocPage({ markdown: GUIDE, header: 'Product: Widgets SDK' });

  it('auto: returns a document that fits, header first', () => {
    const view = renderView({
      page: guide,
      shown: guide.sections,
      view: 'auto',
      maxTokens: 2000,
      offset: 0,
    });
    expect(view).toEqual({
      text: `Product: Widgets SDK\n\n${joinSections(guide.sections)}`,
      truncated: false,
    });
  });

  it('auto: returns the opening, the outline and a suggestion when it does not fit', () => {
    const body = (name: string, words: number) =>
      `## ${name}\n\n${`${name.toLowerCase()} `.repeat(words)}`;
    const page = makeDocPage({
      markdown: [
        '# Long guide',
        '',
        'intro '.repeat(400),
        '',
        body('Small', 50),
        '',
        body('Largest', 900),
        '',
        body('Medium', 300),
      ].join('\n'),
      header: 'HEADER',
    });
    const view = renderView({
      page,
      shown: page.sections,
      view: 'auto',
      maxTokens: 800,
      offset: 0,
    });
    expect(view.truncated).toBe(true);
    expect(view.suggest).toBe('largest');
    expect(view.nextOffset).toBeUndefined();
    expect(view.text.startsWith('HEADER\n\n# Long guide')).toBe(true);
    expect(view.text).toContain('Outline (pass an id as "section"');
    expect(view.text).not.toContain('largest largest');
    expect(estimateTokens(view.text)).toBeLessThanOrEqual(800 + 610);
  });

  it('auto: pages a document that has nothing to outline', () => {
    const page = makeDocPage({
      markdown: `# One section\n\n${Array.from({ length: 60 }, (_, i) => `Paragraph ${i} ${'x'.repeat(200)}`).join('\n\n')}`,
    });
    const view = renderView({
      page,
      shown: page.sections,
      view: 'auto',
      maxTokens: 500,
      offset: 0,
    });
    expect(view.truncated).toBe(true);
    expect(view.nextOffset).toBeGreaterThan(0);
    expect(view.suggest).toBeUndefined();
  });

  it('outline: returns the title and the outline only', () => {
    const view = renderView({
      page: guide,
      shown: guide.sections,
      view: 'outline',
      maxTokens: 6000,
      offset: 0,
    });
    expect(view.truncated).toBe(false);
    expect(view.text.startsWith('# Get started\n\nOutline')).toBe(false);
    expect(view.text.startsWith('# Styling widgets\n\nOutline')).toBe(true);
    expect(view.text).not.toContain('Pick a palette');
    expect(view.suggest).toBeDefined();
  });

  it('full: pages concatenate to the whole document, header once', () => {
    forSeeds(25, (rng) => {
      const parts: string[] = ['# Random doc', '', rng.words(20)];
      for (let s = 0; s < rng.int(2, 8); s++) {
        parts.push('', `## ${rng.words(3)}`, '', rng.words(rng.int(5, 200)));
        if (rng.chance(0.4))
          parts.push('', '```js', rng.words(rng.int(5, 80)), '', rng.words(4), '```');
        if (rng.chance(0.3))
          parts.push('', '| a | b |', '| --- | --- |', `| ${rng.words(2)} | ${rng.words(2)} |`);
      }
      const page = makeDocPage({ markdown: parts.join('\n'), header: 'HEADER' });
      const budget = rng.int(120, 400);
      const pages: string[] = [];
      let offset = 0;
      for (let guard = 0; guard < 200; guard++) {
        const view = renderView({
          page,
          shown: page.sections,
          view: 'full',
          maxTokens: budget,
          offset,
        });
        pages.push(view.text);
        if (view.nextOffset === undefined) {
          expect(view.truncated).toBe(false);
          break;
        }
        expect(view.truncated).toBe(true);
        expect(view.nextOffset).toBeGreaterThan(offset);
        offset = view.nextOffset;
      }
      expect(pages.join('\n\n')).toBe(`HEADER\n\n${joinSections(page.sections)}`);
      for (const text of pages) expect((text.match(/^```/gm) ?? []).length % 2).toBe(0);
    });
  });
});
