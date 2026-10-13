import { describe, expect, it } from 'vitest';
import {
  manifestSignature,
  manifestType,
  printSignature,
  printType,
  printTypeParameters,
} from '../../src/render/type-printer.js';

const named = (name: string, typeArguments?: unknown[]): unknown => ({
  type: 'reference',
  name,
  ...(typeArguments === undefined ? {} : { typeArguments }),
});
const intrinsic = (name: string): unknown => ({ type: 'intrinsic', name });
const literal = (value: unknown): unknown => ({ type: 'literal', value });
const union = (...types: unknown[]): unknown => ({ type: 'union', types });

describe('printType', () => {
  it.each([
    [intrinsic('string'), 'string'],
    [named('Promise', [intrinsic('void')]), 'Promise<void>'],
    [named('Map', [intrinsic('string'), named('Item')]), 'Map<string, Item>'],
    [literal('m'), '"m"'],
    [literal(3), '3'],
    [literal(null), 'null'],
    [literal(true), 'true'],
    [literal({ value: '12', negative: true }), '-12n'],
    [{ type: 'array', elementType: intrinsic('number') }, 'number[]'],
    [union(intrinsic('string'), literal(null)), 'string | null'],
    [{ type: 'intersection', types: [named('A'), named('B')] }, 'A & B'],
    [{ type: 'tuple', elements: [intrinsic('number'), intrinsic('string')] }, '[number, string]'],
    [{ type: 'tuple' }, '[]'],
    [
      {
        type: 'tuple',
        elements: [
          { type: 'namedTupleMember', name: 'x', element: intrinsic('number') },
          { type: 'namedTupleMember', name: 'y', isOptional: true, element: intrinsic('number') },
          { type: 'rest', elementType: { type: 'array', elementType: intrinsic('string') } },
          { type: 'optional', elementType: intrinsic('boolean') },
        ],
      },
      '[x: number, y?: number, ...string[], boolean?]',
    ],
    [{ type: 'typeOperator', operator: 'keyof', target: named('Options') }, 'keyof Options'],
    [
      {
        type: 'typeOperator',
        operator: 'readonly',
        target: { type: 'array', elementType: named('T') },
      },
      'readonly T[]',
    ],
    [
      { type: 'indexedAccess', objectType: named('Options'), indexType: literal('units') },
      'Options["units"]',
    ],
    [{ type: 'query', queryType: named('defaults') }, 'typeof defaults'],
    [{ type: 'predicate', name: 'value', targetType: named('Date') }, 'value is Date'],
    [{ type: 'predicate', name: 'value', asserts: true }, 'asserts value'],
    [{ type: 'inferred', name: 'U' }, 'infer U'],
    [{ type: 'unknown', name: 'unique symbol' }, 'unique symbol'],
    [
      { type: 'templateLiteral', head: 'tide-', tail: [[intrinsic('string'), '-level']] },
      '`tide-${string}-level`',
    ],
    [undefined, 'unknown'],
    [{ type: 'somethingNew' }, 'unknown'],
    [{ type: 'somethingNew', name: 'Named' }, 'Named'],
  ])('prints %j as %s', (type, expected) => {
    expect(printType(type)).toBe(expected);
  });

  it('adds parentheses where precedence needs them', () => {
    expect(
      printType({ type: 'array', elementType: union(intrinsic('string'), intrinsic('number')) }),
    ).toBe('(string | number)[]');
    expect(
      printType(union({ type: 'intersection', types: [named('A'), named('B')] }, named('C'))),
    ).toBe('A & B | C');
    expect(
      printType({ type: 'intersection', types: [union(named('A'), named('B')), named('C')] }),
    ).toBe('(A | B) & C');
    expect(
      printType({ type: 'typeOperator', operator: 'keyof', target: union(named('A'), named('B')) }),
    ).toBe('keyof (A | B)');
    expect(
      printType({
        type: 'indexedAccess',
        objectType: union(named('A'), named('B')),
        indexType: literal('k'),
      }),
    ).toBe('(A | B)["k"]');
  });

  it('prints conditional and mapped types', () => {
    expect(
      printType({
        type: 'conditional',
        checkType: named('T'),
        extendsType: { type: 'array', elementType: { type: 'inferred', name: 'U' } },
        trueType: named('U'),
        falseType: intrinsic('never'),
      }),
    ).toBe('T extends (infer U)[] ? U : never');
    expect(
      printType({
        type: 'mapped',
        parameter: 'K',
        parameterType: { type: 'typeOperator', operator: 'keyof', target: named('T') },
        templateType: { type: 'indexedAccess', objectType: named('T'), indexType: named('K') },
        readonlyModifier: '+',
        optionalModifier: '-',
        nameType: named('Renamed'),
      }),
    ).toBe('{ readonly [K in keyof T as Renamed]-?: T[K] }');
    expect(
      printType({
        type: 'mapped',
        parameter: 'K',
        parameterType: named('Keys'),
        templateType: intrinsic('string'),
      }),
    ).toBe('{ [K in Keys]: string }');
  });

  it('prints inline object, function and index-signature types', () => {
    const callable = {
      type: 'reflection',
      declaration: {
        signatures: [
          { parameters: [{ name: 'level', type: intrinsic('number') }], type: intrinsic('void') },
        ],
      },
    };
    expect(printType(callable)).toBe('(level: number) => void');
    // A function type inside a union or an array needs parentheses.
    expect(printType(union(callable, literal(null)))).toBe('((level: number) => void) | null');
    expect(printType({ type: 'array', elementType: callable })).toBe('((level: number) => void)[]');
    expect(
      printType({
        type: 'reflection',
        declaration: {
          children: [
            { name: 'from', flags: { isReadonly: true }, type: named('Date') },
            { name: 'to', flags: { isOptional: true }, type: named('Date') },
            { name: 'not-an-identifier', flags: {}, type: intrinsic('string') },
            { name: 'ring', flags: {}, signatures: [{ parameters: [], type: intrinsic('void') }] },
          ],
          indexSignatures: [
            {
              parameters: [{ name: 'key', type: intrinsic('string') }],
              type: intrinsic('unknown'),
            },
          ],
          signatures: [
            { parameters: [], type: intrinsic('string') },
            { parameters: [{ name: 'a', type: intrinsic('number') }], type: intrinsic('string') },
          ],
        },
      }),
    ).toBe(
      '{ (): string; (a: number): string; [key: string]: unknown; readonly from: Date; to?: Date; "not-an-identifier": string; ring(): void }',
    );
    expect(printType({ type: 'reflection', declaration: {} })).toBe('{}');
  });
});

describe('printSignature and printTypeParameters', () => {
  it('prints parameters with rest, optional and default markers', () => {
    expect(
      printSignature('measure', {
        typeParameters: [
          { name: 'T', type: named('Base'), default: named('Fallback') },
          { name: 'U' },
        ],
        parameters: [
          { name: 'value', type: named('T') },
          { name: 'precision', type: intrinsic('number'), defaultValue: '2' },
          { name: 'flag', flags: { isOptional: true }, type: intrinsic('boolean') },
          {
            name: 'rest',
            flags: { isRest: true },
            type: { type: 'array', elementType: named('U') },
          },
        ],
        type: named('T'),
      }),
    ).toBe(
      'measure<T extends Base = Fallback, U>(value: T, precision?: number, flag?: boolean, ...rest: U[]): T',
    );
  });

  it('defaults the return type to void and can leave it out', () => {
    expect(printSignature('ring', {})).toBe('ring(): void');
    expect(printSignature('constructor', { type: named('Clock') }, null)).toBe('constructor()');
    expect(printSignature('', { type: intrinsic('number') }, ' => ')).toBe('() => number');
  });

  it('reads the single typeParameter of older schemas', () => {
    expect(printTypeParameters({ typeParameter: [{ name: 'T' }] })).toBe('<T>');
    expect(printTypeParameters({})).toBe('');
  });
});

describe('manifest types', () => {
  it('reads the text of a manifest type', () => {
    expect(manifestType({ text: 'string | undefined' })).toBe('string | undefined');
    expect(manifestType({})).toBeUndefined();
    expect(manifestType(undefined)).toBeUndefined();
  });

  it('prefers the precomputed signature, else builds one', () => {
    expect(manifestSignature('refresh', { signature: '(): Promise<void>' })).toBe(
      'refresh(): Promise<void>',
    );
    expect(
      manifestSignature('setRange', {
        parameters: [
          { name: 'low', type: { text: 'number' } },
          { name: 'high', optional: true },
          { name: 'more', rest: true, type: { text: 'number[]' } },
        ],
        return: { type: { text: 'void' } },
      }),
    ).toBe('setRange(low: number, high?, ...more: number[]): void');
    expect(manifestSignature('noop', {})).toBe('noop()');
  });
});
