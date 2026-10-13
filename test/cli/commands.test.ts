import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FALLBACK_PACKAGE_INFO,
  parsePackageInfo,
  readPackageInfo,
} from '../../src/app/package-info.js';
import { cacheClear, cacheInfo, formatBytes } from '../../src/cli/cache-cmd.js';
import { runCall } from '../../src/cli/call.js';
import { RpcError, withInProcessClient } from '../../src/cli/in-process-client.js';
import { startStdio, type ServeStdio } from '../../src/cli/stdio.js';
import { formatWarm, runWarm } from '../../src/cli/warm.js';
import { checkWritable } from '../../src/cli/writable.js';
import { TOOLS } from '../../src/core/names.js';
import type { IndexState } from '../../src/core/ports.js';
import { makeProduct, makeSource } from '../support/builders.js';
import { FakeLogger } from '../support/fake-logger.js';
import { MemoryCache } from '../support/memory-cache.js';
import { makeContainer, makeEchoServer } from './helpers.js';

const state = (overrides: Partial<IndexState> = {}): IndexState => ({
  product: 'widgets-sdk',
  source: 'guide',
  line: 'latest',
  state: 'ready',
  records: 10,
  ...overrides,
});

describe('in-process client', () => {
  it('lists the tools of a server with their JSON Schema', async () => {
    const listed = (await withInProcessClient(makeEchoServer(), '1.0.0', (request) =>
      request('tools/list'),
    )) as { tools: Array<{ name: string; inputSchema: { required?: string[] } }> };
    expect(listed.tools.map((tool) => tool.name)).toEqual([TOOLS.search]);
    expect(listed.tools[0]?.inputSchema.required).toEqual(['query']);
  });

  it('rejects an unknown method with the JSON-RPC error', async () => {
    const attempt = withInProcessClient(makeEchoServer(), '1.0.0', (request) =>
      request('arcgis/unknown'),
    );
    await expect(attempt).rejects.toBeInstanceOf(RpcError);
    await expect(attempt).rejects.toMatchObject({ code: -32601 });
  });

  it('closes the server when the callback throws', async () => {
    const server = makeEchoServer();
    let closed = false;
    const close = server.close.bind(server);
    server.close = async () => {
      closed = true;
      await close();
    };
    await expect(
      withInProcessClient(server, '1.0.0', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(closed).toBe(true);
  });
});

describe('runCall', () => {
  it('returns the text of a successful call', async () => {
    expect(await runCall(makeEchoServer(), TOOLS.search, { query: 'tiles' }, '1.0.0')).toEqual({
      text: 'echo: tiles',
      isError: false,
    });
  });

  it('reports a tool error and a schema violation as error outcomes', async () => {
    const failed = await runCall(makeEchoServer(), TOOLS.search, { query: 'ab', fail: true }, '1');
    expect(failed).toEqual({ text: 'echo: ab', isError: true });

    const invalid = await runCall(makeEchoServer(), TOOLS.search, { query: 7 }, '1');
    expect(invalid.isError).toBe(true);
    expect(invalid.text).toContain('query');
  });

  it('reports a tool the server does not register', async () => {
    const outcome = await runCall(makeEchoServer(), TOOLS.read, { ref: 'brief:x' }, '1');
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain(TOOLS.read);
  });
});

describe('cache commands', () => {
  it('formats sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB');
    expect(formatBytes(5000 * 1024 ** 3)).toBe('5000.0 GB');
  });

  it('describes and clears the cache', async () => {
    const cache = new MemoryCache();
    await cache.putDerived('catalog', 'a', { records: [1, 2, 3] });
    expect(await cacheInfo(cache, 250)).toMatch(
      /^Cache directory: \(memory\)\nSize: \d+ B of 250 MB\nEntries: 1\n$/,
    );
    expect(await cacheClear(cache, 'http')).toBe(
      'Cleared cached responses in (memory) (0 B freed)\n',
    );
    expect((await cache.info()).entries).toBe(1);
    expect(await cacheClear(cache, 'all')).toMatch(/^Cleared cached responses and derived indexes/);
    expect((await cache.info()).entries).toBe(0);
  });
});

describe('runWarm', () => {
  it('polls while an index is still building', async () => {
    const container = makeContainer({
      indexStates: [
        [state({ state: 'building', records: 0 })],
        [state({ state: 'building', records: 0 })],
        [state()],
      ],
    });
    const slept: number[] = [];
    const results = await runWarm(container, ['widgets-sdk'], async (ms) => void slept.push(ms));
    expect(container.ensured).toHaveLength(3);
    expect(slept).toEqual([2000, 2000]);
    expect(results).toEqual([
      {
        input: 'widgets-sdk',
        product: 'widgets-sdk',
        line: 'latest',
        states: [state()],
        usable: true,
      },
    ]);
  });

  it('gives up on a build that never finishes and reports it as not usable', async () => {
    const container = makeContainer({ indexStates: [[state({ state: 'building', records: 0 })]] });
    let waited = 0;
    const results = await runWarm(container, ['widgets-sdk'], async (ms) => void (waited += ms));
    expect(waited).toBe(180_000);
    expect(results[0]?.usable).toBe(false);
  });

  it('limits the build to one source for the scope form', async () => {
    const product = makeProduct({
      sources: [
        makeSource('gatsby', { base: '/widgets/' }),
        makeSource('docc', { base: '/widgets/api/' }, { id: 'api', floor: false }),
      ],
    });
    const container = makeContainer({
      products: [product],
      indexStates: [[state({ source: 'api' })]],
    });
    await runWarm(container, ['widgets-sdk/api'], async () => undefined);
    expect(container.ensured).toEqual([
      { product: 'widgets-sdk', sources: ['api'], line: 'latest' },
    ]);
  });

  it('counts stale and partial indexes as usable', async () => {
    for (const kind of ['stale', 'partial'] as const) {
      const container = makeContainer({ indexStates: [[state({ state: kind })]] });
      const [result] = await runWarm(container, ['widgets-sdk'], async () => undefined);
      expect(result?.usable).toBe(true);
    }
  });

  it('formats products without indexable sources', () => {
    expect(
      formatWarm([
        { input: 'x', product: 'widgets-sdk', line: 'latest', states: [], usable: false },
      ]),
    ).toBe('widgets-sdk (latest)\n  no indexable sources\n');
  });
});

describe('startStdio', () => {
  it('passes the factory to the SDK entry and logs transport errors', () => {
    const logger = new FakeLogger();
    const handle = { close: async () => undefined };
    const calls: Array<Parameters<ServeStdio>> = [];
    const serve: ServeStdio = (...args) => {
      calls.push(args);
      return handle;
    };
    expect(startStdio(makeEchoServer, logger, serve)).toBe(handle);
    expect(calls[0]?.[0]).toBe(makeEchoServer);

    calls[0]?.[1]?.onerror?.(new Error('broken pipe'));
    expect(logger.entries).toEqual([
      expect.objectContaining({ level: 'error', msg: 'stdio transport error' }),
    ]);
  });
});

describe('package info', () => {
  it('reads version and repository from the manifest', () => {
    const manifest = {
      version: '1.4.0',
      repository: { type: 'git', url: 'git+https://github.com/aselimc/arcgis-sdk-mcp.git' },
    };
    expect(parsePackageInfo(JSON.stringify(manifest))).toEqual({
      version: '1.4.0',
      repoUrl: 'https://github.com/aselimc/arcgis-sdk-mcp',
    });
    expect(
      parsePackageInfo('{"version":"2.0.0","repository":"https://example.org/x.git"}').repoUrl,
    ).toBe('https://example.org/x');
  });

  it('falls back field by field', () => {
    expect(parsePackageInfo('not json')).toEqual(FALLBACK_PACKAGE_INFO);
    expect(parsePackageInfo('[]')).toEqual(FALLBACK_PACKAGE_INFO);
    expect(parsePackageInfo('{"version":"","repository":{"url":"ssh://git@host/x"}}')).toEqual(
      FALLBACK_PACKAGE_INFO,
    );
    expect(parsePackageInfo('{"version":"3.0.0","repository":7}')).toEqual({
      version: '3.0.0',
      repoUrl: FALLBACK_PACKAGE_INFO.repoUrl,
    });
  });

  it('finds this package and survives a missing file', () => {
    const info = readPackageInfo();
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(info.repoUrl).toBe('https://github.com/aselimc/arcgis-sdk-mcp');
    expect(readPackageInfo(new URL('file:///no/such/package.json'))).toEqual(FALLBACK_PACKAGE_INFO);
  });
});

describe('checkWritable', () => {
  it('creates the directory, leaves nothing behind and reports success', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arcgis-sdk-mcp-test-'));
    try {
      const dir = join(root, 'nested', 'cache');
      expect(await checkWritable(dir)).toBeUndefined();
      expect(await readdir(dir)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports why a path cannot be written', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arcgis-sdk-mcp-test-'));
    try {
      const file = join(root, 'occupied');
      await writeFile(file, 'x');
      // A file where the directory should be: mkdir fails on every platform.
      expect(await checkWritable(join(file, 'cache'))).toEqual(expect.any(String));
      expect(pathToFileURL(file).protocol).toBe('file:');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
