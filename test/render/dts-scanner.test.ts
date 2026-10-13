import { describe, expect, it } from 'vitest';
import { defaultClass, publicExports } from '../../src/render/dts/model.js';
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

  it('treats code after a comment on the same line as starting the line', () => {
    // The compiler writes "*/ export declare function ..." when the comment ends the line before.
    const file = scanDts(
      'declare class A {}\n/**\n * Old name.\n */ export declare function b(): void;\n',
    );
    expect(file.declarations.map((item) => `${item.kind} ${item.name}`)).toEqual([
      'class A',
      'function b',
    ]);
    expect(file.declarations[1]?.jsdoc).toBe('/**\n * Old name.\n */');
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
