/**
 * An agent builds a small ArcGIS Maps SDK for JavaScript app from the documentation that
 * arcgis-sdk-mcp returns.
 *
 * Claude (through the Anthropic API and the SDK's tool runner) gets the server's six tools
 * over MCP stdio plus one local tool, `write_file`, that can only write into the output
 * directory. It is asked to verify every SDK fact with the tools before writing code, and to
 * record what it verified in NOTES.md. The run's transcript (tool calls with trimmed results,
 * Esri prose elided) is saved next to the app.
 *
 * Paid and live: it calls the Claude API (claude-opus-5-5 by default) and Esri's public
 * documentation sites. Needs `ANTHROPIC_API_KEY` (or an `ant auth login` profile) and a
 * build of the server (`npm run build` in the repository root).
 *
 * Usage, from the repository root:
 *   npx tsx examples/agent-builds-a-map-app/agent.ts [--model claude-opus-5-5] [--effort high]
 *        [--out examples/agent-builds-a-map-app/output/agent-run] [--max-iterations 30] [--dry-run]
 *
 * `--dry-run` starts the MCP server, converts its tools and prints the request it would send,
 * without calling the Claude API.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import Anthropic from '@anthropic-ai/sdk';
import {
  mcpTools,
  type MCPCallToolResultLike,
  type MCPClientLike,
} from '@anthropic-ai/sdk/helpers/beta/mcp';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import * as z from 'zod/v4';
import { trim } from '../shared/trim.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const SERVER = resolve(HERE, '..', '..', 'dist', 'cli', 'main.js');
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
type Effort = (typeof EFFORTS)[number];

const { values } = parseArgs({
  options: {
    model: { type: 'string', default: 'claude-opus-5-5' },
    effort: { type: 'string', default: 'high' },
    out: { type: 'string', default: resolve(HERE, 'output', 'agent-run') },
    'max-iterations': { type: 'string', default: '30' },
    'dry-run': { type: 'boolean', default: false },
  },
});

const OUT = resolve(values.out);
const EFFORT: Effort = (EFFORTS as readonly string[]).includes(values.effort)
  ? (values.effort as Effort)
  : 'high';
const WRITABLE = new Set(['.html', '.css', '.js', '.md']);

const TASK = `Build a small single-page web app with the ArcGIS Maps SDK for JavaScript.

What it must do:
- Show the earthquakes of the last 30 days from the public USGS GeoJSON feed
  https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_month.geojson
- Cluster the points, label each cluster with its count, and show a popup for clusters and
  for individual earthquakes (magnitude, place, time).
- Include a legend, zoom buttons and a control that turns clustering off and on.
- Run without an API key or sign-in, from any static web server.

How to work:
- Use the arcgis_docs tools before writing code: confirm the current SDK version and how to
  load it from the CDN, and look up every class, property and component you use. Do not rely
  on memory for any API detail; if a tool cannot confirm something, leave it out.
- Write your own code; do not copy a sample verbatim.
- Write the app as index.html with write_file. Then write NOTES.md with write_file: one row
  per fact you relied on, with the tool call that confirmed it and the documentation URL.
- Finish with a two-sentence summary of what you built.`;

/** Collects the transcript that is printed and saved. */
const transcript: string[] = [];
function log(line = ''): void {
  console.log(line);
  transcript.push(line);
}

/** The one local tool: writes a file into the output directory and nowhere else. */
const writeFile = betaZodTool({
  name: 'write_file',
  description:
    'Write a text file of the app (index.html, NOTES.md, or a .css/.js file) into the output directory. Paths are relative to that directory.',
  inputSchema: z.object({
    path: z.string().min(1).max(120),
    contents: z.string().max(200_000),
  }),
  run: ({ path, contents }) => {
    // The path is model output: confine it to the output directory before writing.
    const target = resolve(OUT, path);
    const rel = relative(OUT, target);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      return `Refused: ${path} is outside the output directory.`;
    }
    if (!WRITABLE.has(extname(target).toLowerCase())) {
      return `Refused: only ${[...WRITABLE].join(', ')} files may be written.`;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
    log(`> write_file ${rel} (${contents.length} chars)`);
    return `Wrote ${rel} (${contents.length} characters).`;
  },
});

async function main(): Promise<number> {
  if (!existsSync(SERVER)) {
    console.error('dist/cli/main.js is missing: run "npm run build" in the repository root.');
    return 2;
  }
  mkdirSync(OUT, { recursive: true });

  const mcp = new Client({ name: 'arcgis-sdk-mcp-agent-demo', version: '0.1.0' });
  await mcp.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [SERVER],
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
      // No package manifests in the output directory: no project SDK steers the answers.
      cwd: OUT,
      stderr: 'inherit',
    }),
  );

  try {
    const { tools } = await mcp.listTools();
    // Every MCP call is logged with its trimmed result before it goes back to the model.
    const loggingClient: MCPClientLike = {
      callTool: async (params) => {
        log(`\n> ${params.name} ${JSON.stringify(params.arguments ?? {})}`);
        const result = (await mcp.callTool(params)) as MCPCallToolResultLike;
        const text = result.content
          .map((part) => (part.type === 'text' ? part.text : `[${part.type}]`))
          .join('\n');
        log(
          trim(text, 10)
            .split('\n')
            .map((line) => `  ${line}`)
            .join('\n')
            .trimEnd(),
        );
        return result;
      },
    };
    const runnable = [...mcpTools(tools, loggingClient), writeFile];
    const system = `${mcp.getInstructions() ?? ''}\n\nYou are a careful web developer. Ground every ArcGIS API detail in the arcgis_docs tools.`;

    log(`# Agent run: ${new Date().toISOString().slice(0, 10)}`);
    log(`Model: ${values.model}, effort ${EFFORT}`);
    log(`Tools: ${runnable.map((tool) => tool.name).join(', ')}`);
    log(`Output: ${relative(process.cwd(), OUT) || '.'}`);

    if (values['dry-run']) {
      log('\nDry run: the request was not sent.');
      log(`System prompt: ${system.length} characters; task: ${TASK.length} characters.`);
      return 0;
    }

    const client = new Anthropic();
    const runner = client.beta.messages.toolRunner({
      model: values.model,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: EFFORT },
      // If a safety classifier declines a turn, the API re-runs it on a fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      max_iterations: Number(values['max-iterations']),
      system,
      tools: runnable,
      messages: [{ role: 'user', content: TASK }],
    });

    let inputTokens = 0;
    let outputTokens = 0;
    let turns = 0;
    for await (const message of runner) {
      turns += 1;
      inputTokens += message.usage.input_tokens;
      outputTokens += message.usage.output_tokens;
      for (const block of message.content) {
        if (block.type === 'text' && block.text.trim() !== '') log(`\n${block.text.trim()}`);
      }
      if (message.stop_reason === 'refusal') log('\n[stopped: refusal]');
    }
    log(`\n${turns} model turns, ${inputTokens} input and ${outputTokens} output tokens.`);
    writeFileSync(resolve(OUT, 'transcript.md'), `${transcript.join('\n')}\n`);
    console.log(`Transcript saved to ${relative(process.cwd(), resolve(OUT, 'transcript.md'))}`);
    return 0;
  } finally {
    await mcp.close();
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  if (error instanceof Anthropic.AuthenticationError) {
    console.error('No valid Anthropic credentials: set ANTHROPIC_API_KEY or run "ant auth login".');
  } else if (error instanceof Anthropic.APIError) {
    console.error(`Claude API error ${String(error.status)}: ${error.message}`);
  } else {
    // A missing credential is raised by the client before any request, as a plain Error.
    console.error(error instanceof Error ? error.message : error);
    console.error('Credentials come from ANTHROPIC_API_KEY or an "ant auth login" profile.');
  }
  process.exitCode = 1;
}
