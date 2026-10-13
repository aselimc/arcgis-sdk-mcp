/**
 * The same server factory over both protocol eras: the 2025 `initialize` handshake on an
 * in-memory transport pair, and the 2026-07-28 `server/discover` negotiation against the
 * HTTP handler's `fetch` (called in process; no socket is opened).
 */
import { ProtocolError } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOOL_ORDER, TOOLS } from '../../src/core/names.js';
import { INSTRUCTIONS_MAX_CHARS } from '../../src/mcp/instructions.js';
import { TOOL_DEFINITIONS } from '../../src/mcp/tool-definitions.js';
import { REFS } from '../mcp/support/catalogue.js';
import {
  type Connection,
  connectLegacy,
  connectModern,
  firstText,
  type Harness,
  makeHarness,
} from '../mcp/support/harness.js';

const ERAS = [
  { era: 'legacy', connect: connectLegacy, version: /^2025-/ },
  { era: 'modern', connect: connectModern, version: /^2026-/ },
] as const;

describe.each(ERAS)('protocol era $era', ({ era, connect, version }) => {
  let harness: Harness;
  let connection: Connection;

  beforeAll(async () => {
    harness = makeHarness();
    connection = await connect(harness);
  });
  afterAll(() => connection.close());

  it('negotiates the era and identifies the server', () => {
    const { client } = connection;
    expect(client.getProtocolEra()).toBe(era);
    expect(client.getNegotiatedProtocolVersion()).toMatch(version);
    expect(client.getServerVersion()).toMatchObject({
      name: 'arcgis-sdk-docs',
      title: 'ArcGIS SDK and Developer Docs (unofficial)',
      version: '0.0.0-test',
    });
  });

  it('delivers the instructions within the size hosts accept', () => {
    const instructions = connection.client.getInstructions() ?? '';
    expect(instructions).toMatch(/^Unofficial ArcGIS developer documentation server\./);
    expect(instructions.length).toBeLessThanOrEqual(INSTRUCTIONS_MAX_CHARS);
  });

  it('lists the tools in order with annotations and schemas', async () => {
    const { tools } = await connection.client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([...TOOL_ORDER]);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      expect(tool.inputSchema.type, tool.name).toBe('object');
    }
    expect(tools.filter((tool) => tool.outputSchema !== undefined)).toHaveLength(4);
  });

  it.each([
    [TOOLS.listProducts, {}],
    [TOOLS.listProducts, { product: 'javascript' }],
    [TOOLS.listProducts, { product: 'js-maps-sdk', section: 'guide' }],
    [TOOLS.getVersions, { product: 'js-maps-sdk' }],
    [TOOLS.search, { query: 'query features' }],
    [TOOLS.findSamples, { query: 'cluster', with_code: true }],
  ] as const)(
    '%s %j returns structuredContent that conforms to its output schema',
    async (name, args) => {
      // The client validates structuredContent against the listed outputSchema as well.
      await connection.client.listTools();
      const result = await connection.client.callTool({ name, arguments: args });
      const schema = TOOL_DEFINITIONS.find((definition) => definition.name === name)?.outputSchema;
      expect(result.isError).not.toBe(true);
      expect(schema?.parse(result.structuredContent)).toEqual(result.structuredContent);
      expect(firstText(result).length).toBeGreaterThan(0);
    },
  );

  it('returns text only from the two document tools', async () => {
    const read = await connection.client.callTool({
      name: TOOLS.read,
      arguments: { ref: REFS.page },
    });
    expect(read.structuredContent).toBeUndefined();
    expect(read._meta).toMatchObject({
      'arcgis-docs/ref': REFS.page,
      'arcgis-docs/truncated': false,
    });
    expect(firstText(read)).toMatch(/\nSource: Esri, /);
    const lookup = await connection.client.callTool({
      name: TOOLS.lookupSymbol,
      arguments: { symbol: 'FeatureLayer' },
    });
    expect(lookup.structuredContent).toBeUndefined();
    expect(firstText(lookup)).toContain('class FeatureLayer extends Layer');
  });

  it('applies the schema defaults before the handler runs', async () => {
    const seen: unknown[] = [];
    const read = harness.services.docs.read.bind(harness.services.docs);
    harness.services.docs.read = async (req, options) => {
      seen.push(req);
      return read(req, options);
    };
    await connection.client.callTool({ name: TOOLS.read, arguments: { ref: REFS.page } });
    // The default max_tokens of 6000, less the room the tool keeps for the envelope.
    expect(seen).toEqual([{ ref: REFS.page, view: 'auto', maxTokens: 5800 }]);
    harness.services.docs.read = read;
  });

  it('reports invalid arguments as a self-correcting tool error', async () => {
    const result = await connection.client.callTool({
      name: TOOLS.read,
      arguments: { ref: REFS.page, max_tokens: 5 },
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/max_tokens/);
    expect(firstText(result)).toMatch(/Invalid arguments for tool arcgis_docs_read/);
  });

  it('reports a catalogued failure as Error [CODE] with a Next: recovery', async () => {
    const result = await connection.client.callTool({
      name: TOOLS.read,
      arguments: { ref: REFS.missing },
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/^Error \[DOC_NOT_FOUND\]: .+\. Next: .+\.$/);
  });

  it('reports a thrown error as INTERNAL without a stack trace', async () => {
    const result = await connection.client.callTool({
      name: TOOLS.read,
      arguments: { ref: REFS.crash },
    });
    expect(result.isError).toBe(true);
    const text = firstText(result);
    expect(text).toMatch(/^Error \[INTERNAL\]: Internal error \(ref [0-9a-f]+\)\. Next: /);
    expect(text).not.toMatch(/kaboom|\bat .+:\d+/);
  });

  it('rejects an unknown tool at the protocol level', async () => {
    const outcome = await connection.client
      .callTool({ name: 'arcgis_docs_status', arguments: {} })
      .then(
        (result) => ({ isError: result.isError === true, text: firstText(result) }),
        (error: unknown) => ({ isError: true, text: (error as Error).message }),
      );
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain('arcgis_docs_status');
  });

  it('lists and reads resources', async () => {
    const { resources } = await connection.client.listResources();
    expect(resources.map((resource) => resource.uri)).toEqual([
      'arcgis-docs://catalog',
      'arcgis-docs://status',
      'arcgis-docs://brief/ai/overview',
    ]);
    const { resourceTemplates } = await connection.client.listResourceTemplates();
    expect(resourceTemplates.map((template) => template.uriTemplate)).toEqual([
      'arcgis-docs://product/{id}',
      'arcgis-docs://brief/{+slug}',
    ]);
    for (const uri of [
      'arcgis-docs://catalog',
      'arcgis-docs://status',
      'arcgis-docs://brief/ai/overview',
      'arcgis-docs://product/js-maps-sdk',
    ]) {
      const { contents } = await connection.client.readResource({ uri });
      expect(contents).toHaveLength(1);
      expect(contents[0]).toMatchObject({ uri });
      expect((contents[0] as { text: string }).text.length).toBeGreaterThan(20);
    }
  });

  it('answers an unknown resource with a protocol error', async () => {
    await expect(
      connection.client.readResource({ uri: 'arcgis-docs://product/no-such-product' }),
    ).rejects.toBeInstanceOf(ProtocolError);
    await expect(
      connection.client.readResource({ uri: 'arcgis-docs://nothing' }),
    ).rejects.toBeInstanceOf(ProtocolError);
  });

  it('lists and gets prompts', async () => {
    const { prompts } = await connection.client.listPrompts();
    expect(prompts.map((prompt) => prompt.name)).toEqual([
      'arcgis_app_kickoff',
      'arcgis_upgrade_review',
      'arcgis_agentic_app_design',
      'arcgis_project_instructions',
    ]);
    const kickoff = await connection.client.getPrompt({
      name: 'arcgis_app_kickoff',
      arguments: { goal: 'a web map with clustering' },
    });
    expect(kickoff.messages).toHaveLength(1);
    expect(kickoff.messages[0]).toMatchObject({ role: 'user', content: { type: 'text' } });
    const instructions = await connection.client.getPrompt({
      name: 'arcgis_project_instructions',
      arguments: { product: 'widgets-sdk' },
    });
    expect(instructions.messages[0]?.content).toMatchObject({ type: 'text' });
    await expect(
      connection.client.getPrompt({ name: 'arcgis_upgrade_review', arguments: {} }),
    ).rejects.toThrow();
  });
});

describe('server factory', () => {
  it('serves both eras from one container without touching the services at start-up', async () => {
    const harness = makeHarness();
    let touched = 0;
    const container = {
      ctx: harness.ctx,
      get services() {
        touched += 1;
        return harness.services;
      },
    };
    const legacy = await connectLegacy(container);
    const modern = await connectModern(container);
    await legacy.client.listTools();
    await modern.client.listTools();
    await modern.client.listPrompts();
    expect(touched).toBe(0);
    expect(harness.ctx.http.count()).toBe(0);

    await legacy.client.callTool({ name: TOOLS.listProducts, arguments: {} });
    await modern.client.callTool({ name: TOOLS.listProducts, arguments: {} });
    expect(touched).toBe(2);
    await legacy.close();
    await modern.close();
  });
});
