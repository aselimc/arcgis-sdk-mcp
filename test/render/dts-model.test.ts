import { describe, expect, it } from 'vitest';
import { parseJsDoc, stripComment } from '../../src/render/dts/jsdoc.js';
import { classView, defaultClass, rawMemberText } from '../../src/render/dts/model.js';
import { scanDts } from '../../src/render/dts/scanner.js';
import { readFixture } from '../support/fixtures.js';
import { structured } from './helpers.js';

const lighthouse = readFixture(...structured('dts', 'Lighthouse.d.ts'));

describe('classView', () => {
  const file = scanDts(lighthouse);
  const main = defaultClass(file);

  it('follows the SansType half, the Superclass constant and the Properties and Events interfaces', () => {
    expect(main).toBeDefined();
    const view = classView(file, main!);
    expect(view.bases).toEqual(['EventedAccessor', 'LampMixin']);
    expect(view.members[0]?.name).toBe('type');
    expect(view.members).toHaveLength(15);
    expect(view.properties?.name).toBe('LighthouseProperties');
    expect(view.events?.name).toBe('LighthouseEvents');
    expect([...view.picked]).toEqual(['height', 'name']);
    expect(view.inheritedOptions).toEqual(['LampMixinProperties']);
    expect(view.complete).toBe(true);
  });

  it('names plain bases as written', () => {
    const plain = scanDts('export declare class A extends B<string> implements C, D {}');
    const [a] = plain.declarations;
    const view = classView(plain, a!);
    expect(view.bases).toEqual(['B<string>']);
    expect(a?.implements).toEqual(['C', 'D']);
    expect(view.picked.size).toBe(0);
  });
});

describe('rawMemberText', () => {
  const source = [
    'export default class Buoy {',
    '  /** Colour. */',
    '  colour: string;',
    '  /**',
    '   * Rings the bell.',
    '   */',
    '  ring(times: number): void;',
    '  drift(): void;',
    '  /** Lamp. */',
    '  get lit(): boolean;',
  ].join('\n');

  it('cuts from the JSDoc of a member to the next doc comment, de-indented', () => {
    expect(rawMemberText(source, 'ring')).toBe(
      '/**\n * Rings the bell.\n */\nring(times: number): void;\ndrift(): void;',
    );
    expect(rawMemberText(source, 'lit')).toBe('/** Lamp. */\nget lit(): boolean;');
  });

  it('starts at the declaration when no doc comment is attached', () => {
    expect(rawMemberText(source, 'drift')).toBe('drift(): void;');
  });

  it('returns undefined for a name that is not declared', () => {
    expect(rawMemberText(source, 'times')).toBeUndefined();
    expect(rawMemberText(source, 'a.b(')).toBeUndefined();
  });
});

describe('parseJsDoc', () => {
  it('returns an empty document for no comment', () => {
    expect(parseJsDoc(undefined)).toEqual({
      description: '',
      params: [],
      examples: [],
      see: [],
      throws: [],
      internal: false,
    });
  });

  it('strips the comment decoration and keeps Markdown', () => {
    expect(
      stripComment('/**\n   * First line.\n   *\n   * ```js\n   * a * b;\n   * ```\n   */'),
    ).toBe('First line.\n\n```js\na * b;\n```');
    expect(parseJsDoc('/** One line. */').description).toBe('One line.');
  });

  it('reads the supported block tags', () => {
    const doc = parseJsDoc(`/**
 * Measures {@link Lighthouse} range. See {@link https://example.com/r | the tables},
 * {@linkcode Beam.width} and {@linkplain Lamp the lamp}. Mail \\@keepers.
 *
 * @param {number} height - Tower height.
 * @param [weather="clear"] Sky condition.
 * @param options.silent No event.
 * @returns {Promise<number>} The range.
 * @throws When the lamp is off.
 * @since 1.2
 * @default 20
 * @see [Tables](https://example.com/tables)
 * @see {@link Beam}
 * @example <caption>Short</caption>
 * measure(20);
 * @example
 * \`\`\`ts
 * // @since inside a fence is code
 * measure(20, "fog");
 * \`\`\`
 * @customTag ignored
 */`);
    expect(doc.description).toBe(
      'Measures `Lighthouse` range. See [the tables](https://example.com/r),\n`Beam.width` and the lamp. Mail @keepers.',
    );
    expect(doc.params).toEqual([
      { name: 'height', type: 'number', description: 'Tower height.' },
      { name: 'weather', optional: true, default: '"clear"', description: 'Sky condition.' },
      { name: 'options.silent', description: 'No event.' },
    ]);
    expect(doc).toMatchObject({
      returns: 'The range.',
      throws: ['When the lamp is off.'],
      since: '1.2',
      default: '20',
      see: ['[Tables](https://example.com/tables)', '`Beam`'],
      internal: false,
    });
    expect(doc.examples).toEqual([
      '// Short\nmeasure(20);',
      '```ts\n// @since inside a fence is code\nmeasure(20, "fog");\n```',
    ]);
  });

  it('reads a deprecation note on the following lines, and a bare one', () => {
    expect(parseJsDoc('/**\n * @deprecated\n * Use beam.\n * It is newer.\n */').deprecated).toBe(
      'Use beam.\nIt is newer.',
    );
    expect(parseJsDoc('/** @deprecated */').deprecated).toBe(true);
  });

  it('marks internal members and keeps a scoped package name as prose', () => {
    expect(parseJsDoc('/** @internal */').internal).toBe(true);
    expect(parseJsDoc('/** Hidden. @hidden */').internal).toBe(false);
    expect(
      parseJsDoc('/**\n * Import it from\n * @example/core/Lighthouse.\n * @ignore\n */'),
    ).toMatchObject({
      description: 'Import it from\n@example/core/Lighthouse.',
      internal: true,
    });
  });
});
