import { describe, expect, it } from 'vitest';
import { renderArcade } from '../../src/render/arcade.js';
import { readJsonFixture } from '../support/fixtures.js';
import { expectGolden, makeMeta, pageText, sectionIds, structured, thrownBy } from './helpers.js';

interface Category {
  id: string;
  title: string;
  items: unknown[];
}

const category = readJsonFixture<Category>(...structured('arcade', 'category.json'));
const profile = readJsonFixture(...structured('arcade', 'profile.json'));
const meta = makeMeta({
  url: 'https://developers.arcgis.com/arcade/function-reference/tide_functions/',
  license: 'esri-ma',
  packageName: '@arcgis/coding-components',
  version: '5.1.27',
});

describe('renderArcade: functions', () => {
  it('renders a category with one section per function, keyed by its anchor', () => {
    const page = renderArcade({ item: category }, meta);
    expectGolden(page, ...structured('arcade', 'category.expected.md'));
    expect(page.title).toBe('Tide functions');
    expect(sectionIds(page)).toEqual(['tide-functions', 'meanlevel', 'tideheight1', 'tideheight2']);
    expect(page.members).toEqual([
      {
        id: 'meanlevel',
        name: 'MeanLevel',
        kind: 'constant',
        signature: 'MeanLevel',
        summary: 'The mean water level, in metres.',
      },
      {
        id: 'tideheight1',
        name: 'TideHeight',
        kind: 'function',
        signature: 'TideHeight(moment) -> Number',
        summary: 'Returns the water height at a moment.',
      },
      {
        id: 'tideheight2',
        name: 'TideHeight',
        kind: 'function',
        signature: 'TideHeight(moments) -> Array<Number>',
        summary: 'Returns the water heights at several moments.',
      },
    ]);
  });

  it('takes parameters and return value from the editor documentation, entities decoded', () => {
    const text = pageText(renderArcade({ item: category }, meta));
    expect(text).toContain(
      '- **moments**: [Array](https://example.com/arcade/guide/types/#array)<[Date](https://example.com/arcade/guide/types/#date)> - The moments to look up.',
    );
    expect(text).not.toContain('&lt;');
    // The version line and description are stated once, not repeated from the editor text.
    expect(text.match(/Returns the water height at a moment\./g)).toHaveLength(1);
    expect(text).toContain('_function · bundle `data-access` · since 1.9 · consumes credits_');
  });

  it('renders the overloads of one function, headed by their signatures', () => {
    const overloads = category.items[1];
    const page = renderArcade({ item: overloads }, meta);
    expect(page.title).toBe('TideHeight');
    expect(page.sections.map((section) => section.title)).toEqual([
      'TideHeight',
      'TideHeight(moment) -> Number',
      'TideHeight(moments) -> Array<Number>',
    ]);
  });

  it('renders a single item as the page itself, with its signature fenced', () => {
    const [first] = category.items[1] as unknown[];
    const page = renderArcade({ item: first }, meta);
    expect(sectionIds(page)).toEqual(['tideheight1']);
    expect(
      page.sections[0]?.markdown.startsWith(
        '# TideHeight\n\n```arcade\nTideHeight(moment) -> Number\n```\n\n_function · bundle `core` · since 1.4_',
      ),
    ).toBe(true);
    expect(page.diagnostics.fences).toBe(3);
    expect(page.diagnostics.fencesWithLanguage).toBe(3);
  });

  it('applies the detail level', () => {
    const [first] = category.items[1] as unknown[];
    const signature = renderArcade({ item: first }, meta, { detail: 'signature' });
    expect(signature.sections[0]?.markdown).toBe(
      '# TideHeight\n\n```arcade\nTideHeight(moment) -> Number\n```\n\nReturns the water height at a moment.',
    );
    const summary = renderArcade({ item: first }, meta, { detail: 'summary' });
    expect(summary.sections[0]?.markdown).toContain(
      'Height right now\n\n```arcade\nTideHeight(Now())\n```',
    );
    expect(summary.sections[0]?.markdown).not.toContain('Height tomorrow');
  });

  it('selects a function by name without regard to case, or by anchor', () => {
    const byName = renderArcade({ item: category }, meta, { select: { member: 'meanlevel' } });
    expect(sectionIds(byName)).toEqual(['meanlevel']);
    const byAnchor = renderArcade({ item: category }, meta, { select: { member: 'tideheight2' } });
    expect(sectionIds(byAnchor)).toEqual(['tideheight2']);
    expect(byAnchor.title).toBe('Tide functions');
    const unknown = renderArcade({ item: category }, meta, { select: { member: 'nope' } });
    expect(unknown.sections).toHaveLength(4);
  });

  it('falls back to the lower-cased name when an item has no link', () => {
    const page = renderArcade(
      { item: { type: 'function', name: 'Buffer', description: 'Grows a shape.' } },
      meta,
    );
    expect(sectionIds(page)).toEqual(['buffer']);
    expect(page.sections[0]?.markdown).toBe('# Buffer\n\n_function_\n\nGrows a shape.');
  });

  it('throws DOC_NOT_FOUND for anything else', () => {
    expect(thrownBy(() => renderArcade({ item: 'text' }, meta)).code).toBe('DOC_NOT_FOUND');
    expect(thrownBy(() => renderArcade({ item: { id: 'empty', items: [] } }, meta)).code).toBe(
      'DOC_NOT_FOUND',
    );
  });
});

describe('renderArcade: profile', () => {
  it('renders bundles and profile variables', () => {
    const page = renderArcade({ item: profile, profile: true }, meta);
    expectGolden(page, ...structured('arcade', 'profile.expected.md'));
    expect(page.title).toBe('Tide alert profile');
    expect(sectionIds(page)).toEqual(['tide-alert-profile', 'profile-variables']);
    expect(page.members).toEqual([
      {
        id: '$gauge',
        name: '$gauge',
        kind: 'variable',
        summary: 'The gauge whose reading triggered the alert.',
      },
      { id: '$context', name: '$context', kind: 'variable' },
    ]);
    expect(page.diagnostics.tablesByStrategy).toEqual({ gfm: 1 });
  });

  it('says so when a profile has no variables', () => {
    const page = renderArcade(
      { item: { name: 'Minimal', id: 'minimal', bundles: [], variables: [] }, profile: true },
      meta,
    );
    expect(page.sections[1]?.markdown).toBe(
      '## Profile variables\n\nThis profile defines no profile variables.',
    );
  });
});
