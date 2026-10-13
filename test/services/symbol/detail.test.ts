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

// Regression: a C# method of the Pro SDK is read as the overload its record names plus its
// other overloads. The service then looked the member up by name on that page, found the
// first overload in the member list, which had no section there, and answered with a
// one-line stub of the wrong overload.
describe('symbolText: a page its adapter cut to the overloads of one member', () => {
  const ASYNC = 'M:Example.Queue.Dock.Run``1(System.Func{``0})';
  const PLAIN = 'M:Example.Queue.Dock.Run(System.Action)';
  const page = makeDocPage({
    url: `https://github.com/example/queue/blob/main/Example.Queue.xml#${ASYNC}`,
    kind: 'api',
    sections: [
      {
        id: ASYNC,
        level: 3,
        title: 'Run<TResult>',
        markdown: '### `Run<TResult>`\n\n```csharp\nDock.Run<TResult>(Func<TResult> job)\n```',
        tokens: 20,
      },
      {
        id: PLAIN,
        level: 3,
        title: 'Run',
        markdown: '### Run\n\n```csharp\nDock.Run(Action job)\n```',
        tokens: 14,
      },
    ],
    members: [
      { id: PLAIN, name: 'Run', kind: 'method', signature: 'Dock.Run(Action)' },
      { id: ASYNC, name: 'Run<TResult>', kind: 'method', signature: 'Dock.Run<TResult>(...)' },
    ],
  });
  const record = makeRecord({
    ref: `https://github.com/example/queue/blob/main/Example.Queue.xml#${ASYNC}`,
    kind: 'api',
    title: 'Run',
    symbol: 'Run',
    qualified: 'Example.Queue.Dock.Run',
    parent: 'Example.Queue.Dock',
    symbolKind: 'method',
  });

  it.each(['summary', 'full'] as const)('shows every overload at detail %s', (detail) => {
    const { text, truncated } = symbolText(page, record, detail, 3000);
    expect(text).toContain('Dock.Run<TResult>(Func<TResult> job)');
    expect(text).toContain('Dock.Run(Action job)');
    expect(text).not.toContain('```text');
    expect(truncated).toBe(false);
  });
});
