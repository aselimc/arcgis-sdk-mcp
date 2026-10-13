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

  // Regression: an overloaded function is a bare title followed by one section per overload.
  // The title alone counted as the type's own documentation, so `summary` answered with a
  // list of identical names and no signature.
  it('keeps the overloads of a page whose only own text is its title', () => {
    const page = makeDocPage({
      url: 'https://developers.arcgis.com/widgets/functions/#gap',
      kind: 'api',
      sections: [
        { id: 'gap', level: 1, title: 'Gap', markdown: '# Gap', tokens: 2 },
        {
          id: 'gap-1',
          level: 2,
          title: 'Gap(a, b) -> Number',
          parent: 'gap',
          markdown: '## `Gap(a, b) -> Number`\n\nMeasures the gap between two berths.',
          tokens: 14,
        },
        {
          id: 'gap-2',
          level: 2,
          title: 'Gap(a, b, units) -> Number',
          parent: 'gap',
          markdown: '## `Gap(a, b, units) -> Number`\n\nMeasures the gap in the given units.',
          tokens: 16,
        },
      ],
      members: [
        { id: 'gap-1', name: 'Gap', kind: 'function', summary: 'Measures the gap.' },
        { id: 'gap-2', name: 'Gap', kind: 'function', summary: 'Measures the gap in units.' },
      ],
    });
    const record = makeRecord({
      ref: 'https://developers.arcgis.com/widgets/functions/#gap',
      kind: 'api',
      title: 'Gap',
      symbol: 'Gap',
      qualified: 'Gap',
      symbolKind: 'function',
    });
    const { text } = symbolText(page, record, 'summary', 3000);
    expect(text).toContain('Gap(a, b) -> Number');
    expect(text).toContain('Gap(a, b, units) -> Number');
    expect(text).toContain('Measures the gap in the given units.');
    expect(text).not.toContain('## Members');
  });

  it('still summarises a type that has documentation of its own as a member index', () => {
    const page = makeDocPage({
      url: 'https://developers.arcgis.com/widgets/api/TideLayer/',
      kind: 'api',
      sections: [
        {
          id: 'tidelayer',
          level: 1,
          title: 'TideLayer',
          markdown: '# TideLayer\n\nA layer of tide gauges.',
          tokens: 9,
        },
        {
          id: 'refresh',
          level: 3,
          title: 'refresh',
          parent: 'tidelayer',
          markdown: '### refresh\n\nReloads every gauge from the service.',
          tokens: 11,
        },
      ],
      members: [{ id: 'refresh', name: 'refresh', kind: 'method', summary: 'Reloads gauges.' }],
    });
    const record = makeRecord({
      ref: 'https://developers.arcgis.com/widgets/api/TideLayer/',
      kind: 'api',
      title: 'TideLayer',
      symbol: 'TideLayer',
      qualified: 'TideLayer',
      symbolKind: 'class',
    });
    const { text } = symbolText(page, record, 'summary', 3000);
    expect(text).toContain('A layer of tide gauges.');
    expect(text).toContain('## Members');
    expect(text).toContain('`refresh` (method): Reloads gauges.');
    expect(text).not.toContain('Reloads every gauge from the service.');
  });
});
