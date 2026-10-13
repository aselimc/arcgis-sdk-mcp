/**
 * Runner of the agent evaluations: gives a model the six tools of the built server over
 * stdio, lets it work on each task of `tasks.jsonl`, and scores the final answers.
 *
 * Manual and paid: every task is a multi-turn conversation with the Claude API, and the
 * server fetches documentation from the live sites. Needs credentials for the Anthropic SDK
 * (`ANTHROPIC_API_KEY`, or a profile from `ant auth login`) and a build (`npm run build`).
 *
 * Usage:
 *   tsx evals/run.ts [--only id,id] [--model claude-opus-5-5] [--effort high]
 *                    [--max-turns 12] [--out evals/results.jsonl] [--sources <value>] [--list]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { parseTasks, scoreTask, summarize, type Score, type Task, type Transcript } from './score.js';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const SERVER = resolve(ROOT, 'dist', 'cli', 'main.js');

const DEFAULT_MODEL = 'claude-opus-5-5';
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
type Effort = (typeof EFFORTS)[number];

/** Non-streaming requests stay under the SDK's HTTP timeout at this size. */
const MAX_TOKENS = 16_000;

const EVAL_DIRECTIVE =
  'You are answering a developer question about ArcGIS. Verify facts with the arcgis_docs tools before answering; do not answer from memory alone. Finish with a concise answer that names the exact API identifiers involved and cites the documentation URLs you relied on.';

/** Options of one evaluation run. */
interface RunOptions {
  model: string;
  effort: Effort;
  maxTurns: number;
}

/** The server's tools in the shape the Messages API takes. */
async function claudeTools(mcp: Client): Promise<Anthropic.Tool[]> {
  const { tools } = await mcp.listTools();
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? '',
    input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
  }));
}

/** Runs one tool through the server and returns it as a `tool_result` block. */
async function callTool(
  mcp: Client,
  block: Anthropic.ToolUseBlock,
): Promise<Anthropic.ToolResultBlockParam> {
  try {
    const result = await mcp.callTool({
      name: block.name,
      arguments: block.input as Record<string, unknown>,
    });
    const text = (result.content as Array<{ type: string; text?: string }>)
      .map((part) => (part.type === 'text' ? (part.text ?? '') : ''))
      .join('\n');
    return {
      type: 'tool_result',
      tool_use_id: block.id,
      content: text,
      ...(result.isError === true ? { is_error: true } : {}),
    };
  } catch (error) {
    // A protocol-level failure (for example arguments the schema rejects) is still a result
    // the model must see, or it cannot correct the call.
    return {
      type: 'tool_result',
      tool_use_id: block.id,
      content: error instanceof Error ? error.message : String(error),
      is_error: true,
    };
  }
}

function describeFailure(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return 'error: authentication failed';
  if (error instanceof Anthropic.RateLimitError) return 'error: rate limited';
  if (error instanceof Anthropic.APIConnectionError) return 'error: connection failed';
  if (error instanceof Anthropic.APIError) return `error: API status ${error.status ?? 'unknown'}`;
  throw error;
}

/**
 * Lets the model work on one task until it answers, is cut off, or runs out of turns.
 *
 * Refusal fallbacks are deliberately not enabled: a fallback would answer with a different
 * model than the one under evaluation. A refusal is recorded as the task's outcome instead.
 */
async function runTask(
  claude: Anthropic,
  mcp: Client,
  tools: Anthropic.Tool[],
  system: string,
  task: Task,
  options: RunOptions,
): Promise<Transcript> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: task.prompt }];
  const transcript: Transcript = {
    answer: '',
    toolCalls: [],
    toolErrors: 0,
    turns: 0,
    inputTokens: 0,
    outputTokens: 0,
    stopped: 'max_turns',
  };

  while (transcript.turns < options.maxTurns) {
    let response: Anthropic.Message;
    try {
      response = await claude.messages.create({
        model: options.model,
        max_tokens: MAX_TOKENS,
        // The tool list and system prompt repeat on every turn of every task.
        cache_control: { type: 'ephemeral' },
        output_config: { effort: options.effort },
        system,
        tools,
        messages,
      });
    } catch (error) {
      transcript.stopped = describeFailure(error);
      return transcript;
    }
    transcript.turns += 1;
    const { usage } = response;
    transcript.inputTokens +=
      usage.input_tokens +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0);
    transcript.outputTokens += usage.output_tokens;

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    if (text !== '') transcript.answer = text;

    if (response.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }
    if (response.stop_reason !== 'tool_use') {
      transcript.stopped = response.stop_reason ?? 'end_turn';
      return transcript;
    }

    const calls = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );
    messages.push({ role: 'assistant', content: response.content });
    // One call at a time: the server paces upstream requests, and order keeps logs readable.
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const call of calls) {
      const result = await callTool(mcp, call);
      transcript.toolCalls.push(call.name);
      if (result.is_error === true) transcript.toolErrors += 1;
      results.push(result);
    }
    // Every result of a turn goes back in one user message.
    messages.push({ role: 'user', content: results });
  }
  return transcript;
}

function formatRow(score: Score): string {
  const facts = `${score.factsMatched}/${score.factsTotal}`;
  return [
    score.passed ? 'pass' : 'FAIL',
    score.id.padEnd(28),
    `facts ${facts}`,
    score.cited ? 'cited' : 'no-cite',
    `calls ${score.toolCalls}`,
    `errors ${score.toolErrors}`,
    `in ${score.inputTokens}`,
    `out ${score.outputTokens}`,
    score.stopped === 'end_turn' ? '' : `(${score.stopped})`,
  ]
    .join('  ')
    .trimEnd();
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      tasks: { type: 'string', default: resolve(ROOT, 'evals', 'tasks.jsonl') },
      only: { type: 'string' },
      model: { type: 'string', default: DEFAULT_MODEL },
      effort: { type: 'string', default: 'high' },
      'max-turns': { type: 'string', default: '12' },
      out: { type: 'string' },
      sources: { type: 'string' },
      list: { type: 'boolean' },
    },
  });
  const wanted = new Set(values.only?.split(',').filter((id) => id !== ''));
  const tasks = parseTasks(readFileSync(values.tasks, 'utf8')).filter(
    (task) => wanted.size === 0 || wanted.has(task.id),
  );
  if (values.list === true) {
    for (const task of tasks) console.log(`${task.id}\t${task.prompt}`);
    return 0;
  }
  const effort = EFFORTS.find((level) => level === values.effort);
  const maxTurns = Number(values['max-turns']);
  if (effort === undefined || !Number.isInteger(maxTurns) || maxTurns < 1) {
    console.error(`--effort takes ${EFFORTS.join(' | ')}; --max-turns takes a positive integer`);
    return 2;
  }
  if (!existsSync(SERVER)) {
    console.error('dist/cli/main.js is missing: run "npm run build" first');
    return 2;
  }

  const mcp = new Client({ name: 'arcgis-sdk-mcp-evals', version: '0.0.0' });
  await mcp.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [SERVER],
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
          ),
        ),
        ...(values.sources === undefined ? {} : { ARCGIS_DOCS_SOURCES: values.sources }),
      },
      // A directory without package manifests: no project SDK may steer the answers.
      cwd: resolve(ROOT, 'evals'),
      stderr: 'inherit',
    }),
  );
  const tools = await claudeTools(mcp);
  const system = `${mcp.getInstructions() ?? ''}\n\n${EVAL_DIRECTIVE}`;
  // Resolves credentials from the environment or an `ant auth login` profile.
  const claude = new Anthropic();

  const scores: Score[] = [];
  const lines: string[] = [];
  try {
    for (const task of tasks) {
      const transcript = await runTask(claude, mcp, tools, system, task, {
        model: values.model,
        effort,
        maxTurns,
      });
      const score = scoreTask(task, transcript);
      scores.push(score);
      lines.push(JSON.stringify({ ...score, model: values.model, effort, answer: transcript.answer }));
      console.log(formatRow(score));
      if (transcript.stopped === 'error: authentication failed') break;
    }
  } finally {
    await mcp.close();
  }

  if (values.out !== undefined) writeFileSync(values.out, `${lines.join('\n')}\n`);
  const total = summarize(scores);
  console.log(
    `\n${total.passed}/${total.tasks} passed | facts ${total.factsMatched}/${total.factsTotal} | cited ${total.cited}/${total.tasks} | tool calls ${total.toolCalls} (${total.toolErrors} errors) | tokens in ${total.inputTokens}, out ${total.outputTokens}`,
  );
  return total.passed === total.tasks ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(await main());
}
