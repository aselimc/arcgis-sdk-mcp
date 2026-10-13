import { describe, expect, it } from 'vitest';
import { HELP_TEXT } from '../../src/cli/args.js';
import { EXIT, REMOTE_WARNING, describeError, runCli } from '../../src/cli/run.js';
import { McpDocError } from '../../src/core/errors.js';
import { TOOLS } from '../../src/core/names.js';
import type { IndexState } from '../../src/core/ports.js';
import { FakeAdapter } from '../support/fake-adapter.js';
import { makeCli } from './helpers.js';

const ready: IndexState = {
  product: 'widgets-sdk',
  source: 'guide',
  line: 'latest',
  state: 'ready',
  records: 42,
  builtAt: '2026-10-13T08:00:00.000Z',
};

describe('runCli: help, version and usage errors', () => {
  it('prints help without loading the application', async () => {
    const cli = makeCli();
    expect(await runCli(['--help'], cli.deps)).toBe(EXIT.ok);
    expect(cli.out).toEqual([HELP_TEXT]);
    expect(cli.loads()).toBe(0);
    expect(cli.served).toEqual([]);
  });

  it('prints the version without loading the application or reading the environment', async () => {
    const cli = makeCli({ env: { ARCGIS_DOCS_SOURCES: 'not-a-preset' } });
    expect(await runCli(['--version'], cli.deps)).toBe(EXIT.ok);
    expect(cli.out).toEqual(['9.9.9\n']);
    expect(cli.loads()).toBe(0);
  });

  it('answers a usage error on stderr with status 2', async () => {
    const cli = makeCli();
    expect(await runCli(['frobnicate'], cli.deps)).toBe(EXIT.usage);
    expect(cli.err.join('')).toContain('Unknown command "frobnicate"');
    expect(cli.err.join('')).toContain('arcgis-sdk-mcp --help');
    expect(cli.out).toEqual([]);
    expect(cli.loads()).toBe(0);
  });

  it('answers a configuration error with status 2 and names the variable', async () => {
    const cli = makeCli({ env: { ARCGIS_DOCS_SOURCES: 'everything' } });
    expect(await runCli(['cache', 'info'], cli.deps)).toBe(EXIT.usage);
    expect(cli.err.join('')).toMatch(/^Configuration error: ARCGIS_DOCS_SOURCES/);
    expect(cli.loads()).toBe(0);
  });

  it('reports an unexpected failure with status 1 and no stack trace', async () => {
    const cli = makeCli({
      deps: {
        loadApp: async () => {
          throw new Error('Cannot find module ../mcp/server.js');
        },
      },
    });
    expect(await runCli(['cache', 'info'], cli.deps)).toBe(EXIT.failure);
    expect(cli.err).toEqual(['Error: Cannot find module ../mcp/server.js\n']);
  });
});

describe('runCli: serving', () => {
  it('serves stdio by default, writes nothing to stdout and keeps running', async () => {
    const cli = makeCli();
    expect(await runCli([], cli.deps)).toBeUndefined();
    expect(cli.served).toEqual([{ kind: 'stdio' }]);
    expect(cli.modes).toEqual(['stdio']);
    expect(cli.out).toEqual([]);
    expect(cli.err).toEqual([]);

    expect(cli.shutdownHooks).toHaveLength(1);
    await cli.shutdownHooks[0]?.();
    expect(cli.closed).toEqual(['stdio']);
  });

  it('serves HTTP on loopback in http mode and announces the URL on stderr', async () => {
    const cli = makeCli();
    expect(await runCli(['--http', '--port', '4000'], cli.deps)).toBeUndefined();
    expect(cli.served).toEqual([{ kind: 'http', host: '127.0.0.1', port: 4000 }]);
    expect(cli.modes).toEqual(['http']);
    expect(cli.err).toEqual(['arcgis-sdk-mcp 9.9.9 listening on http://127.0.0.1:4000/mcp\n']);
    expect(cli.out).toEqual([]);

    await cli.shutdownHooks[0]?.();
    expect(cli.closed).toEqual(['http']);
  });

  it('prints the terms warning before binding a non-loopback host', async () => {
    const cli = makeCli();
    await runCli(['--http', '--host', '0.0.0.0', '--allow-remote'], cli.deps);
    expect(cli.err[0]).toBe(REMOTE_WARNING);
    expect(REMOTE_WARNING).toMatch(/no authentication/);
    expect(REMOTE_WARNING).toMatch(/Esri's permission/);
    expect(cli.served).toEqual([{ kind: 'http', host: '0.0.0.0', port: 3333 }]);
  });

  it('does not warn for --allow-remote on a loopback host', async () => {
    const cli = makeCli();
    await runCli(['--http', '--allow-remote'], cli.deps);
    expect(cli.err.join('')).not.toContain('WARNING');
  });

  it('refuses a non-loopback host without --allow-remote before starting anything', async () => {
    const cli = makeCli();
    expect(await runCli(['--http', '--host', '10.0.0.5'], cli.deps)).toBe(EXIT.usage);
    expect(cli.served).toEqual([]);
    expect(cli.loads()).toBe(0);
  });

  it('reports a port that is in use', async () => {
    const cli = makeCli({
      deps: {
        serveHttp: async () => {
          throw new Error('listen EADDRINUSE: address already in use 127.0.0.1:3333');
        },
      },
    });
    expect(await runCli(['--http'], cli.deps)).toBe(EXIT.failure);
    expect(cli.err.join('')).toContain('EADDRINUSE');
  });
});

describe('runCli: cache', () => {
  it('prints the cache directory, size and entry count', async () => {
    const cli = makeCli();
    await cli.container.ctx.cache.putDerived('misc', 'k', { hello: 'world' });
    expect(await runCli(['cache', 'info'], cli.deps)).toBe(EXIT.ok);
    const text = cli.out.join('');
    expect(text).toContain('Cache directory: (memory)');
    expect(text).toContain('of 500 MB');
    expect(text).toContain('Entries: 1');
  });

  it('clears the requested scope', async () => {
    const cli = makeCli();
    await cli.container.ctx.cache.putDerived('misc', 'k', { hello: 'world' });
    expect(await runCli(['cache', 'clear', 'derived'], cli.deps)).toBe(EXIT.ok);
    expect(cli.out.join('')).toMatch(/^Cleared derived indexes in \(memory\) \(\d+ B freed\)\n$/);
    expect((await cli.container.ctx.cache.info()).entries).toBe(0);
  });
});

describe('runCli: warm', () => {
  it('builds the indexes of each product on its current line', async () => {
    const cli = makeCli({ indexStates: [[ready]] });
    expect(await runCli(['warm', 'widgets'], cli.deps)).toBe(EXIT.ok);
    expect(cli.container.ensured).toEqual([
      { product: 'widgets-sdk', sources: undefined, line: 'latest' },
    ]);
    expect(cli.out.join('')).toBe(
      'widgets-sdk (latest)\n  guide: ready, 42 records, built 2026-10-13T08:00:00.000Z\n',
    );
  });

  it('exits 1 when a product ends without a usable index', async () => {
    const cli = makeCli({ indexStates: [[{ ...ready, state: 'unavailable', records: 0 }]] });
    expect(await runCli(['warm', 'widgets-sdk'], cli.deps)).toBe(EXIT.failure);
    expect(cli.out.join('')).toContain('guide: unavailable, 0 records');
  });

  it('renders an unknown product as a catalogue error with candidates', async () => {
    const cli = makeCli();
    expect(await runCli(['warm', 'widgets-sdk', 'widgets-sdx'], cli.deps)).toBe(EXIT.failure);
    expect(cli.err.join('')).toMatch(
      /^Error \[UNKNOWN_PRODUCT\]: No product matches "widgets-sdx"\./,
    );
    expect(cli.err.join('')).toContain('Candidates: widgets-sdk');
    // Names are resolved before any index is built.
    expect(cli.container.ensured).toEqual([]);
  });
});

describe('runCli: call', () => {
  it('runs one tool through a server instance and prints its text', async () => {
    const cli = makeCli();
    expect(await runCli(['call', 'search', '{"query":"clustering"}'], cli.deps)).toBe(EXIT.ok);
    expect(cli.out).toEqual(['echo: clustering\n']);
    expect(cli.err).toEqual([]);
  });

  it('exits 1 for a tool error and still prints the text', async () => {
    const cli = makeCli();
    const code = await runCli(['call', TOOLS.search, '{"query":"x y","fail":true}'], cli.deps);
    expect(code).toBe(EXIT.failure);
    expect(cli.out).toEqual(['echo: x y\n']);
  });

  it('exits 1 when the arguments fail the input schema', async () => {
    const cli = makeCli();
    expect(await runCli(['call', 'search', '{"query":"x"}'], cli.deps)).toBe(EXIT.failure);
    expect(cli.out.join('')).toMatch(/query/);
  });

  it('exits 2 for a tool that does not exist, before loading anything', async () => {
    const cli = makeCli();
    expect(await runCli(['call', 'arcgis_docs_status'], cli.deps)).toBe(EXIT.usage);
    expect(cli.loads()).toBe(0);
  });
});

describe('runCli: doctor', () => {
  it('prints the text report with progress on stderr and exits 0', async () => {
    const cli = makeCli();
    expect(await runCli(['doctor'], cli.deps)).toBe(EXIT.ok);
    expect(cli.out.join('')).toContain('Result: ok');
    expect(cli.err).toEqual(['probing 1 sources\n', 'ok widgets-sdk/guide\n']);
  });

  it('prints only JSON with --json', async () => {
    const cli = makeCli();
    expect(await runCli(['doctor', '--json', '--tier', 'all'], cli.deps)).toBe(EXIT.ok);
    expect(cli.err).toEqual([]);
    const report = JSON.parse(cli.out.join('')) as { exitCode: number; probes: unknown[] };
    expect(report.exitCode).toBe(0);
    expect(report.probes).toHaveLength(1);
  });

  it('exits 1 when a floor source of a developer product fails', async () => {
    const adapter = new FakeAdapter('gatsby').failOn(
      'probe',
      new McpDocError('UPSTREAM_UNAVAILABLE', 'no answer'),
    );
    const cli = makeCli({ adapters: [adapter] });
    expect(await runCli(['doctor'], cli.deps)).toBe(EXIT.failure);
    expect(cli.out.join('')).toContain('Floor sources not reachable: widgets-sdk/guide');
  });

  it('checks the cache directory through the injected file-system probe', async () => {
    const dirs: string[] = [];
    const cli = makeCli({
      deps: {
        checkWritable: async (dir) => {
          dirs.push(dir);
          return 'EROFS';
        },
      },
    });
    expect(await runCli(['doctor', '--product', 'widgets-sdk'], cli.deps)).toBe(EXIT.failure);
    expect(dirs).toEqual(['(memory)']);
  });
});

describe('describeError', () => {
  it('renders the catalogue form with why, next and candidates', () => {
    const error = new McpDocError('SOURCE_DISABLED', 'doc.esri.com needs capability "website"', {
      why: 'the capability is switched off',
      next: 'set ARCGIS_DOCS_SOURCES=+website',
      candidates: ['a', 'b'],
    });
    expect(describeError(error)).toBe(
      'Error [SOURCE_DISABLED]: doc.esri.com needs capability "website". ' +
        'the capability is switched off. Next: set ARCGIS_DOCS_SOURCES=+website Candidates: a, b\n',
    );
  });

  it('renders other values as a plain message', () => {
    expect(describeError(new TypeError('bad'))).toBe('Error: bad\n');
    expect(describeError('text')).toBe('Error: text\n');
  });
});
