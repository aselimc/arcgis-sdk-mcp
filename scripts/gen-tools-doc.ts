/**
 * Generates `docs/tools.md` from the tool definitions the server actually registers.
 *
 * The script starts a server instance in process and asks it for `tools/list`, so the
 * document shows the JSON Schema an MCP host receives (the zod schemas after conversion),
 * not a second description that could drift from it. Every example below is checked against
 * the schema of its tool before the file is written.
 *
 * Usage: `tsx scripts/gen-tools-doc.ts [--check]` (`--check` fails when the file is stale)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TOOLS, TOOL_ORDER } from '../src/core/names.js';

/** The subset of JSON Schema the tool schemas use. */
export interface JsonSchema {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  default?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
}

/** One entry of a `tools/list` result. */
export interface ToolListing {
  name: string;
  title?: string;
  description?: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  annotations?: Record<string, unknown>;
}

/** Example arguments per tool, shown in the document and validated against the schemas. */
export const EXAMPLES: Readonly<Record<string, ReadonlyArray<Record<string, unknown>>>> = {
  [TOOLS.listProducts]: [
    {},
    { product: 'js-maps-sdk' },
    { product: 'rest-api', section: 'portal' },
    { query: 'offline mobile', include_legacy: true },
  ],
  [TOOLS.getVersions]: [
    {},
    { product: 'python-api' },
    { product: '@arcgis/core', version: '4.33' },
  ],
  [TOOLS.search]: [
    { query: 'cluster points with popups', product: 'js-maps-sdk' },
    {
      query: 'applyEdits attachments',
      product: 'rest-api/services-enterprise',
      kind: 'api',
      limit: 5,
    },
  ],
  [TOOLS.read]: [
    { ref: 'https://developers.arcgis.com/javascript/latest/tutorials/add-a-feature-layer/' },
    {
      ref: 'https://developers.arcgis.com/javascript/latest/references/core/layers/FeatureLayer/',
      section: 'queryFeatures',
      max_tokens: 3000,
    },
    { ref: 'brief:ai/overview', view: 'outline' },
  ],
  [TOOLS.lookupSymbol]: [
    { symbol: 'FeatureLayer.queryFeatures', product: 'js-maps-sdk' },
    { symbol: 'arcpy.analysis.Buffer', detail: 'signature' },
  ],
  [TOOLS.findSamples]: [
    { query: 'offline map download', product: 'kotlin-maps-sdk' },
    { query: '3D tiles layer', uses_api: 'OGC3DTilesLayer', with_code: true },
  ],
};

const typeNames = (schema: JsonSchema): string[] =>
  schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number';
    case 'integer':
      return Number.isInteger(value);
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    default:
      return true;
  }
}

/**
 * Checks example arguments against a tool's input schema: no unknown argument, every
 * required one present, and each value of the declared type, enumeration and range.
 *
 * @returns one message per violation; empty when the example is valid.
 */
export function exampleProblems(schema: JsonSchema, args: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const properties = schema.properties ?? {};
  for (const name of schema.required ?? []) {
    // A converted schema lists a defaulted argument as required; a caller may still omit it.
    if (!(name in args) && properties[name]?.default === undefined) {
      problems.push(`missing required argument "${name}"`);
    }
  }
  for (const [name, value] of Object.entries(args)) {
    const property = properties[name];
    if (property === undefined) {
      problems.push(`unknown argument "${name}"`);
      continue;
    }
    const types = typeNames(property);
    if (types.length > 0 && !types.some((type) => matchesType(value, type))) {
      problems.push(`"${name}" must be of type ${types.join(' | ')}`);
    }
    if (property.enum !== undefined && !property.enum.includes(value)) {
      problems.push(`"${name}" must be one of ${JSON.stringify(property.enum)}`);
    }
    const size =
      typeof value === 'string' ? value.length : typeof value === 'number' ? value : undefined;
    const [low, high] =
      typeof value === 'string'
        ? [property.minLength, property.maxLength]
        : [property.minimum, property.maximum];
    if (
      size !== undefined &&
      ((low !== undefined && size < low) || (high !== undefined && size > high))
    ) {
      problems.push(`"${name}" is outside the allowed range`);
    }
  }
  return problems;
}

/** A schema's type as one short phrase: `string`, `integer 1..20`, `"a" | "b"`, `string[]`. */
export function describeType(schema: JsonSchema): string {
  if (schema.enum !== undefined)
    return schema.enum.map((value) => JSON.stringify(value)).join(' \\| ');
  const type = typeNames(schema).join(' \\| ') || 'any';
  if (type === 'array')
    return `${schema.items === undefined ? 'any' : describeType(schema.items)}[]`;
  const range =
    schema.minimum !== undefined || schema.maximum !== undefined
      ? ` ${schema.minimum ?? ''}..${schema.maximum ?? ''}`
      : schema.maxLength !== undefined
        ? ` (max ${schema.maxLength} chars)`
        : '';
  return `${type}${range}`;
}

const cell = (text: string): string => text.replace(/\r?\n/g, ' ').replace(/(?<!\\)\|/g, '\\|');

function argumentTable(schema: JsonSchema): string[] {
  const properties = Object.entries(schema.properties ?? {});
  const required = new Set(schema.required ?? []);
  return [
    '| Argument | Type | Required | Default | Description |',
    '|---|---|---|---|---|',
    ...properties.map(([name, property]) => {
      // A property with a default is listed as required by the converted schema, but a
      // caller may omit it; the document describes what the caller has to send.
      const mandatory = required.has(name) && property.default === undefined;
      const fallback =
        property.default === undefined ? '' : `\`${JSON.stringify(property.default)}\``;
      return `| \`${name}\` | ${describeType(property)} | ${mandatory ? 'yes' : 'no'} | ${fallback} | ${cell(property.description ?? '')} |`;
    }),
  ];
}

/** The fields of a structured result as a nested list. */
function fieldList(schema: JsonSchema, depth = 0): string[] {
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).flatMap(([name, property]) => {
    const inner = typeNames(property).includes('array') ? (property.items ?? {}) : property;
    const optional = required.has(name) ? '' : ' (optional)';
    return [
      `${'  '.repeat(depth)}- \`${name}\`: ${describeType(property)}${optional}`,
      ...fieldList(inner, depth + 1),
    ];
  });
}

/**
 * Renders the document. Tools appear in registration order.
 *
 * @throws Error when a registered tool is missing from the listing, or an example does not
 *   satisfy its tool's input schema.
 */
export function renderToolsDoc(tools: readonly ToolListing[]): string {
  const lines = [
    '# Tools',
    '',
    '<!-- Generated by scripts/gen-tools-doc.ts from the registered tool schemas. Do not edit. -->',
    '',
    'The server registers six read-only tools. Arguments and results below are the schemas an',
    'MCP host receives from `tools/list`.',
    '',
    ...TOOL_ORDER.map((name) => `- [\`${name}\`](#${name})`),
    '',
  ];
  for (const name of TOOL_ORDER) {
    const tool = tools.find((candidate) => candidate.name === name);
    if (tool === undefined) throw new Error(`The server does not register ${name}`);
    lines.push(`## ${name}`, '');
    if (tool.title !== undefined) lines.push(`**${tool.title}**`, '');
    lines.push(
      tool.description ?? '',
      '',
      '### Arguments',
      '',
      ...argumentTable(tool.inputSchema),
      '',
    );

    lines.push('### Examples', '');
    for (const example of EXAMPLES[name] ?? []) {
      const problems = exampleProblems(tool.inputSchema, example);
      if (problems.length > 0) {
        throw new Error(`Example ${JSON.stringify(example)} of ${name}: ${problems.join('; ')}`);
      }
      lines.push('```json', JSON.stringify(example), '```', '');
    }

    lines.push('### Result', '');
    if (tool.outputSchema === undefined) {
      lines.push('Markdown text only (no `structuredContent`).', '');
    } else {
      lines.push(
        'Markdown text plus `structuredContent` with these fields:',
        '',
        ...fieldList(tool.outputSchema),
        '',
      );
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

async function main(): Promise<void> {
  // Loaded here so that the helpers above can be unit-tested without a built server.
  const [{ createContainer }, { createServer }, { loadConfig }, { readPackageInfo }, client] =
    await Promise.all([
      import('../src/app/composition-root.js'),
      import('../src/mcp/server.js'),
      import('../src/core/config.js'),
      import('../src/app/package-info.js'),
      import('../src/cli/in-process-client.js'),
    ]);
  const pkg = readPackageInfo();
  // An empty environment: the document must not depend on the settings of whoever runs it.
  const config = loadConfig({ ARCGIS_DOCS_LOG_LEVEL: 'silent' }, { mode: 'stdio' }, pkg);
  const server = createServer(createContainer(config));
  const listed = (await client.withInProcessClient(server, pkg.version, (request) =>
    request('tools/list'),
  )) as { tools: ToolListing[] };

  const text = renderToolsDoc(listed.tools);
  const target = resolve(fileURLToPath(import.meta.url), '..', '..', 'docs', 'tools.md');
  if (!process.argv.includes('--check')) {
    writeFileSync(target, text);
    console.log(`wrote ${target}`);
    return;
  }
  let current = '';
  try {
    current = readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
  } catch {
    // A missing file is reported as stale below.
  }
  if (current !== text) {
    console.error('docs/tools.md is out of date: run `tsx scripts/gen-tools-doc.ts`');
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
  // Nothing was fetched, but the container may hold timers that would keep the process open.
  process.exit(process.exitCode ?? 0);
}
