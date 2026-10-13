/**
 * Blank arguments (`src/mcp/blank-args.ts`): an argument the caller may leave out behaves
 * as left out when it is empty, whitespace only or `null`, in every tool.
 */
import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import { TOOLS, type ToolName } from '../../src/core/names.js';
import { blankTolerant, withoutBlanks } from '../../src/mcp/blank-args.js';
import { TOOL_DEFINITIONS } from '../../src/mcp/tool-definitions.js';
import { REFS } from './support/catalogue.js';
import { useToolSuite } from './support/tool-suite.js';

/** The least each tool needs to answer: its required arguments. */
const REQUIRED: Record<ToolName, Record<string, unknown>> = {
  [TOOLS.listProducts]: {},
  [TOOLS.getVersions]: {},
  [TOOLS.search]: { query: 'query features' },
  [TOOLS.read]: { ref: REFS.page },
  [TOOLS.lookupSymbol]: { symbol: 'FeatureLayer' },
  [TOOLS.findSamples]: { query: 'cluster' },
};

/** The arguments of a tool that a caller may leave out. */
function omissible(name: ToolName): string[] {
  const definition = TOOL_DEFINITIONS.find((candidate) => candidate.name === name);
  if (definition === undefined) throw new Error(`no definition of ${name}`);
  const shape: Record<string, z.ZodType> = definition.inputSchema.shape;
  return Object.keys(shape).filter((key) => shape[key]?.safeParse(undefined).success === true);
}

describe('blank arguments', () => {
  const { call } = useToolSuite();

  it('covers every argument a caller may leave out, in all six tools', () => {
    expect(TOOL_DEFINITIONS.map((definition) => definition.name)).toEqual(Object.values(TOOLS));
    for (const { name, inputSchema } of TOOL_DEFINITIONS) {
      // Every argument is either required (and given below) or exercised as a blank.
      expect([...Object.keys(REQUIRED[name]), ...omissible(name)].sort(), name).toEqual(
        Object.keys(inputSchema.shape).sort(),
      );
      expect(omissible(name).length, name).toBeGreaterThan(1);
    }
  });

  // Regression: `product: ""` was UNKNOWN_PRODUCT in one tool and "no product" in another,
  // `cursor: ""` was CURSOR_EXPIRED, `version: ""` answered from another source, and the
  // empty values were echoed in status lines and continuation calls.
  describe.each(Object.values(TOOLS))('%s', (name) => {
    it.each([
      ['empty strings', ''],
      ['whitespace', ' \t\n'],
      ['null', null],
    ])('answers a call with %s exactly like the call without them', async (_label, blank) => {
      const required = REQUIRED[name];
      const expected = await call(name, required);
      expect(expected.isError).toBe(false);
      const blanks = Object.fromEntries(omissible(name).map((key) => [key, blank]));
      const outcome = await call(name, { ...blanks, ...required });
      expect(outcome).toEqual(expected);
    });
  });

  it('trims the values it keeps, so a padded argument is the argument', async () => {
    const padded = await call(TOOLS.search, { query: '  many ', product: ' javascript\n' });
    const plain = await call(TOOLS.search, { query: 'many', product: 'javascript' });
    expect(padded).toEqual(plain);
    expect(padded.text).toContain('arcgis_docs_search({"query":"many","product":"javascript",');
  });

  it('still rejects a required argument that is blank, and names it', async () => {
    for (const [name, key] of [
      [TOOLS.search, 'query'],
      [TOOLS.read, 'ref'],
      [TOOLS.lookupSymbol, 'symbol'],
      [TOOLS.findSamples, 'query'],
    ] as const) {
      for (const blank of ['', '   ', null]) {
        const outcome = await call(name, { [key]: blank });
        expect(outcome.isError, `${name} ${JSON.stringify(blank)}`).toBe(true);
        expect(outcome.text).toContain(`Invalid arguments for tool ${name}`);
        expect(outcome.text).toContain(key);
      }
    }
  });

  it('does not echo a blank argument in the recovery of an error', async () => {
    const outcome = await call(TOOLS.listProducts, { product: 'js-maps-sdx', query: ' ' });
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain('Next: ');
    expect(outcome.text).not.toContain('""');
  });
});

describe('withoutBlanks', () => {
  const optional = new Set(['product', 'limit']);

  it('removes blank optional values, trims strings and keeps everything else', () => {
    expect(
      withoutBlanks(optional, {
        query: '  map ',
        product: ' ',
        limit: null,
        flag: false,
        count: 0,
        list: [' a '],
      }),
    ).toEqual({ query: 'map', flag: false, count: 0, list: [' a '] });
    expect(withoutBlanks(optional, { query: '', product: 'x', limit: 3 })).toEqual({
      query: '',
      product: 'x',
      limit: 3,
    });
  });

  it('leaves anything that is not an object of arguments for the schema to reject', () => {
    for (const value of [undefined, null, 'text', 7, ['product']]) {
      expect(withoutBlanks(optional, value)).toBe(value);
    }
  });

  it('copies own keys only, whatever they are called', () => {
    const args = JSON.parse('{"__proto__":"","constructor":" x ","product":""}') as object;
    const cleaned = withoutBlanks(new Set(['product', '__proto__']), args) as object;
    expect(Object.keys(cleaned)).toEqual(['constructor']);
    expect(Object.getPrototypeOf(cleaned)).toBe(Object.prototype);
  });
});

describe('blankTolerant', () => {
  const schema = z.object({
    query: z.string().min(2),
    kind: z.enum(['guide', 'api']).optional(),
    detail: z.enum(['short', 'long']).default('short'),
    limit: z.number().int().min(1).default(8),
  });
  const tolerant = blankTolerant(schema);

  it('lets a blank optional enum or number fall back to absence or its default', () => {
    expect(tolerant.parse({ query: ' ab ', kind: '', detail: ' ', limit: null })).toEqual({
      query: 'ab',
      detail: 'short',
      limit: 8,
    });
    expect(tolerant.safeParse({ query: ' a ' }).success).toBe(false);
    expect(tolerant.safeParse({ query: 'ab', kind: 'other' }).success).toBe(false);
  });

  it('is published with the JSON Schema of the schema it wraps', () => {
    expect(z.toJSONSchema(tolerant, { io: 'input' })).toEqual(
      z.toJSONSchema(schema, { io: 'input' }),
    );
  });
});
