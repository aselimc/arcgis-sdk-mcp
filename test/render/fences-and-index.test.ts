import { describe, expect, it } from 'vitest';
import { stepFence, type OpenFence } from '../../src/core/fences.js';
import { renderCem } from '../../src/render/cem.js';
import { closeFences, fencedExample, summaryLine } from '../../src/render/md.js';
import { buildSections } from '../../src/render/page.js';
import { makeMeta, pageText } from './helpers.js';

/** True when every fence the text opens is closed. */
function balanced(text: string): boolean {
  let open: OpenFence;
  for (const line of text.split('\n')) open = stepFence(line, open).open;
  return open === undefined;
}

const packageName = '@example/map-components';
const meta = makeMeta({
  url: 'https://developers.arcgis.com/tides-js/references/map-components/components/tide-map/',
  license: 'esri-ma',
});

/** A manifest with the faults of a published one: an example that never closes its fence. */
const manifest = {
  schemaVersion: '2.1.0',
  modules: [
    {
      kind: 'javascript-module',
      path: 'components/tide-map',
      declarations: [
        {
          kind: 'class',
          name: 'TideMap',
          tagName: 'tide-map',
          customElement: true,
          description: 'A map of tide stations.',
          members: [
            {
              kind: 'method',
              name: 'fetchFeatures',
              description: 'Fetches the features under a point:\n\n```js\nmap.fetchFeatures(point)',
              docsTags: [
                {
                  name: 'example',
                  text: '```js\n// Wait for all the features\nconst features = await Array.fromAsync(generator);\n});',
                },
              ],
              return: { type: { text: 'Promise<Feature[]>' } },
            },
            {
              kind: 'method',
              name: 'goTo',
              description: 'Moves the view.',
              return: { type: { text: 'Promise<void>' } },
            },
            {
              kind: 'field',
              name: 'selectionMode',
              type: { text: '"single" | "multiple"' },
              description:
                'Specifies the selection mode of the component, where:\n\n- `"single"` allows one,\n- `"multiple"` allows many.',
            },
            { kind: 'field', name: 'resultOffset', type: { text: 'number' } },
            {
              kind: 'field',
              name: 'scale',
              type: { text: '"s" | "m"' },
              description: 'Size of the map.',
            },
          ],
        },
      ],
    },
  ],
};
const input = { manifest, tag: 'tide-map', packageName };

describe('closeFences and fencedExample', () => {
  it('closes a fence that is left open, with the marker that opened it', () => {
    expect(closeFences('```js\nconst a = 1;')).toBe('```js\nconst a = 1;\n```');
    expect(closeFences('Text.\n\n~~~~\ncode\n\n')).toBe('Text.\n\n~~~~\ncode\n~~~~');
    expect(closeFences('````md\n```js\nx\n```')).toBe('````md\n```js\nx\n```\n````');
  });

  it('leaves balanced text as it is', () => {
    const text = 'Intro.\n\n```js\nconst a = 1;\n```\n\nMore.';
    expect(closeFences(text)).toBe(text);
    expect(closeFences('No code at all.')).toBe('No code at all.');
  });

  it('balances an example that brings its own, unclosed fence', () => {
    expect(fencedExample('```js\nview.on("click", () => {\n});', 'ts')).toBe(
      '```js\nview.on("click", () => {\n});\n```',
    );
    expect(fencedExample('const a = 1;', 'ts')).toBe('```ts\nconst a = 1;\n```');
  });
});

// Regression: 13 of the 609 examples of the published map-components manifest open a fence
// and never close it. After `arcgis-map.fetchPopupFeatures`, the heading `### goTo` and all
// following prose sat inside a code block, and the Source line of a member read was code.
describe('a manifest whose example does not close its fence', () => {
  it('keeps the fences of the whole page balanced', () => {
    const text = pageText(renderCem(input, meta));
    expect(balanced(text)).toBe(true);
    expect(text).toContain(
      'const features = await Array.fromAsync(generator);\n});\n```\n\n### goTo\n\n```ts\ngoTo(): Promise<void>\n```',
    );
  });

  it('ends the section of the member outside a fence', () => {
    for (const detail of ['full', 'summary', 'signature'] as const) {
      const page = renderCem({ ...input, member: 'fetchFeatures' }, meta, { detail });
      expect(balanced(pageText(page)), detail).toBe(true);
    }
  });

  it('closes a fence a description leaves open, before what follows it', () => {
    const section = renderCem({ ...input, member: 'fetchFeatures' }, meta).sections[0]?.markdown;
    expect(section).toContain('```js\nmap.fetchFeatures(point)\n```\n\n**Example**');
  });

  it('closes an open fence in any block a renderer hands over', () => {
    const sections = buildSections([
      { level: 2, title: 'A', body: 'Text.\n\n```js\nopen' },
      { level: 2, title: 'B', body: 'After.' },
    ]);
    expect(sections.map((section) => section.id)).toEqual(['a', 'b']);
    expect(sections[0]?.markdown).toBe('## A\n\nText.\n\n```js\nopen\n```');
  });
});

describe('one-line member index', () => {
  const properties = renderCem(input, meta, { detail: 'summary' }).sections.find(
    (section) => section.id === 'properties',
  )?.markdown;

  // Regression: "- `selectionMode`: Specifies the selection mode of the component, where:"
  // stopped at the colon; the values were one more call away.
  it('completes a summary that stops at a colon with the type', () => {
    expect(properties).toContain(
      '- `selectionMode`: Specifies the selection mode of the component, where: `"single" | "multiple"`',
    );
  });

  // Regression: members without a description were listed as bare names ("- `resultOffset`").
  it('shows the type of a member that has no description', () => {
    expect(properties).toContain('- `resultOffset`: `number`');
  });

  it('adds nothing to a line that is a sentence', () => {
    expect(properties?.split('\n').at(-1)).toBe('- `scale`: Size of the map.');
  });
});

describe('summaryLine', () => {
  it('drops link targets, also ones with parentheses', () => {
    expect(
      summaryLine('See [toJson()](https://e.com/swift/tojson()/) and [x](https://e.com/y).'),
    ).toBe('See toJson() and x.');
  });
});
