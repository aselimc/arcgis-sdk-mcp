import { describe, expect, it } from 'vitest';
import { parseJsDoc, stripComment } from '../../src/render/dts/jsdoc.js';
import {
  classView,
  defaultClass,
  publicExports,
  rawMemberText,
} from '../../src/render/dts/model.js';
import { scanDts } from '../../src/render/dts/scanner.js';
import { tokenize } from '../../src/render/dts/tokens.js';
import { readFixture } from '../support/fixtures.js';
import { structured } from './helpers.js';

const lighthouse = readFixture(...structured('dts', 'Lighthouse.d.ts'));

describe('tokenize', () => {
  it('keeps comments, strings and templates whole', () => {
    const tokens = tokenize('/** doc */ a: "x; }" // tail ; }\n`t ${ {a: 1}.a } }` /* c */ /**/');
    expect(tokens.map((token) => `${token.kind}:${token.text}`)).toEqual([
      'jsdoc:/** doc */',
      'word:a',
      'punct::',
      'string:"x; }"',
      'comment:// tail ; }',
      'string:`t ${ {a: 1}.a } }`',
      'comment:/* c */',
      'comment:/**/',
    ]);
  });

  it('reads arrows and spreads as single tokens and marks line starts', () => {
    const tokens = tokenize('  (...a: T[]) => void;\nnext');
    expect(tokens.map((token) => token.text)).toEqual([
      '(',
      '...',
      'a',
      ':',
      'T',
      '[',
      ']',
      ')',
      '=>',
      'void',
      ';',
      'next',
    ]);
    expect(tokens.filter((token) => token.lineStart).map((token) => token.text)).toEqual([
      '(',
      'next',
    ]);
  });

  it('survives unterminated strings and comments', () => {
    expect(tokenize('a: "open\nb').map((token) => token.text)).toEqual(['a', ':', '"open', 'b']);
    expect(tokenize('/** never closed').map((token) => token.kind)).toEqual(['jsdoc']);
    expect(tokenize("'esc\\'aped' `open").map((token) => token.text)).toEqual([
      "'esc\\'aped'",
      '`open',
    ]);
  });
});

describe('scanDts: declarations', () => {
  const file = scanDts(lighthouse);

  it('finds every top-level statement, including one without a semicolon', () => {
    expect(
      file.declarations
        .filter((item) => item.kind !== 'import')
        .map((item) => `${item.kind} ${item.name}`),
    ).toEqual([
      'interface LighthouseProperties',
      'interface LighthouseEvents',
      'class Lighthouse',
      'class __LighthouseSansType',
      'const LighthouseSuperclass',
    ]);
    expect(file.declarations.filter((item) => item.kind === 'import')).toHaveLength(7);
    expect(file.declarations.at(-1)?.text).toBe(
      'declare const LighthouseSuperclass: typeof EventedAccessor & typeof LampMixin',
    );
  });

  it('records export, default and heritage', () => {
    const main = file.declarations.find((item) => item.name === 'Lighthouse');
    expect(main).toMatchObject({
      exported: true,
      isDefault: true,
      head: 'export default class Lighthouse extends __LighthouseSansType',
      extends: ['__LighthouseSansType'],
      bodyParsed: true,
    });
    expect(main?.jsdoc?.startsWith('/**\n * A lighthouse stands')).toBe(true);
    const options = file.declarations.find((item) => item.name === 'LighthouseProperties');
    // A comma inside type arguments does not split the heritage list.
    expect(options?.extends).toEqual([
      'LampMixinProperties',
      'Partial<Pick<Lighthouse, "height" | "name">>',
    ]);
    expect(file.declarations.at(-1)?.exported).toBe(false);
  });

  it('splits a class body into members at depth 1, text verbatim', () => {
    const half = file.declarations.find((item) => item.name === '__LighthouseSansType');
    expect(half?.members.map((member) => `${member.kind} ${member.name}`)).toEqual([
      'property @eventTypes',
      'constructor constructor',
      'getter beam',
      'setter beam',
      'property height',
      'getter keepers',
      'property name',
      'property areas',
      'property count',
      'property _lamp',
      'method addKeeper',
      'method measureRange',
      'method extinguish',
      'method _rebuild',
    ]);
    const range = half?.members.find((member) => member.name === 'measureRange');
    expect(range?.text).toBe(
      'measureRange(weather?: "clear" | "fog"): Promise<{\n    range: number;\n    height: number | null;\n}>;',
    );
    expect(range).toMatchObject({
      params: 'weather?: "clear" | "fog"',
      type: 'Promise<{\n      range: number;\n      height: number | null;\n  }>',
    });
  });

  it('reads modifiers, optionality and types', () => {
    const half = file.declarations.find((item) => item.name === '__LighthouseSansType');
    const byName = (name: string, kind?: string): unknown =>
      half?.members.find(
        (member) => member.name === name && (kind === undefined || member.kind === kind),
      );
    expect(byName('height')).toMatchObject({
      modifiers: ['accessor'],
      type: 'number',
      optional: false,
    });
    expect(byName('areas')).toMatchObject({
      modifiers: ['readonly'],
      optional: true,
      type: 'string[] | null',
    });
    expect(byName('count')).toMatchObject({ modifiers: ['static'] });
    expect(byName('_lamp')).toMatchObject({ modifiers: ['private'], kind: 'property' });
    expect(byName('beam', 'setter')).toMatchObject({ type: 'BeamProperties | null | undefined' });
    expect(byName('beam', 'getter')).toMatchObject({ type: 'Beam | null | undefined' });
    expect(byName('constructor')).toMatchObject({ params: 'properties?: LighthouseProperties' });
  });

  it('attaches the JSDoc that directly precedes a member', () => {
    const half = file.declarations.find((item) => item.name === '__LighthouseSansType');
    expect(half?.members.find((member) => member.name === 'name')?.jsdoc).toBe(
      '/** Display name. */',
    );
    expect(half?.members.find((member) => member.kind === 'setter')?.jsdoc).toBeUndefined();
    expect(half?.members.find((member) => member.name === '_lamp')?.jsdoc).toBeUndefined();
  });
});

describe('scanDts: other shapes', () => {
  it('reads interfaces with call, index, generic, computed and quoted members', () => {
    const file = scanDts(`export interface Shapes<T extends object = {}> extends Base<T>, Other {
  (value: T): string;
  new (value: T): Shapes<T>;
  [key: string]: unknown;
  [Symbol.iterator](): Iterator<T>;
  map<U extends (a: T) => unknown>(fn: U): U[];
  get: Map<string, T>;
  static?: boolean,
  "quoted-name"!: number
}`);
    const [shapes] = file.declarations;
    expect(shapes).toMatchObject({
      kind: 'interface',
      name: 'Shapes',
      extends: ['Base<T>', 'Other'],
    });
    expect(shapes?.members.map((member) => `${member.kind} ${member.name}`)).toEqual([
      'call ',
      'method new',
      'index [key: string]',
      'method [Symbol.iterator]',
      'method map',
      'property get',
      'property static',
      'property quoted-name',
    ]);
    expect(shapes?.members[0]).toMatchObject({ params: 'value: T', type: 'string' });
    expect(shapes?.members[2]?.type).toBe('unknown');
    expect(shapes?.members[4]).toMatchObject({ params: 'fn: U', type: 'U[]' });
    expect(shapes?.members[5]).toMatchObject({ type: 'Map<string, T>', modifiers: [] });
    expect(shapes?.members[6]).toMatchObject({ optional: true, text: 'static?: boolean' });
  });

  it('reads enums, functions, types, namespaces and re-exports', () => {
    const file = scanDts(`export declare enum Flags {
    None = 0,
    Lit = 1 << 0,
    Named = "named"
}
export declare function sum(a: number,
  b: number): number;
export type Pair<A, B> =
  | [A, B]
  | { first: A; second: B };
declare namespace Internal { const x: number; }
export { sum as add };
export * from "./other.js";
declare class Hidden {}
export default Hidden;
export = Hidden;
`);
    expect(file.declarations.map((item) => `${item.kind} ${item.name}`)).toEqual([
      'enum Flags',
      'function sum',
      'type Pair',
      'namespace Internal',
      'export ',
      'export ',
      'class Hidden',
      'export Hidden',
      'export ',
    ]);
    expect(file.declarations[0]?.members.map((member) => member.text)).toEqual([
      'None = 0',
      'Lit = 1 << 0',
      'Named = "named"',
    ]);
    expect(file.declarations[2]?.text).toBe(
      'export type Pair<A, B> =\n  | [A, B]\n  | { first: A; second: B };',
    );
    expect(file.declarations[3]).toMatchObject({ head: 'declare namespace Internal', members: [] });
    // `export default Hidden;` marks the class it names.
    expect(defaultClass(file)?.name).toBe('Hidden');
    expect(publicExports(file).map((item) => item.name)).toEqual(['Flags', 'sum', 'Pair']);
  });

  it('normalises CRLF and ignores a byte-order mark', () => {
    const file = scanDts('﻿export declare const A: number;\r\nexport declare const B: string;\r\n');
    expect(file.declarations.map((item) => item.text)).toEqual([
      'export declare const A: number;',
      'export declare const B: string;',
    ]);
  });

  it('reports an unbalanced body instead of throwing', () => {
    const file = scanDts('export default class Open {\n  a: number;\n  b(): void;\n');
    expect(file.declarations[0]).toMatchObject({ bodyParsed: false });
    expect(file.declarations[0]?.members.map((member) => member.name)).toEqual(['a', 'b']);
  });

  it('keeps a member it cannot classify as raw text', () => {
    const file = scanDts('interface Odd {\n  + weird;\n  fine: number;\n  [broken: string;\n}');
    expect(
      file.declarations[0]?.members.map((member) => [
        member.kind,
        member.raw === true,
        member.text,
      ]),
    ).toEqual([
      ['unknown', true, '+ weird;'],
      ['property', false, 'fine: number;'],
      ['unknown', true, '[broken: string;\n}'],
    ]);
  });

  it('recovers at the next doc comment when a member loses a bracket', () => {
    const file = scanDts(readFixture(...structured('dts', 'Broken.d.ts')));
    const [buoy] = file.declarations;
    expect(buoy?.bodyParsed).toBe(false);
    expect(buoy?.members.map((member) => [member.name, member.kind])).toEqual([
      ['colour', 'property'],
      ['mooring', 'unknown'],
      ['ring', 'method'],
      ['lit', 'getter'],
    ]);
    expect(buoy?.members[1]).toMatchObject({
      raw: true,
      text: 'mooring(options: { depth: number; ): Promise<void>;',
    });
  });

  it('does not mistake the doc comment of an inline property for a new member', () => {
    const file = scanDts(`interface Options {
  /** Where to look. */
  area: {
    /** Left edge. */
    xmin: number;
  };
  /** How many. */
  count: number;
}`);
    expect(file.declarations[0]?.members.map((member) => member.name)).toEqual(['area', 'count']);
    expect(file.declarations[0]?.members[0]?.text).toContain('/** Left edge. */');
  });
});

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
