import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CITATION,
  parseTasks,
  scoreTask,
  summarize,
  type Task,
  type Transcript,
} from '../../evals/score.js';
import { TOOL_ORDER, TOOLS } from '../../src/core/names.js';

const TASKS_FILE = resolve(fileURLToPath(import.meta.url), '..', '..', '..', 'evals', 'tasks.jsonl');

const task: Task = {
  id: 'page-through-results',
  prompt: 'How do I page through the results of a berth query?',
  facts: ['resultOffset', 'result(?:Record)?Count'],
  tools: [TOOLS.lookupSymbol],
};

const transcript = (overrides: Partial<Transcript> = {}): Transcript => ({
  answer:
    'Use resultOffset with resultRecordCount (https://developers.arcgis.com/rest/berths/query/).',
  toolCalls: [TOOLS.search, TOOLS.lookupSymbol],
  toolErrors: 0,
  turns: 3,
  inputTokens: 9000,
  outputTokens: 400,
  stopped: 'end_turn',
  ...overrides,
});

describe('evals/tasks.jsonl', () => {
  const tasks = parseTasks(readFileSync(TASKS_FILE, 'utf8'));

  it('holds 25 valid tasks with unique ids', () => {
    expect(tasks).toHaveLength(25);
    expect(new Set(tasks.map((entry) => entry.id)).size).toBe(25);
  });

  it('exercises every tool and never pins a version number as a fact', () => {
    const named = new Set(tasks.flatMap((entry) => entry.tools ?? []));
    expect([...named].sort()).toEqual([...TOOL_ORDER].sort());
    for (const entry of tasks) {
      // A literal version would make the task fail at the next release.
      expect(entry.facts.join(' '), entry.id).not.toMatch(/(?<![\\\d])\d+\.\d+\.\d+/);
    }
  });
});

describe('parseTasks', () => {
  const line = (value: object): string => JSON.stringify(value);

  it('skips blank lines', () => {
    expect(parseTasks(`\n${line(task)}\n\n`)).toEqual([task]);
  });

  it('names the line and field of an invalid task', () => {
    expect(() => parseTasks(`${line(task)}\n${line({ ...task, id: 'Not Valid' })}`)).toThrow(
      /line 2: id/,
    );
    expect(() => parseTasks(line({ ...task, facts: ['('] }))).toThrow(/line 1: facts\.0/);
    expect(() => parseTasks(line({ ...task, tools: ['no_such_tool'] }))).toThrow(/line 1: tools/);
    expect(() => parseTasks(line({ ...task, extra: true }))).toThrow(/line 1/);
  });

  it('rejects a duplicated id', () => {
    expect(() => parseTasks(`${line(task)}\n${line(task)}`)).toThrow(/line 2: duplicate id/);
  });
});

describe('scoreTask', () => {
  it('passes an answer with every fact, a citation and a required tool', () => {
    expect(scoreTask(task, transcript())).toMatchObject({
      id: task.id,
      passed: true,
      factsMatched: 2,
      factsTotal: 2,
      missing: [],
      cited: true,
      usedExpectedTool: true,
      toolCalls: 2,
    });
  });

  it('reports the facts an answer lacks', () => {
    const score = scoreTask(task, transcript({ answer: 'Use RESULTOFFSET. See the docs.' }));
    expect(score).toMatchObject({ passed: false, factsMatched: 1, cited: false });
    expect(score.missing).toEqual(['result(?:Record)?Count']);
  });

  it('fails an answer that was reached without a required tool', () => {
    const score = scoreTask(task, transcript({ toolCalls: [TOOLS.search] }));
    expect(score).toMatchObject({ passed: false, usedExpectedTool: false, factsMatched: 2 });
    // A task that names no tool accepts any route, including none.
    const open: Task = { id: task.id, prompt: task.prompt, facts: task.facts };
    expect(scoreTask(open, transcript({ toolCalls: [] })).passed).toBe(true);
  });

  it('fails a run that did not end normally, whatever the text says', () => {
    for (const stopped of ['max_turns', 'max_tokens', 'refusal', 'error: rate limited']) {
      expect(scoreTask(task, transcript({ stopped })), stopped).toMatchObject({
        passed: false,
        stopped,
      });
    }
  });

  it('accepts the citation hosts of the default rule and a task-specific rule', () => {
    const cites = (answer: string, cite?: string): boolean =>
      scoreTask({ ...task, ...(cite === undefined ? {} : { cite }) }, transcript({ answer })).cited;
    expect(cites('See https://doc.esri.com/en/arcgis-pro/latest/arcpy/x.html')).toBe(true);
    expect(cites('See https://github.com/Esri/arcgis-maps-sdk-samples/blob/main/README.md')).toBe(
      true,
    );
    expect(cites('See https://example.org/arcgis')).toBe(false);
    expect(cites('See brief:auth/choosing-authentication', 'brief:auth/')).toBe(true);
    expect(new RegExp(DEFAULT_CITATION).test('https://github.com/SomeoneElse/x')).toBe(false);
  });
});

describe('summarize', () => {
  it('adds the scores up', () => {
    const scores = [
      scoreTask(task, transcript()),
      scoreTask(task, transcript({ answer: 'resultOffset', toolErrors: 2 })),
    ];
    expect(summarize(scores)).toEqual({
      tasks: 2,
      passed: 1,
      factsMatched: 3,
      factsTotal: 4,
      cited: 1,
      toolCalls: 4,
      toolErrors: 2,
      inputTokens: 18000,
      outputTokens: 800,
    });
    expect(summarize([])).toMatchObject({ tasks: 0, passed: 0 });
  });
});
