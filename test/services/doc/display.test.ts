import { describe, expect, it } from 'vitest';
import { joinSections } from '../../../src/core/budget.js';
import type { DocPage, MemberEntry } from '../../../src/core/types.js';
import {
  displaySections,
  fileSections,
  linkOnlyPage,
  memberIndexSection,
  memberSection,
} from '../../../src/services/doc/display.js';
import { isPseudoSection, resolveSection } from '../../../src/services/doc/section-resolve.js';
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

const members: MemberEntry[] = [
  {
    id: 'resize',
    name: 'resize',
    kind: 'method',
    signature: 'resize(width: number): void',
    summary: 'Changes the width.',
  },
  { id: 'theme', name: 'theme', kind: 'property', summary: 'The active theme.', readonly: true },
  {
    id: 'legacyMode',
    name: 'legacyMode',
    kind: 'property',
    deprecated: true,
    inheritedFrom: 'BaseWidget',
  },
];

const API = [
  '# Widget',
  '',
  'A resizable widget.',
  '',
  '## Syntax',
  '',
  '```ts',
  'new Widget(options)',
  '```',
  '',
  '## Methods',
  '',
  '### resize {#resize}',
  '',
  'Changes the width of the widget.',
  '',
  '## Properties',
  '',
  '### theme {#theme}',
  '',
  'The active theme.',
].join('\n');

const apiPage = (): DocPage => makeDocPage({ markdown: API, kind: 'api', members });

const samplePage = (): DocPage =>
  makeDocPage({
    kind: 'sample',
    markdown:
      '# Resize a widget\n\nShows how to resize.\n\n## How it works\n\nCall resize on a button press.',
    relevantApis: ['Widget', 'Widget.resize'],
    files: [
      {
        name: 'main.ts',
        language: 'ts',
        text: 'widget.resize(300);\nconst s = `a``b`;\n',
        ref: 'https://github.com/Esri/x/blob/main/main.ts',
        bytes: 40,
      },
      {
        name: 'style.css',
        language: 'css',
        text: '.w { width: 1px }',
        ref: 'https://github.com/Esri/x/blob/main/style.css',
        bytes: 17,
      },
    ],
  });

describe('displaySections', () => {
  it('returns a plain page unchanged', () => {
    const page = makeDocPage({ markdown: GUIDE });
    expect(displaySections(page, 'default')).toEqual(page.sections);
    expect(displaySections(page, 'all')).toEqual(page.sections);
  });

  it('shows a sample as description, relevant APIs and the main file by default', () => {
    const ids = displaySections(samplePage(), 'default').map((section) => section.id);
    expect(ids).toEqual([
      'resize-a-widget',
      'how-it-works',
      'relevant-apis',
      'source',
      'other-source-files',
    ]);
    const text = joinSections(displaySections(samplePage(), 'default'));
    expect(text).toContain('- Widget.resize');
    expect(text).toContain('```ts\nwidget.resize(300);');
    expect(text).toContain('- style.css: https://github.com/Esri/x/blob/main/style.css');
    expect(text).not.toContain('.w { width');
  });

  it('shows every file in the full list, fenced safely', () => {
    const all = displaySections(samplePage(), 'all');
    expect(all.map((section) => section.id)).toEqual([
      'resize-a-widget',
      'how-it-works',
      'relevant-apis',
      'source',
      'source-2',
    ]);
    // The main file contains a double backtick run: the fence must be longer.
    expect(all.find((section) => section.id === 'source')?.markdown).toContain('```ts\n');
    expect(
      fileSections([{ name: 'a', language: 'md', text: 'x ```` y', ref: 'r', bytes: 1 }])[0]
        ?.markdown,
    ).toContain('`````md');
  });

  it('does not repeat relevant APIs the page already lists, or list other files when there are none', () => {
    const page = makeDocPage({
      kind: 'sample',
      markdown: '# S\n\nText.\n\n## Relevant API\n\n- Widget',
      relevantApis: ['Widget'],
      files: [{ name: 'main.ts', language: 'ts', text: 'x', ref: 'r', bytes: 1 }],
    });
    expect(displaySections(page, 'default').map((section) => section.id)).toEqual([
      's',
      'relevant-api',
      'source',
    ]);
  });

  it('builds a member index and a stand-in section for an undocumented member', () => {
    const index = memberIndexSection(members).markdown;
    expect(index).toContain('**method** (1)');
    expect(index).toContain('- `resize` (method): Changes the width.');
    expect(index).toContain('- `legacyMode` (property, deprecated, inherited from BaseWidget)');
    expect(index).toContain('- `theme` (property, read-only): The active theme.');

    expect(memberSection(members[0]!).markdown).toBe(
      '### resize\n\n```text\nresize(width: number): void\n```\n\nChanges the width.',
    );
    expect(memberSection(members[2]!)).toMatchObject({
      id: 'legacyMode',
      markdown: expect.stringContaining('Inherited from BaseWidget') as string,
    });
  });

  it('builds a link-only placeholder with provenance', () => {
    const page = linkOnlyPage(
      {
        url: 'https://developers.arcgis.com/widgets/gone/',
        kind: 'guide',
        license: 'esri-website-terms',
        retrievedAt: '2026-10-13T12:00:00.000Z',
        product: 'widgets-sdk',
      },
      'Gone page',
      'developers.arcgis.com is not responding (timeout)',
    );
    expect(page).toMatchObject({
      title: 'Gone page',
      product: 'widgets-sdk',
      degraded: { level: 'link-only' },
      cache: 'miss',
    });
    expect(page.attribution).toContain('https://developers.arcgis.com/widgets/gone/');
    expect(joinSections(page.sections)).toContain(
      'Open it directly: <https://developers.arcgis.com/widgets/gone/>',
    );
  });
});

describe('resolveSection', () => {
  const guide = makeDocPage({ markdown: GUIDE });
  const find = (wanted: string, page = guide) => {
    const resolved = resolveSection(page, displaySections(page, 'all'), wanted);
    return resolved === undefined
      ? undefined
      : [resolved.by, resolved.id, resolved.sections.map((s) => s.id)];
  };

  it('resolves in the documented order', () => {
    expect(find('colours')).toEqual(['id', 'colours', ['colours', 'dark-mode']]);
    expect(find('Typography & fonts')).toEqual(['slug', 'typography-fonts', ['typography-fonts']]);
    expect(find('#dark-mode')).toEqual(['id', 'dark-mode', ['dark-mode']]);
    expect(find('typography &amp; fonts')).toBeUndefined();
    expect(find('colors')).toEqual(['fuzzy', 'colours', ['colours', 'dark-mode']]);
    expect(find('nothing like it')).toBeUndefined();
    expect(find('   ')).toBeUndefined();
  });

  // Regression: a C# documentation id ends in its parameter list, which was stripped as if
  // the caller had written a call, so the section of an overload could not be asked for.
  it('matches an id that ends in a parameter list as it is written', () => {
    const id = 'M:Example.Queue.Dock.Run(System.Action,System.Int32)';
    const page = makeDocPage({
      sections: [
        {
          id: 'M:Example.Queue.Dock.Run(System.Action)',
          level: 3,
          title: 'Run',
          markdown: '### Run\n\nOne.',
          tokens: 4,
        },
        { id, level: 3, title: 'Run', markdown: '### Run\n\nTwo.', tokens: 4 },
      ],
    });
    expect(find(id, page)).toEqual(['id', id, [id]]);
    // A call spelling still names the member.
    expect(find('colours()')).toEqual(['id', 'colours', ['colours', 'dark-mode']]);
  });

  it('matches heading text without case when the slug differs', () => {
    const page = makeDocPage({ markdown: '# T\n\nx\n\n## C++ API {#cpp}\n\ny' });
    expect(find('c++ api', page)).toEqual(['heading', 'cpp', ['cpp']]);
  });

  it('prefers a real section over a pseudo-section of the same name', () => {
    expect(find('parameters')).toEqual(['id', 'parameters', ['parameters']]);
    const page = makeDocPage({
      markdown: '# T\n\nx\n\n## Input arguments\n\ny\n\n## Usage notes\n\nz',
    });
    expect(find('parameters', page)).toEqual(['pseudo', 'input-arguments', ['input-arguments']]);
    expect(find('syntax', page)).toEqual(['pseudo', 'usage-notes', ['usage-notes']]);
    // Prose under a heading that sounds like code is not the source of a page without code.
    expect(find('source', page)).toBeUndefined();
    expect(find('members', page)).toBeUndefined();
  });

  // Regression: find_samples ends with `section: "source"`, which failed on every sample
  // page of Esri's site (the code is under "Sample code"), returned the prose of "Example
  // use case" for a Markdown sample, and failed for notebooks.
  describe('the pseudo-section "source" on a page without source files', () => {
    const fence = ['```kotlin', 'val map = ArcGISMap()', '```'].join('\n');

    it('is the section that holds the code of a site sample', () => {
      const page = makeDocPage({
        kind: 'sample',
        markdown: `# Show a map\n\nx\n\n## Use case\n\ny\n\n## Sample code\n\n${fence}`,
      });
      expect(find('source', page)).toEqual(['pseudo', 'sample-code', ['sample-code']]);
    });

    it('skips a heading that only sounds like code and takes the one with a code block', () => {
      const page = makeDocPage({
        markdown: `# Fetch\n\n## Example use case\n\nProse.\n\n## Example code\n\n${fence}`,
      });
      expect(find('source', page)).toEqual(['pseudo', 'example-code', ['example-code']]);
    });

    it('is every code block of a page that has no code section, as in a notebook', () => {
      const page = makeDocPage({
        markdown: `# Notebook\n\nIntro.\n\n## Connect\n\nText.\n\n${fence}\n\n## Query\n\n${fence}`,
      });
      const resolved = resolveSection(page, page.sections, 'source');
      expect(resolved?.by).toBe('pseudo');
      expect(resolved?.sections).toHaveLength(1);
      const text = resolved?.sections[0]?.markdown ?? '';
      expect(text.match(/```kotlin/g)).toHaveLength(2);
      expect(text).toContain('### Connect');
      expect(text).not.toContain('Intro.');
    });
  });

  // Regression: `read` with section "HandleRESTRequest" failed on the Enterprise SDK page
  // whose heading is "IRESTRequestHandler.HandleRESTRequest Method".
  it('finds a member by the heading a page-per-type reference gives it', () => {
    const page = makeDocPage({
      markdown:
        '# IDockHandler Interface\n\nx\n\n### IDockHandler.HandleDock Method\n\ny\n\n### Name Property\n\nz',
    });
    expect(find('HandleDock', page)).toEqual([
      'member',
      'idockhandlerhandledock-method',
      ['idockhandlerhandledock-method'],
    ]);
    expect(find('handledock', page)?.[0]).toBe('member');
    expect(find('name', page)).toEqual(['member', 'name-property', ['name-property']]);
    expect(find('Handle', page)).toBeUndefined();
  });

  it('resolves members by name or id, with or without call syntax and case', () => {
    const page = apiPage();
    expect(find('resize', page)).toEqual(['id', 'resize', ['resize']]);
    expect(find('resize()', page)).toEqual(['id', 'resize', ['resize']]);
    expect(find('RESIZE', page)).toEqual(['slug', 'resize', ['resize']]);
    expect(find('legacyMode', page)).toEqual(['member', 'legacyMode', ['legacyMode']]);
    expect(find('legacymode', page)).toEqual(['member', 'legacyMode', ['legacyMode']]);
    expect(find('members', page)).toEqual(['pseudo', 'members', ['members']]);
    expect(find('syntax', page)).toEqual(['id', 'syntax', ['syntax']]);
  });

  it('resolves a member whose section id differs from its name', () => {
    const page = makeDocPage({
      kind: 'api',
      markdown: '# T\n\nx\n\n### goTo {#method-goTo}\n\nAnimates.',
      members: [{ id: 'method-goTo', name: 'goTo', kind: 'method' }],
    });
    expect(find('goTo', page)).toEqual(['heading', 'method-goTo', ['method-goTo']]);
    expect(find('goto()', page)).toEqual(['heading', 'method-goTo', ['method-goTo']]);
    const renamed = {
      ...page,
      sections: page.sections.map((s) => ({
        ...s,
        title: s.id === 'method-goTo' ? 'Method' : s.title,
      })),
    };
    expect(find('goTo', renamed)).toEqual(['member', 'method-goTo', ['method-goTo']]);
  });

  it('resolves the pseudo-sections of a sample', () => {
    const page = samplePage();
    expect(find('source', page)).toEqual(['pseudo', 'source', ['source', 'source-2']]);
    expect(find('readme', page)).toEqual(['pseudo', 'readme', ['resize-a-widget', 'how-it-works']]);
    expect(find('source-2', page)).toEqual(['id', 'source-2', ['source-2']]);
    expect(resolveSection({ ...page, sections: [] }, [], 'readme')).toBeUndefined();
  });

  it('returns all files for the pseudo-section source when no section has that id', () => {
    const page = samplePage();
    const resolved = resolveSection(page, page.sections, 'source');
    expect(resolved).toMatchObject({ by: 'pseudo', id: 'source' });
    expect(resolved?.sections.map((section) => section.id)).toEqual(['source', 'source-2']);
  });

  it('does not guess between two equally near headings', () => {
    const page = makeDocPage({ markdown: '# T\n\nx\n\n## Layer1\n\na\n\n## Layer2\n\nb' });
    expect(find('Layer3', page)).toBeUndefined();
  });

  it('knows the pseudo-section names', () => {
    expect(isPseudoSection(' Source ')).toBe(true);
    expect(isPseudoSection('sources')).toBe(false);
  });
});
