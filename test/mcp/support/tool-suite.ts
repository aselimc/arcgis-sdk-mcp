/**
 * Shared set-up of the tool handler tests: one connected client per file, a call helper and
 * the invariants every structured result must satisfy.
 */
import { afterAll, beforeAll, expect } from 'vitest';
import type { ToolName } from '../../../src/core/names.js';
import { TOOL_DEFINITIONS } from '../../../src/mcp/tool-definitions.js';
import { type Connection, connectLegacy, firstText, type Harness, makeHarness } from './harness.js';

/** What a test looks at after a tool call. */
export interface Outcome {
  text: string;
  structured: Record<string, unknown> | undefined;
  meta: Record<string, unknown> | undefined;
  isError: boolean;
}

/** Every string stored under a key named `ref`, anywhere in a structured result. */
export function refsIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(refsIn);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, entry]) =>
    key === 'ref' && typeof entry === 'string' ? [entry] : refsIn(entry),
  );
}

/** Handle on the server under test; `harness` is available once the suite has started. */
export interface ToolSuite {
  readonly harness: Harness;
  call(this: void, name: ToolName, args?: Record<string, unknown>): Promise<Outcome>;
  /**
   * Asserts the invariants of a structured result (not an error, exactly the declared
   * output shape, every ref present in the text) and returns the structured content.
   */
  structuredOf(this: void, name: ToolName, outcome: Outcome): Record<string, unknown>;
}

/** Connects a client to a fresh harness for the enclosing `describe` block. */
export function useToolSuite(): ToolSuite {
  let harness: Harness | undefined;
  let connection: Connection | undefined;

  beforeAll(async () => {
    harness = makeHarness();
    connection = await connectLegacy(harness);
  });
  afterAll(() => connection?.close());

  return {
    get harness(): Harness {
      if (harness === undefined) throw new Error('the suite has not started');
      return harness;
    },
    async call(name, args = {}) {
      if (connection === undefined) throw new Error('the suite has not started');
      const result = await connection.client.callTool({ name, arguments: args });
      return {
        text: firstText(result),
        structured: result.structuredContent as Record<string, unknown> | undefined,
        meta: result._meta,
        isError: result.isError === true,
      };
    },
    structuredOf(name, outcome) {
      const schema = TOOL_DEFINITIONS.find((definition) => definition.name === name)?.outputSchema;
      expect(outcome.isError).toBe(false);
      // Parsing strips unknown keys: equality proves the result has exactly the declared shape.
      expect(schema?.parse(outcome.structured)).toEqual(outcome.structured);
      for (const ref of refsIn(outcome.structured)) {
        expect(outcome.text, `ref ${ref} in text`).toContain(ref);
      }
      return outcome.structured ?? {};
    },
  };
}
