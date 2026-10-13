/**
 * End to end against the packed tarball (design section 10): `npm pack`, unpack into a
 * temporary directory and drive the packed binary the way an MCP host does.
 *
 * The package's dependencies are not installed from the network: the unpacked package gets a
 * link to this repository's `node_modules`. Everything else (the file list, the binary, the
 * manifest) is exactly what would be published.
 *
 * Run with `npm run test:e2e`, which builds first.
 */
import { execSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOOL_ORDER, TOOLS } from '../../src/core/names.js';
import { extractTarGz } from './support/untar.js';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');

/** Start-up allowance: the handshake needs no network and no disk beyond loading modules. */
const STARTUP_MS = 5000;

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number;
  result?: Record<string, unknown>;
  error?: unknown;
}

let work: string;
let main: string;
let version: string;
let env: NodeJS.ProcessEnv;
const children = new Set<ChildProcessWithoutNullStreams>();

function start(args: readonly string[]): ChildProcessWithoutNullStreams {
  const child = spawn(process.execPath, [main, ...args], { env, cwd: work });
  children.add(child);
  child.once('close', () => children.delete(child));
  return child;
}

/** Runs the binary to completion. */
function run(args: readonly string[]): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((done) => {
    const child = start(args);
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));
    child.stdin.end();
    child.once('close', (code) => {
      done({ code, out, err });
    });
  });
}

beforeAll(() => {
  if (!existsSync(join(ROOT, 'dist', 'cli', 'main.js'))) {
    throw new Error('dist/ is missing: run "npm run build" first (npm run test:e2e does)');
  }
  work = mkdtempSync(join(tmpdir(), 'arcgis-sdk-mcp-e2e-'));
  // `--ignore-scripts`: the build is already there, and prepack would build again.
  const packed = JSON.parse(
    execSync(`npm pack --json --ignore-scripts --pack-destination "${work}"`, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }),
  ) as Array<{ filename: string; version: string }>;
  const tarball = packed[0];
  if (tarball === undefined) throw new Error('npm pack reported no tarball');
  version = tarball.version;
  extractTarGz(readFileSync(join(work, tarball.filename)), work);
  // npm tarballs keep everything under `package/`.
  const pkg = join(work, 'package');
  symlinkSync(join(ROOT, 'node_modules'), join(pkg, 'node_modules'), 'junction');
  main = join(pkg, 'dist', 'cli', 'main.js');
  env = {
    ...process.env,
    ARCGIS_DOCS_OFFLINE: '1',
    ARCGIS_DOCS_CACHE_DIR: join(work, 'cache'),
    ARCGIS_DOCS_LOG_LEVEL: 'warn',
  };
}, 120_000);

afterAll(() => {
  for (const child of children) child.kill();
  // The link is removed first so that deleting the directory cannot follow it.
  rmSync(join(work, 'package', 'node_modules'), { recursive: false, force: true });
  rmSync(work, { recursive: true, force: true, maxRetries: 3 });
});

describe('the packed tarball', () => {
  it('contains the build output and the three root documents only', () => {
    const pkg = join(work, 'package');
    for (const file of ['package.json', 'README.md', 'LICENSE', 'NOTICE', 'dist/index.js']) {
      expect(existsSync(join(pkg, file)), file).toBe(true);
    }
    for (const absent of ['src', 'test', 'scripts', 'briefs', 'docs']) {
      expect(existsSync(join(pkg, absent)), absent).toBe(false);
    }
    expect(readFileSync(main, 'utf8').startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('prints the version and usage without starting a server', async () => {
    const shown = await run(['--version']);
    expect(shown).toEqual({ code: 0, out: `${version}\n`, err: '' });
    const help = await run(['--help']);
    expect(help.code).toBe(0);
    expect(help.out).toContain('arcgis-sdk-mcp doctor');
    expect(help.err).toBe('');
  });

  it('rejects unknown arguments with the usage status', async () => {
    const result = await run(['--no-such-flag']);
    expect(result.code).toBe(2);
    expect(result.out).toBe('');
    expect(result.err).toContain('--help');
  });
});

describe('stdio', () => {
  it('writes nothing but JSON-RPC to stdout and answers a tool call offline', async () => {
    const started = Date.now();
    const child = start([]);
    let out = '';
    let firstByteMs: number | undefined;
    const lines = (): string[] => out.split('\n').filter((line) => line !== '');
    const done = new Promise<number | null>((settle) => {
      child.once('close', settle);
    });
    child.stdout.on('data', (chunk: Buffer) => {
      firstByteMs ??= Date.now() - started;
      out += chunk.toString();
      if (lines().length >= 3) child.stdin.end();
    });
    const send = (message: object): void => {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'e2e', version: '0.0.0' },
      },
    });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: TOOLS.listProducts, arguments: { category: 'native' } },
    });
    expect(await done).toBe(0);

    const messages = lines().map((line) => JSON.parse(line) as JsonRpcMessage);
    expect(messages.every((message) => message.jsonrpc === '2.0')).toBe(true);
    expect(messages.map((message) => message.id)).toEqual([1, 2, 3]);
    expect(messages.every((message) => message.error === undefined)).toBe(true);
    expect(firstByteMs).toBeLessThan(STARTUP_MS);

    const [initialized, listed, called] = messages;
    expect(initialized?.result?.serverInfo).toMatchObject({ name: 'arcgis-sdk-docs', version });
    const tools = listed?.result?.tools as Array<{ name: string }>;
    expect(tools.map((tool) => tool.name)).toEqual([...TOOL_ORDER]);
    const content = called?.result?.content as Array<{ type: string; text: string }>;
    expect(called?.result?.isError ?? false).toBe(false);
    expect(content[0]?.text).toContain('kotlin-maps-sdk');
  }, 30_000);

  it('serves the SDK client: tools, prompts, resources and a structured result', async () => {
    const client = new Client({ name: 'e2e', version: '0.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [main],
        env: Object.fromEntries(
          Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
        ),
        cwd: work,
        stderr: 'pipe',
      }),
    );
    try {
      expect((await client.listTools()).tools).toHaveLength(6);
      expect((await client.listPrompts()).prompts).toHaveLength(4);
      expect((await client.listResources()).resources.length).toBeGreaterThan(0);
      const profile = await client.callTool({
        name: TOOLS.listProducts,
        arguments: { product: 'arcpy' },
      });
      expect(profile.isError ?? false).toBe(false);
      expect(profile.structuredContent).toMatchObject({ mode: 'profile' });
      // Offline with an empty cache: a page read fails as a tool error, not as a crash.
      const miss = await client.callTool({
        name: TOOLS.read,
        arguments: { ref: 'https://developers.arcgis.com/javascript/latest/get-started/' },
      });
      expect(miss.isError).toBe(true);
      expect(JSON.stringify(miss.content)).toContain('OFFLINE_MISS');
    } finally {
      await client.close();
    }
  }, 30_000);
});

describe('--http', () => {
  it('serves the health check on loopback and rejects a foreign Host header', async () => {
    const child = start(['--http', '--port', '0']);
    const port = await new Promise<number>((found, failed) => {
      let err = '';
      child.stderr.on('data', (chunk: Buffer) => {
        err += chunk.toString();
        const match = /listening on http:\/\/127\.0\.0\.1:(\d+)\/mcp/.exec(err);
        if (match?.[1] !== undefined) found(Number(match[1]));
      });
      child.once('close', () => {
        failed(new Error(`the server exited before listening: ${err}`));
      });
    });
    const get = (host: string): Promise<{ status: number; body: string }> =>
      new Promise((answered, failed) => {
        const req = request(
          { host: '127.0.0.1', port, path: '/healthz', method: 'GET', headers: { host } },
          (res) => {
            let body = '';
            res.on('data', (chunk: Buffer) => (body += chunk.toString()));
            res.on('end', () => {
              answered({ status: res.statusCode ?? 0, body });
            });
          },
        );
        req.once('error', failed);
        req.end();
      });

    const local = await get(`127.0.0.1:${port}`);
    expect(local.status).toBe(200);
    expect(JSON.parse(local.body)).toMatchObject({ status: 'ok', version });
    const foreign = await get('attacker.example');
    expect(foreign.status).toBe(403);
    child.kill();
  }, 30_000);
});
