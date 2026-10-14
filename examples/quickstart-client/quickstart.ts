/**
 * Quickstart: drives the built arcgis-sdk-mcp server over stdio with the official MCP
 * TypeScript client, the way a coding agent would, and prints a tidy transcript.
 *
 * The task: "add clustered points with popups to a web map". The script picks the product,
 * checks its version, searches the docs, looks up the API it will use and finds a runnable
 * sample. Each step reads the previous step's structured result instead of hard-coding it.
 *
 * Usage (from the repository root, after `npm ci` and `npm run build`):
 *   npx tsx examples/quickstart-client/quickstart.ts          trimmed transcript
 *   npx tsx examples/quickstart-client/quickstart.ts --full   every line the server returned
 *
 * Every call goes to Esri's public documentation sites (or your local cache). Set
 * GITHUB_TOKEN to raise the GitHub API quota; no other configuration is needed.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { trim } from '../shared/trim.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const SERVER = resolve(HERE, '..', '..', 'dist', 'cli', 'main.js');
const FULL = process.argv.includes('--full');

/** The parts of a tool result this script reads. */
interface ToolResult {
  text: string;
  structured: Record<string, unknown> | undefined;
  isError: boolean;
}

async function call(
  client: Client,
  step: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  console.log(`\n${step}`);
  console.log(`> ${name} ${JSON.stringify(args)}`);
  const started = Date.now();
  const result = await client.callTool({ name, arguments: args });
  const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
  const text = content.map((part) => (part.type === 'text' ? (part.text ?? '') : '')).join('\n');
  const shown = FULL ? text : trim(text);
  console.log(
    shown
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n')
      .trimEnd(),
  );
  console.log(`  (${Date.now() - started} ms)`);
  return {
    text,
    structured: result.structuredContent as Record<string, unknown> | undefined,
    isError: result.isError === true,
  };
}

/** Reads `obj.key[0].field` from a structured result without trusting its shape. */
function firstOf(obj: Record<string, unknown> | undefined, key: string, field: string): unknown {
  const list = obj?.[key];
  if (!Array.isArray(list) || list.length === 0) return undefined;
  const first: unknown = list[0];
  return typeof first === 'object' && first !== null
    ? (first as Record<string, unknown>)[field]
    : undefined;
}

async function main(): Promise<number> {
  if (!existsSync(SERVER)) {
    console.error('dist/cli/main.js is missing: run "npm run build" in the repository root.');
    return 2;
  }
  const client = new Client({ name: 'arcgis-sdk-mcp-quickstart', version: '0.1.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [SERVER],
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
      // No package manifests here, so no detected project SDK steers the answers.
      cwd: HERE,
      stderr: 'inherit',
    }),
  );

  try {
    const server = client.getServerVersion();
    const { tools } = await client.listTools();
    console.log('arcgis-sdk-mcp quickstart: one agent task, five tool calls, over MCP stdio');
    console.log(`Server: ${server?.name ?? '?'} ${server?.version ?? '?'}`);
    console.log(`Tools:  ${tools.map((tool) => tool.name).join(', ')}`);
    console.log('Task:   add clustered points with popups to a web map');

    // 1. Which product? The agent only knows the user wants a web map in JavaScript.
    const products = await call(client, '[1/5] Pick the product', 'arcgis_docs_list_products', {
      query: 'web map javascript',
      limit: 3,
    });
    const product = firstOf(products.structured, 'products', 'id');
    if (typeof product !== 'string') throw new Error('list_products returned no product');
    console.log(`  -> using "${product}" (structuredContent.products[0].id)`);

    // 2. Which version do the docs describe, and what does npm install today?
    const versions = await call(client, '[2/5] Check the version', 'arcgis_docs_get_versions', {
      product,
    });
    const documented = firstOf(versions.structured, 'products', 'documented') as
      { version?: string } | undefined;
    console.log(
      `  -> docs describe ${documented?.version ?? 'an unknown version'} (structuredContent.products[0].documented.version)`,
    );

    // 3. Where is this explained?
    const search = await call(client, '[3/5] Search the docs', 'arcgis_docs_search', {
      query: 'cluster points popup',
      product,
      limit: 4,
    });
    const hit = firstOf(search.structured, 'results', 'ref');
    if (typeof hit === 'string') console.log(`  -> best hit: ${hit}`);

    // 4. The exact API, instead of a remembered one.
    await call(client, '[4/5] Look up the API', 'arcgis_docs_lookup_symbol', {
      symbol: 'FeatureLayer.featureReduction',
      product,
      detail: 'signature',
    });

    // 5. A runnable sample to start from.
    const samples = await call(client, '[5/5] Find a sample', 'arcgis_docs_find_samples', {
      query: 'clustering',
      product,
      limit: 3,
    });
    const sample = firstOf(samples.structured, 'results', 'ref');
    if (typeof sample === 'string') {
      console.log(`  -> next an agent would read its code:`);
      console.log(`     arcgis_docs_read {"ref":"${sample}","section":"source"}`);
    }
    console.log('\nDone. Every answer named its product, version and source URL.');
    return 0;
  } finally {
    await client.close();
  }
}

process.exitCode = await main();
