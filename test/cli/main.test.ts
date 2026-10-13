import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SERVER_NAME, TOOL_ORDER } from '../../src/core/names.js';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const MAIN = join(ROOT, 'src', 'cli', 'main.ts');

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs the binary from source in a child process (`node --import tsx`). The child is
 * offline with its own cache directory, so it can neither reach the network nor touch the
 * user's cache.
 */
function runMain(args: string[], cacheDir: string, stdin = ''): Promise<Run> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, ['--import', 'tsx', MAIN, ...args], {
      cwd: ROOT,
      env: {
        ...process.env,
        ARCGIS_DOCS_OFFLINE: '1',
        ARCGIS_DOCS_CACHE_DIR: cacheDir,
        ARCGIS_DOCS_LOG_LEVEL: 'silent',
        ARCGIS_DOCS_SOURCES: '',
      },
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', fail);
    child.on('close', (code) => {
      done({
        code,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      });
    });
    // Closing stdin is how an MCP host ends a stdio session.
    child.stdin.end(stdin);
  });
}

describe('the binary', { timeout: 60_000 }, () => {
  let cacheDir: string;

  beforeAll(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'arcgis-sdk-mcp-main-'));
  });

  afterAll(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  it('prints the package version and exits', async () => {
    const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(await runMain(['--version'], cacheDir)).toEqual({
      code: 0,
      stdout: `${version}\n`,
      stderr: '',
    });
  });

  it('exits with status 2 and a hint for an unknown command', async () => {
    const run = await runMain(['frobnicate'], cacheDir);
    expect(run.code).toBe(2);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('Unknown command "frobnicate"');
  });

  it('serves stdio: only JSON-RPC on stdout, and exits when stdin closes', async () => {
    const messages = [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'main-test', version: '0.0.0' },
        },
      },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ];
    const run = await runMain([], cacheDir, messages.map((m) => `${JSON.stringify(m)}\n`).join(''));
    expect(run.code).toBe(0);

    const lines = run.stdout.split('\n').filter((line) => line !== '');
    const replies = lines.map(
      (line) =>
        JSON.parse(line) as { jsonrpc: string; id: number; result: Record<string, unknown> },
    );
    expect(replies.every((reply) => reply.jsonrpc === '2.0')).toBe(true);
    expect(replies.find((reply) => reply.id === 1)?.result).toMatchObject({
      serverInfo: { name: SERVER_NAME },
    });
    const tools = replies.find((reply) => reply.id === 2)?.result.tools as Array<{ name: string }>;
    expect(tools.map((tool) => tool.name)).toEqual([...TOOL_ORDER]);
  });
});
