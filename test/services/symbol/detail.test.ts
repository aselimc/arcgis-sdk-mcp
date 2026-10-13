import { describe, expect, it } from 'vitest';
import { symbolText } from '../../../src/services/symbol/detail.js';
import { makeDocPage, makeRecord } from '../../support/builders.js';

describe('symbolText', () => {
  // Regression: an Arcade function is a record without a parent whose page is its own member
  // section, so `summary` replaced the whole documentation by a member index of one line.
  it('keeps the documentation of a page that consists of one member section', () => {
    const page = makeDocPage({
      url: 'https://developers.arcgis.com/widgets/functions/#spread',
      kind: 'api',
      markdown: [
        '# Spread',
        '',
        '```arcade',
        'Spread(input, distance) -> Shape',
        '```',
        '',
        'Widens the input by a distance.',
      ].join('\n'),
      members: [{ id: 'spread', name: 'Spread', kind: 'function', summary: 'Widens the input.' }],
    });
    const record = makeRecord({
      ref: 'https://developers.arcgis.com/widgets/functions/#spread',
      kind: 'api',
      title: 'Spread',
      symbol: 'Spread',
      qualified: 'Spread',
      symbolKind: 'function',
    });
    const { text, truncated } = symbolText(page, record, 'summary', 3000);
    expect(text).toContain('Spread(input, distance) -> Shape');
    expect(text).toContain('Widens the input by a distance.');
    expect(text).not.toContain('## Members');
    expect(truncated).toBe(false);
  });
});
