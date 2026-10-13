/**
 * Task format and scoring of the agent evaluations. Pure: no network and no model calls, so
 * the unit tests can check the task file and the scoring rules.
 */
import * as z from 'zod/v4';
import { TOOL_ORDER } from '../src/core/names.js';

const pattern = z.string().min(1).refine(compiles, 'must be a valid regular expression');

function compiles(source: string): boolean {
  try {
    new RegExp(source, 'i');
    return true;
  } catch {
    return false;
  }
}

/** One line of `tasks.jsonl`. */
export const TaskSchema = z.strictObject({
  /** Lower-case words joined by hyphens; unique in the file. */
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  /** What the user asks the agent. */
  prompt: z.string().min(20),
  /** Regular expressions (case-insensitive) the final answer must match, all of them. */
  facts: z.array(pattern).min(1),
  /** Tools of which the agent must call at least one. Omit when any route is acceptable. */
  tools: z.array(z.enum(TOOL_ORDER)).min(1).optional(),
  /** Overrides the default citation rule: a URL the final answer must contain. */
  cite: pattern.optional(),
});

/** One evaluation task. */
export type Task = z.infer<typeof TaskSchema>;

/** A final answer must cite a documentation URL on one of these hosts unless the task says otherwise. */
export const DEFAULT_CITATION =
  'https://(?:developers\\.arcgis\\.com|doc\\.esri\\.com|doc\\.arcgis\\.com|support\\.esri\\.com|github\\.com/Esri)/';

/**
 * Parses a JSON Lines task file.
 *
 * @throws Error naming the line and the first invalid field, or a duplicated id.
 */
export function parseTasks(jsonl: string): Task[] {
  const tasks: Task[] = [];
  const seen = new Set<string>();
  jsonl.split('\n').forEach((line, index) => {
    if (line.trim() === '') return;
    const parsed = TaskSchema.safeParse(JSON.parse(line));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(
        `tasks.jsonl line ${index + 1}: ${issue?.path.join('.') ?? '(root)'}: ${issue?.message ?? 'invalid'}`,
      );
    }
    if (seen.has(parsed.data.id)) {
      throw new Error(`tasks.jsonl line ${index + 1}: duplicate id "${parsed.data.id}"`);
    }
    seen.add(parsed.data.id);
    tasks.push(parsed.data);
  });
  return tasks;
}

/** What one run of a task produced. */
export interface Transcript {
  /** The agent's final text; empty when the run ended without one. */
  answer: string;
  /** Names of the tools called, in order. */
  toolCalls: string[];
  /** Tool calls that came back as errors. */
  toolErrors: number;
  /** Model requests made. */
  turns: number;
  inputTokens: number;
  outputTokens: number;
  /** Why the run ended: `end_turn`, `max_turns`, `max_tokens`, `refusal` or `error: ...`. */
  stopped: string;
}

/** The score of one task. */
export interface Score {
  id: string;
  /** Every fact matched, the answer cites a source, and a required tool was used. */
  passed: boolean;
  factsMatched: number;
  factsTotal: number;
  /** Fact patterns the answer did not match. */
  missing: string[];
  cited: boolean;
  /** True when the task names no tool or one of the named tools was called. */
  usedExpectedTool: boolean;
  toolCalls: number;
  toolErrors: number;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  stopped: string;
}

/** Scores a transcript against its task. */
export function scoreTask(task: Task, transcript: Transcript): Score {
  const missing = task.facts.filter((fact) => !new RegExp(fact, 'i').test(transcript.answer));
  const cited = new RegExp(task.cite ?? DEFAULT_CITATION, 'i').test(transcript.answer);
  const usedExpectedTool =
    task.tools === undefined || task.tools.some((tool) => transcript.toolCalls.includes(tool));
  return {
    id: task.id,
    passed:
      transcript.stopped === 'end_turn' && missing.length === 0 && cited && usedExpectedTool,
    factsMatched: task.facts.length - missing.length,
    factsTotal: task.facts.length,
    missing,
    cited,
    usedExpectedTool,
    toolCalls: transcript.toolCalls.length,
    toolErrors: transcript.toolErrors,
    turns: transcript.turns,
    inputTokens: transcript.inputTokens,
    outputTokens: transcript.outputTokens,
    stopped: transcript.stopped,
  };
}

/** Totals over a run, for the summary line and for comparing two runs. */
export interface Summary {
  tasks: number;
  passed: number;
  factsMatched: number;
  factsTotal: number;
  cited: number;
  toolCalls: number;
  toolErrors: number;
  inputTokens: number;
  outputTokens: number;
}

/** Adds the scores up. */
export function summarize(scores: readonly Score[]): Summary {
  const sum = (pick: (score: Score) => number): number =>
    scores.reduce((total, score) => total + pick(score), 0);
  return {
    tasks: scores.length,
    passed: sum((score) => (score.passed ? 1 : 0)),
    factsMatched: sum((score) => score.factsMatched),
    factsTotal: sum((score) => score.factsTotal),
    cited: sum((score) => (score.cited ? 1 : 0)),
    toolCalls: sum((score) => score.toolCalls),
    toolErrors: sum((score) => score.toolErrors),
    inputTokens: sum((score) => score.inputTokens),
    outputTokens: sum((score) => score.outputTokens),
  };
}
