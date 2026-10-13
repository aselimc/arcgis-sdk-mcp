import { describe, expect, it } from 'vitest';
import { joinSections } from '../../src/core/budget.js';
import { sectionsFromMarkdown } from '../../src/core/sections.js';
import {
  distinctIds,
  findMember,
  memberEntries,
  renderApiPage,
  type ApiMember,
  type ApiType,
} from '../../src/render/api-page.js';
import { buildSections, finishPage, selectSections } from '../../src/render/page.js';
import { FAKE_NOW_ISO, makeResponse } from '../support/builders.js';
import { makeMeta, sectionIds } from './helpers.js';

describe('buildSections', () => {
  it('keeps explicit ids, derives the others, and links parents', () => {
    const sections = buildSections([
      { level: 1, title: 'Map', body: 'Lead.' },
      { level: 2, title: 'Methods', body: '' },
      { id: 'queryFeatures', level: 3, title: 'queryFeatures', body: 'Queries.' },
      { level: 2, title: 'Events', body: '' },
    ]);
    expect(sections.map((section) => [section.id, section.level, section.parent])).toEqual([
      ['map', 1, undefined],
      ['methods', 2, 'map'],
      ['queryFeatures', 3, 'methods'],
      ['events', 2, 'map'],
    ]);
    expect(sections[2]?.markdown).toBe('### queryFeatures\n\nQueries.');
    expect(sections[2]?.tokens).toBeGreaterThan(0);
  });

  it('splits headings of a body into child sections below the block', () => {
    const sections = buildSections([
      {
        id: 'layer',
        level: 2,
        title: 'Layer',
        body: 'Lead.\n\n# Usage\n\nText.\n\n## Details\n\nMore.',
      },
    ]);
    expect(sections.map((section) => [section.id, section.level, section.parent])).toEqual([
      ['layer', 2, undefined],
      ['usage', 3, 'layer'],
      ['details', 4, 'usage'],
    ]);
    expect(sections[0]?.markdown).toBe('## Layer\n\nLead.');
  });

  it('never lets a derived id take a member anchor, and separates equal ids', () => {
    const sections = buildSections([
      { level: 1, title: 'Properties', body: '' },
      { id: 'properties', level: 3, title: 'properties', body: 'The member.' },
      { id: 'properties', level: 3, title: 'properties', body: 'An overload.' },
      { level: 2, title: 'Notes', body: '## Properties\n\nInner.' },
    ]);
    expect(sectionIds({ sections } as never)).toEqual([
      'properties-1',
      'properties',
      'properties-2',
      'notes',
      'properties-3',
    ]);
  });

  it('produces what sectionsFromMarkdown would read back', () => {
    const sections = buildSections([
      { level: 1, title: 'Clock', body: 'Lead.\n\n```js\n# not a heading\n```' },
      { level: 0, title: '', body: 'Loose text.' },
      { level: 2, title: 'Usage', body: 'Use it.' },
      { level: 2, title: 'Empty', body: '' },
    ]);
    const reread = sectionsFromMarkdown(joinSections(sections));
    // The loose block has no heading, so re-reading folds it into the section before it.
    expect(reread.map((section) => section.title)).toEqual(['Clock', 'Usage', 'Empty']);
    expect(sections[1]).toMatchObject({ id: '_lead', level: 0 });
    expect(sections[3]?.markdown).toBe('## Empty');
  });

  it('drops a block with neither heading nor body', () => {
    expect(buildSections([{ level: 0, title: '', body: '  ' }])).toEqual([]);
  });
});

describe('selectSections and finishPage', () => {
  const sections = buildSections([
    { level: 1, title: 'Clock', body: 'Lead.' },
    { level: 2, title: 'Methods', body: '' },
    {
      id: 'ring',
      level: 3,
      title: 'ring',
      body: 'Rings. <span id="x">raw</span> `<div>` stays code.',
    },
    {
      level: 2,
      title: 'Notes',
      body: '```\nplain\n```\n\n```js\ntagged();\n```\n\n| A |\n| --- |\n| 1 |',
    },
  ]);
  const members = [{ id: 'ring', name: 'Ring', kind: 'method' }];

  it('selects by section id, by member id and by member name', () => {
    expect(selectSections(sections, members, { section: 'methods' }).map((s) => s.id)).toEqual([
      'methods',
      'ring',
    ]);
    expect(selectSections(sections, members, { member: 'ring' }).map((s) => s.id)).toEqual([
      'ring',
    ]);
    expect(selectSections(sections, members, { member: 'Ring' }).map((s) => s.id)).toEqual([
      'ring',
    ]);
    expect(selectSections(sections, undefined, { member: 'notes' }).map((s) => s.id)).toEqual([
      'notes',
    ]);
  });

  it('returns everything when nothing matches', () => {
    expect(selectSections(sections, members, { section: 'nope', member: 'nope' })).toBe(sections);
    expect(selectSections(sections, members, undefined)).toBe(sections);
  });

  it('fills provenance from the meta and measures the text', () => {
    const res = makeResponse({ cache: 'hit', aliasChain: ['https://developers.arcgis.com/old/'] });
    const meta = makeMeta({ product: 'tides', source: 'api', line: 'latest', res });
    const page = finishPage(
      'demo',
      meta,
      {
        title: 'Clock',
        header: '```ts\nx\n```',
        sections,
        members,
        unknown: ['a', 'a', 'b'],
        notices: ['n'],
      },
      { select: { section: 'notes' } },
    );
    expect(page).toMatchObject({
      ref: meta.url,
      title: 'Clock',
      product: 'tides',
      source: 'api',
      line: 'latest',
      kind: 'api',
      license: 'esri-website-terms',
      retrievedAt: FAKE_NOW_ISO,
      cache: 'hit',
      redirectedFrom: ['https://developers.arcgis.com/old/'],
      notices: ['n'],
    });
    expect(page.sections.map((section) => section.id)).toEqual(['notes']);
    expect(page.diagnostics).toEqual({
      family: 'structured',
      renderer: 'demo',
      // Measured on the header and the selected sections.
      fences: 3,
      fencesWithLanguage: 2,
      tablesByStrategy: { gfm: 1 },
      unknownIslands: ['a', 'b'],
      leftoverHtmlTags: 0,
      redirectHops: 1,
      ms: 0,
    });
  });

  it('counts raw HTML outside code and omits optional fields that are absent', () => {
    const page = finishPage('demo', makeMeta(), { title: 'Clock', header: '', sections });
    expect(page.diagnostics.leftoverHtmlTags).toBe(2);
    expect(page.diagnostics.tablesByStrategy).toEqual({ gfm: 1 });
    expect(page).not.toHaveProperty('header');
    expect(page).not.toHaveProperty('members');
    expect(page).not.toHaveProperty('files');
    expect(page.notices).toEqual([]);
    expect(page.diagnostics.redirectHops).toBe(0);
  });
});

describe('api-page', () => {
  const member = (overrides: Partial<ApiMember>): ApiMember => ({
    id: 'ring',
    name: 'ring',
    kind: 'method',
    group: 'Methods',
    ...overrides,
  });

  it('gives overloads distinct anchors and finds members by id, name and case', () => {
    const members = distinctIds([member({}), member({}), member({ id: 'Lit', name: 'Lit' })]);
    expect(members.map((item) => item.id)).toEqual(['ring', 'ring-1', 'Lit']);
    expect(findMember(members, 'ring-1')).toBe(members[1]);
    expect(findMember(members, 'lit')).toBe(members[2]);
    expect(findMember(members, '')).toBeUndefined();
    expect(findMember(members, undefined)).toBeUndefined();
    expect(findMember(members, 'nope')).toBeUndefined();
  });

  it('builds member entries with one-line signatures and link-free summaries', () => {
    expect(
      memberEntries([
        member({
          signature: 'ring(\n  times: number\n): void',
          description: 'Rings [the bell](https://example.com/bell). Loudly.',
          inheritedFrom: 'Base',
          deprecated: 'Use chime.',
          readonly: true,
        }),
        member({ id: 'plain', name: 'plain', deprecated: false }),
      ]),
    ).toEqual([
      {
        id: 'ring',
        name: 'ring',
        kind: 'method',
        signature: 'ring( times: number ): void',
        summary: 'Rings the bell.',
        inheritedFrom: 'Base',
        deprecated: true,
        readonly: true,
      },
      { id: 'plain', name: 'plain', kind: 'method' },
    ]);
  });

  it('puts the titled part of a description after everything else of the entry', () => {
    const type: ApiType = {
      title: 'Clock',
      language: 'ts',
      signature: 'class Clock',
      description: 'Lead paragraph.\n\n## Background\n\nLong story.',
      since: '1.0',
      deprecated: true,
      facts: ['**Extends:** `Base`'],
      examples: ['new Clock()'],
      see: ['[Guide](https://example.com)'],
      members: [],
      notices: ['careful'],
      unknown: ['x:y'],
    };
    const page = renderApiPage('demo', makeMeta(), type, undefined);
    expect(page.sections.map((section) => section.markdown)).toEqual([
      [
        '# Clock',
        '```ts\nclass Clock\n```',
        '_since 1.0_',
        '**Extends:** `Base`',
        '> **Deprecated**',
        'Lead paragraph.',
        '**Example**',
        '```ts\nnew Clock()\n```',
        '**See also**',
        '- [Guide](https://example.com)',
      ].join('\n\n'),
      '## Background\n\nLong story.',
    ]);
    expect(page.notices).toEqual(['careful']);
    expect(page.diagnostics.unknownIslands).toEqual(['x:y']);
    expect(page.members).toEqual([]);
  });

  it('renders a parameter with every fact and a member with extra text only at full detail', () => {
    const type: ApiType = {
      title: 'Clock',
      language: 'ts',
      members: [
        member({
          params: [
            {
              name: 'times',
              type: 'number',
              optional: true,
              default: '1',
              description: ' How often. ',
            },
            { name: 'bare' },
          ],
          extra: 'Raw extra.',
        }),
      ],
    };
    const full = renderApiPage('demo', makeMeta(), type, undefined, 'ring');
    expect(full.sections[0]?.markdown).toBe(
      '### ring\n\n**Parameters**\n\n- `times` (`number`, optional, default `1`): How often.\n- `bare`\n\nRaw extra.',
    );
    const summary = renderApiPage('demo', makeMeta(), type, { detail: 'summary' }, 'ring');
    expect(summary.sections[0]?.markdown).not.toContain('Raw extra.');
  });
});
