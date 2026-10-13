import { describe, expect, it } from 'vitest';
import { renderTypedoc } from '../../src/render/typedoc.js';
import { readJsonFixture } from '../support/fixtures.js';
import { expectGolden, makeMeta, pageText, sectionIds, structured, thrownBy } from './helpers.js';

const URL = 'https://developers.arcgis.com/tides-js/api-reference/tides/TideClock/';
const meta = makeMeta({ url: URL });
const raw = readJsonFixture(...structured('typedoc', 'class.json'));

describe('renderTypedoc: class', () => {
  const page = renderTypedoc({ raw }, meta);

  it('matches the golden file', () => {
    expectGolden(page, ...structured('typedoc', 'class.expected.md'));
  });

  it('describes the symbol in the header and the declaration', () => {
    expect(page.title).toBe('TideClock');
    expect(page.header).toBe(
      '_Class_ in `tides` · [source](https://github.com/example/tides/blob/0123abc/packages/tides/src/TideClock.ts#L12)',
    );
    expect(page.sections[0]?.markdown).toContain(
      '```ts\nclass TideClock extends ClockBase implements Disposable\n```',
    );
    expect(page.sections[0]?.markdown).toContain('**Extended by:** `StormClock`');
  });

  it('lists members in group order with their names as section ids', () => {
    expect(sectionIds(page)).toEqual([
      'tideclock',
      'constructors',
      'constructor',
      'properties',
      'harbour',
      'units',
      'accessors',
      'nextHighTide',
      'offset',
      'methods',
      'forHarbour',
      'heightAt',
      'sample',
    ]);
    expect(page.sections.find((section) => section.id === 'heightAt')?.parent).toBe('methods');
  });

  it('leaves private members out', () => {
    expect(page.members?.map((member) => member.name)).not.toContain('secret');
  });

  it('resolves inline links: on-page ids to anchors, URLs as given, other symbols as code', () => {
    const lead = page.sections[0]?.markdown ?? '';
    expect(lead).toContain(`[\`TideClock.forHarbour\`](${URL}#forHarbour)`);
    // A label that is only "()" gets the member name in front.
    expect(lead).toContain(`[nextHighTide()](${URL}#nextHighTide)`);
    expect(lead).toContain('[tide primer](https://example.com/tides/primer)');
    expect(lead).toContain('`HarbourOptions`.');
    expect(lead).not.toContain('\r');
  });

  it('prints signatures with the type printer', () => {
    const text = pageText(page);
    expect(text).toContain('constructor(options: HarbourOptions)\n');
    expect(text).toContain('readonly harbour: string');
    expect(text).toContain('units?: "m" | "ft" = "m"');
    expect(text).toContain('get offset(): number\nset offset(value: number)');
    expect(text).toContain('static forHarbour(id: string): TideClock');
    expect(text).toContain(
      'sample<T extends Date>(...moments: T[]): Promise<(number | null)[]>\nsample(range: { from: Date; to?: Date }): Promise<number[]>',
    );
  });

  it('carries flags, deprecation and inheritance into the member list', () => {
    const byName = new Map(page.members?.map((member) => [member.name, member]));
    expect(byName.get('harbour')).toMatchObject({ kind: 'property', readonly: true });
    expect(byName.get('nextHighTide')).toMatchObject({ kind: 'accessor', readonly: true });
    expect(byName.get('offset')?.readonly).toBeUndefined();
    expect(byName.get('heightAt')).toMatchObject({
      deprecated: true,
      inheritedFrom: 'ClockBase',
      signature: 'heightAt(when: Date, precision?: number): number',
      summary: 'Water height at a moment.',
    });
  });

  it('fences an unfenced example and keeps a fenced one', () => {
    const heightAt = page.sections.find((section) => section.id === 'heightAt')?.markdown ?? '';
    expect(heightAt).toContain('```ts\nclock.heightAt(new Date());\n```');
    expect(heightAt).toContain(`> **Deprecated:** Use [sample](${URL}#sample) instead.`);
    expect(page.diagnostics.fences).toBe(page.diagnostics.fencesWithLanguage);
  });
});

describe('renderTypedoc: member and detail', () => {
  it('returns one member, with the page still described as a whole', () => {
    const page = renderTypedoc({ raw, member: 'forHarbour' }, meta);
    expect(sectionIds(page)).toEqual(['forHarbour']);
    expect(page.title).toBe('TideClock');
    expect(page.members).toHaveLength(8);
    expect(page.sections[0]?.markdown).toContain('**Returns:** A clock that is ready to use.');
    expect(page.sections[0]?.markdown).toContain('**Throws**\n\n- When the harbour is unknown.');
    expect(page.sections[0]?.markdown).toContain('- `id` (`string`): Harbour identifier.');
  });

  it('honours select.member like the member input', () => {
    const page = renderTypedoc({ raw }, meta, { select: { member: 'units' } });
    expect(sectionIds(page)).toEqual(['units']);
    // The default is part of the declaration, so it is not repeated as a flag.
    expect(page.sections[0]?.markdown).toBe(
      '### units\n\n```ts\nunits?: "m" | "ft" = "m"\n```\n\nUnit of every height this clock reports.',
    );
  });

  it('states a documented default the declaration does not show', () => {
    const page = renderTypedoc(
      {
        raw: {
          id: 1,
          name: 'Options',
          kind: 256,
          children: [
            {
              id: 2,
              name: 'units',
              kind: 1024,
              flags: { isOptional: true },
              type: { type: 'intrinsic', name: 'string' },
              comment: {
                summary: [{ kind: 'text', text: 'Unit of height.' }],
                blockTags: [{ tag: '@default', content: [{ kind: 'text', text: '"m"' }] }],
              },
            },
          ],
        },
        member: 'units',
      },
      meta,
    );
    expect(page.sections[0]?.markdown).toContain('units?: string\n```\n\n_default `"m"`_');
  });

  it('returns the whole page for an unknown member', () => {
    const page = renderTypedoc({ raw, member: 'nope' }, meta);
    expect(page.sections).toHaveLength(13);
  });

  it('signature detail is the declaration and one sentence', () => {
    const page = renderTypedoc({ raw, member: 'heightAt' }, meta, { detail: 'signature' });
    expect(page.sections[0]?.markdown).toBe(
      '### heightAt\n\n```ts\nheightAt(when: Date, precision?: number): number\n```\n\nWater height at a moment.',
    );
  });

  it('summary detail of a member has one example and no throws', () => {
    const page = renderTypedoc({ raw, member: 'forHarbour' }, meta, { detail: 'summary' });
    expect(page.sections[0]?.markdown).toContain('**Returns:**');
    expect(page.sections[0]?.markdown).not.toContain('**Throws**');
  });

  it('summary detail of a type is its description and a one-line member index', () => {
    const page = renderTypedoc({ raw }, meta, { detail: 'summary' });
    expectGolden(page, ...structured('typedoc', 'class-summary.expected.md'));
    expect(sectionIds(page)).toEqual([
      'tideclock',
      'constructors',
      'properties',
      'accessors',
      'methods',
    ]);
    expect(page.sections.at(-1)?.markdown).toContain(
      '- `heightAt` _(inherited from ClockBase, deprecated)_: Water height at a moment.',
    );
  });
});

describe('renderTypedoc: other reflections', () => {
  it('renders a function with parameters and return text', () => {
    const page = renderTypedoc(
      {
        raw: {
          id: 1,
          name: 'nearestHarbour',
          kind: 64,
          flags: {},
          module: '@example/tides',
          sources: [{ fileName: 'src/nearest.ts', line: 3 }],
          signatures: [
            {
              id: 2,
              name: 'nearestHarbour',
              kind: 4096,
              comment: {
                summary: [{ kind: 'text', text: 'Finds the closest harbour.' }],
                blockTags: [
                  { tag: '@param', name: 'x', content: [{ kind: 'text', text: 'Longitude.' }] },
                  { tag: '@returns', content: [{ kind: 'text', text: 'Its identifier.' }] },
                  {
                    tag: '@remarks',
                    content: [{ kind: 'text', text: 'Uses great-circle distance.' }],
                  },
                  { tag: '@beta', content: [{ kind: 'text', text: 'May change.' }] },
                  {
                    tag: '@see',
                    content: [{ kind: 'text', text: '- https://example.com/harbours' }],
                  },
                ],
                modifierTags: ['@deprecated'],
              },
              parameters: [
                {
                  id: 3,
                  name: 'x',
                  kind: 32768,
                  flags: {},
                  type: { type: 'intrinsic', name: 'number' },
                },
              ],
              type: { type: 'intrinsic', name: 'string' },
            },
          ],
        },
      },
      meta,
    );
    expect(page.header).toBe('_Function_ in `@example/tides`');
    expect(page.members).toEqual([]);
    expect(page.sections[0]?.markdown).toBe(
      [
        '# nearestHarbour',
        '```ts\nfunction nearestHarbour(x: number): string\n```',
        '> **Deprecated**',
        'Finds the closest harbour.\n\nUses great-circle distance.\n\n**beta:** May change.',
        '**Parameters**',
        '- `x` (`number`): Longitude.',
        '**Returns:** Its identifier.',
        '**See also**',
        '- https://example.com/harbours',
      ].join('\n\n'),
    );
  });

  it('renders a type alias of an object type with its properties as members', () => {
    const page = renderTypedoc(
      {
        raw: {
          id: 1,
          name: 'Reading',
          kind: 2097152,
          flags: {},
          typeParameters: [
            {
              name: 'U',
              type: { type: 'intrinsic', name: 'string' },
              default: { type: 'literal', value: 'm' },
            },
          ],
          type: {
            type: 'reflection',
            declaration: {
              children: [
                {
                  id: 2,
                  name: 'level',
                  kind: 1024,
                  flags: {},
                  type: { type: 'intrinsic', name: 'number' },
                  comment: { summary: [{ kind: 'text', text: 'Water level.' }] },
                },
              ],
            },
          },
        },
      },
      meta,
    );
    expect(page.sections[0]?.markdown).toContain(
      'type Reading<U extends string = "m"> = { level: number }',
    );
    expect(page.members).toEqual([
      {
        id: 'level',
        name: 'level',
        kind: 'property',
        signature: 'level: number',
        summary: 'Water level.',
      },
    ]);
  });

  it('renders an interface, an enum and a variable', () => {
    const iface = renderTypedoc(
      {
        raw: {
          id: 1,
          name: 'Disposable',
          kind: 256,
          extendedTypes: [{ type: 'reference', name: 'Base' }],
          children: [
            {
              id: 2,
              name: 'dispose',
              kind: 2048,
              flags: {},
              signatures: [{ id: 3, name: 'dispose', kind: 4096 }],
            },
          ],
        },
      },
      meta,
    );
    expect(iface.sections[0]?.markdown).toContain('interface Disposable extends Base');
    expect(iface.members?.[0]).toMatchObject({
      name: 'dispose',
      kind: 'method',
      signature: 'dispose(): void',
    });

    const enumeration = renderTypedoc(
      {
        raw: {
          id: 1,
          name: 'Units',
          kind: 8,
          children: [
            { id: 2, name: 'Metres', kind: 16, flags: {}, type: { type: 'literal', value: 'm' } },
          ],
        },
      },
      meta,
    );
    expect(pageText(enumeration)).toContain(
      '## Enumeration members\n\n### Metres\n\n```ts\nMetres: "m"\n```',
    );

    const variable = renderTypedoc(
      {
        raw: {
          id: 1,
          name: 'DEFAULT_UNITS',
          kind: 32,
          flags: { isReadonly: true },
          type: { type: 'intrinsic', name: 'string' },
          defaultValue: '"m"',
        },
      },
      meta,
    );
    expect(variable.sections[0]?.markdown).toContain('const DEFAULT_UNITS: string = "m"');
    expect(variable.header).toBe('_Variable_ in `tides`');
  });

  it('rejects page data without a reflection', () => {
    expect(thrownBy(() => renderTypedoc({ raw: null }, meta)).code).toBe('DOC_NOT_FOUND');
    expect(thrownBy(() => renderTypedoc({ raw: { kind: 128 } }, meta))).toEqual({
      code: 'DOC_NOT_FOUND',
      why: 'the page data holds no TypeDoc reflection',
      url: URL,
    });
  });
});
