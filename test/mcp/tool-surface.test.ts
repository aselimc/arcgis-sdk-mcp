import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import { TOOL_ORDER, TOOLS } from '../../src/core/names.js';
import { MAX_RESULT_SIZE_META_KEY, READ_ONLY_ANNOTATIONS } from '../../src/mcp/annotations.js';
import { TOOL_DEFINITIONS } from '../../src/mcp/tool-definitions.js';
import { type Connection, connectLegacy, makeHarness } from './support/harness.js';

type ListedTools = Awaited<ReturnType<Connection['client']['listTools']>>['tools'];

describe('tools/list', () => {
  let connection: Connection;
  let tools: ListedTools;

  beforeAll(async () => {
    connection = await connectLegacy(makeHarness());
    tools = (await connection.client.listTools()).tools;
  });
  afterAll(() => connection.close());

  it('lists the six tools in the fixed order', () => {
    expect(tools.map((tool) => tool.name)).toEqual([...TOOL_ORDER]);
    expect(TOOL_DEFINITIONS.map((definition) => definition.name)).toEqual([...TOOL_ORDER]);
  });

  it('matches the snapshot of names, titles, annotations and schemas', () => {
    expect(
      tools.map(({ name, title, annotations, inputSchema, outputSchema, _meta }) => ({
        name,
        title,
        annotations,
        _meta,
        inputSchema,
        outputSchema,
      })),
    ).toMatchSnapshot();
  });

  it('gives every tool a title and the read-only annotations', () => {
    for (const tool of tools) {
      expect(tool.title, tool.name).toBeTruthy();
      expect(tool.annotations, tool.name).toEqual(READ_ONLY_ANNOTATIONS);
    }
    expect(READ_ONLY_ANNOTATIONS).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });

  it('keeps descriptions descriptive and within 1,000 characters', () => {
    for (const tool of tools) {
      const description = tool.description ?? '';
      expect(description.length, tool.name).toBeGreaterThan(100);
      expect(description.length, tool.name).toBeLessThanOrEqual(1000);
      // Workflow guidance belongs to the server instructions, not to tool descriptions.
      expect(description, tool.name).not.toMatch(/\b(always|must|never)\b/i);
    }
  });

  it('declares an output schema on the four structured tools only', () => {
    const structured = tools.filter((tool) => tool.outputSchema !== undefined);
    expect(structured.map((tool) => tool.name)).toEqual([
      TOOLS.listProducts,
      TOOLS.getVersions,
      TOOLS.search,
      TOOLS.findSamples,
    ]);
  });

  it('raises the result size cap on the two tools that return document bodies', () => {
    for (const tool of tools) {
      const large = tool.name === TOOLS.read || tool.name === TOOLS.lookupSymbol;
      expect(tool._meta?.[MAX_RESULT_SIZE_META_KEY], tool.name).toBe(large ? 100_000 : undefined);
    }
  });

  it('describes every input property except the self-explanatory limit', () => {
    for (const tool of tools) {
      const properties = (tool.inputSchema.properties ?? {}) as Record<
        string,
        { description?: string }
      >;
      for (const [name, property] of Object.entries(properties)) {
        if (tool.name === TOOLS.listProducts && name === 'limit') continue;
        expect(property.description, `${tool.name}.${name}`).toBeTruthy();
      }
    }
  });

  it('requires only the arguments without which a call means nothing', () => {
    const required = Object.fromEntries(
      tools.map((tool) => [tool.name, tool.inputSchema.required ?? []]),
    );
    expect(required).toEqual({
      [TOOLS.listProducts]: [],
      [TOOLS.getVersions]: [],
      [TOOLS.search]: ['query'],
      [TOOLS.read]: ['ref'],
      [TOOLS.lookupSymbol]: ['symbol'],
      [TOOLS.findSamples]: ['query'],
    });
  });

  it('costs an agent under 2,600 tokens for names, descriptions and input schemas', () => {
    const chars = TOOL_DEFINITIONS.reduce((sum, definition) => {
      const { $schema: _dialect, ...schema } = z.toJSONSchema(definition.inputSchema, {
        io: 'input',
      });
      return (
        sum +
        JSON.stringify({
          name: definition.name,
          description: definition.description,
          inputSchema: schema,
        }).length
      );
    }, 0);
    expect(Math.ceil(chars / 4)).toBeLessThan(2600);
  });
});
