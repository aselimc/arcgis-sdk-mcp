import { describe, expect, it } from 'vitest';
import { renderCem } from '../../src/render/cem.js';
import { readJsonFixture } from '../support/fixtures.js';
import { expectGolden, makeMeta, pageText, sectionIds, structured, thrownBy } from './helpers.js';

const manifest = readJsonFixture(...structured('cem', 'api.json'));
const packageName = '@example/harbour-components';
const meta = makeMeta({
  url: 'https://developers.arcgis.com/tides-js/references/harbour-components/components/harbour-gauge/',
  license: 'esri-ma',
  packageName,
  version: '1.5.0',
});
const input = { manifest, tag: 'harbour-gauge', packageName };

describe('renderCem: component', () => {
  const page = renderCem(input, meta);

  it('matches the golden file', () => {
    expectGolden(page, ...structured('cem', 'component.expected.md'));
  });

  it('puts identity and the import line in the header', () => {
    expect(page.title).toBe('harbour-gauge');
    expect(page.header).toBe(
      '_Web component_ · class `HarbourGauge` · package `@example/harbour-components`\n\n```js\nimport "@example/harbour-components/components/harbour-gauge";\n```',
    );
    expect(page.attribution).toContain('@example/harbour-components 1.5.0');
  });

  it('gives properties, methods and events their published anchors', () => {
    expect(page.members?.map((member) => `${member.kind}:${member.id}`)).toEqual([
      'property:harbour',
      'property:scale',
      'property:reading',
      'property:legacyMode',
      'method:refresh',
      'method:setRange',
      'method:componentOnReady',
      'event:event-harbourReadingChange',
      'event:event-harbourReady',
      'slot:slot-default',
      'slot:slot-label',
    ]);
    for (const member of page.members ?? []) {
      expect(sectionIds(page)).toContain(member.id);
    }
  });

  it('keeps headings of the description below the title, as sections of their own', () => {
    expect(sectionIds(page).slice(0, 3)).toEqual([
      'harbour-gauge',
      'placing-the-gauge',
      'properties',
    ]);
    const placing = page.sections.find((section) => section.id === 'placing-the-gauge');
    expect(placing).toMatchObject({ level: 2, parent: 'harbour-gauge' });
  });

  // Regression: the member index of `arcgis-map` listed properties, methods and events but
  // not its ten slots, which are what a caller needs to place child components.
  it('makes slots members, so that they are indexed and can be looked up by name', () => {
    expect(pageText(page)).toContain(
      '## Slots\n\n### default\n\nContent shown under the dial.\n\n### label\n\nReplaces the built-in label.',
    );
    expect(page.members?.filter((member) => member.kind === 'slot')).toEqual([
      {
        id: 'slot-default',
        name: 'default',
        kind: 'slot',
        summary: 'Content shown under the dial.',
      },
      { id: 'slot-label', name: 'label', kind: 'slot', summary: 'Replaces the built-in label.' },
    ]);
    expect(
      renderCem({ ...input, member: 'label' }, meta).sections.map((section) => section.markdown),
    ).toEqual(['### label\n\nReplaces the built-in label.']);
    expect(pageText(renderCem(input, meta, { detail: 'summary' }))).toContain(
      '## Slots\n\n- `default`: Content shown under the dial.\n- `label`: Replaces the built-in label.',
    );
  });

  it('lists CSS custom properties without making them members', () => {
    expect(pageText(page)).toContain(
      '## CSS custom properties\n\n- `--harbour-gauge-needle-color`: Colour of the needle.',
    );
    expect(page.members?.some((member) => member.name.startsWith('--'))).toBe(false);
  });

  it('omits private fields and the runtime pseudo base class', () => {
    expect(pageText(page)).not.toContain('internalTimer');
    expect(
      page.members?.find((member) => member.name === 'componentOnReady')?.inheritedFrom,
    ).toBeUndefined();
  });

  it('shows defaults, attributes, deprecation and built signatures', () => {
    const section = (id: string): string =>
      page.sections.find((item) => item.id === id)?.markdown ?? '';
    expect(section('scale')).toContain(
      '```ts\nscale: "s" | "m" | "l" = "m"\n```\n\n_attribute `scale`_',
    );
    expect(section('harbour')).toContain('_attribute `harbour` · reflects_');
    expect(section('reading')).toContain('_readonly_');
    expect(section('legacyMode')).toContain('> **Deprecated:** Will be removed in 2.0.');
    // Esri's precomputed signature when present, otherwise parameters and return type.
    expect(section('refresh')).toContain('refresh(): Promise<Reading>');
    expect(section('refresh')).toContain('**Returns:** The new reading.');
    expect(section('setRange')).toContain('setRange(low: number, high?: number): void');
    expect(section('setRange')).toContain('- `high` (`number`, optional): Highest level.');
    expect(section('event-harbourReadingChange')).toContain(
      'harbourReadingChange: CustomEvent<{ level: number; }>',
    );
    expect(section('event-harbourReady')).toContain('harbourReady: CustomEvent\n');
  });
});

describe('renderCem: member, detail and other declarations', () => {
  it('selects an event by its name', () => {
    const page = renderCem({ ...input, member: 'harbourReadingChange' }, meta);
    expect(sectionIds(page)).toEqual(['event-harbourReadingChange']);
    expect(page.sections[0]?.markdown).toContain('_since 1.5_');
    expect(page.header).toContain('import "@example/harbour-components/components/harbour-gauge";');
  });

  it('selects a member by its anchor through select.member', () => {
    const page = renderCem(input, meta, { select: { member: 'event-harbourReady' } });
    expect(sectionIds(page)).toEqual(['event-harbourReady']);
  });

  it('summary detail indexes members and keeps the slot and CSS lists', () => {
    const page = renderCem(input, meta, { detail: 'summary' });
    expect(sectionIds(page)).toEqual([
      'harbour-gauge',
      'placing-the-gauge',
      'properties',
      'methods',
      'events',
      'slots',
      'css-custom-properties',
    ]);
    expect(page.sections.find((section) => section.id === 'properties')?.markdown).toBe(
      [
        '## Properties',
        '',
        '- `harbour`: Identifier of the harbour to show.',
        '- `scale`: Size of the dial.',
        '- `reading` _(readonly)_: The latest reading.',
        '- `legacyMode` _(deprecated)_: Draws the dial the old way.',
      ].join('\n'),
    );
  });

  it('renders a function of a non-component module by name', () => {
    const page = renderCem({ manifest, tag: 'formatReading', packageName }, meta);
    expect(page.title).toBe('formatReading');
    expect(page.header).toContain('_function_ · package `@example/harbour-components`');
    expect(page.header).toContain(
      'import { formatReading } from "@example/harbour-components/utils/readings";',
    );
    expect(page.sections[0]?.markdown).toContain(
      'function formatReading(reading: Reading, locale?: string): string',
    );
  });

  it('throws DOC_NOT_FOUND for an unknown tag or a manifest of the wrong shape', () => {
    expect(thrownBy(() => renderCem({ manifest, tag: 'harbour-nope', packageName }, meta))).toEqual(
      {
        code: 'DOC_NOT_FOUND',
        why: 'the manifest of @example/harbour-components does not declare harbour-nope',
        url: meta.url,
      },
    );
    expect(
      thrownBy(() => renderCem({ manifest: '<html>', tag: 'harbour-gauge', packageName }, meta))
        .code,
    ).toBe('DOC_NOT_FOUND');
  });
});
