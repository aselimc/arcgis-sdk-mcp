import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HTTP_HOST,
  HELP_TEXT,
  UsageError,
  isLoopbackHost,
  parseCli,
} from '../../src/cli/args.js';
import { TOOLS, TOOL_ORDER } from '../../src/core/names.js';

describe('parseCli: serving', () => {
  it('serves stdio when there are no arguments', () => {
    expect(parseCli([])).toEqual({ kind: 'serve-stdio' });
    expect(parseCli(['serve'])).toEqual({ kind: 'serve-stdio' });
  });

  it('serves HTTP on the loopback defaults, leaving the port to PORT or the default', () => {
    expect(parseCli(['--http'])).toEqual({
      kind: 'serve-http',
      host: DEFAULT_HTTP_HOST,
      allowRemote: false,
    });
  });

  it('accepts a port and a loopback host', () => {
    expect(parseCli(['--http', '--port', '0', '--host', 'localhost'])).toMatchObject({
      port: 0,
      host: 'localhost',
    });
    expect(parseCli(['--http', '--port=8080', '--host', '::1'])).toMatchObject({ port: 8080 });
  });

  it.each(['abc', '-1', '70000', '80.5', ''])('rejects port %j', (port) => {
    expect(() => parseCli(['--http', `--port=${port}`])).toThrow(UsageError);
  });

  it('refuses a non-loopback host without --allow-remote', () => {
    expect(() => parseCli(['--http', '--host', '0.0.0.0'])).toThrow(/--allow-remote/);
    expect(() => parseCli(['--http', '--host', '192.168.1.20'])).toThrow(UsageError);
  });

  it('binds a non-loopback host with --allow-remote', () => {
    expect(parseCli(['--http', '--host', '0.0.0.0', '--allow-remote'])).toEqual({
      kind: 'serve-http',
      host: '0.0.0.0',
      allowRemote: true,
    });
  });

  it.each(['--port=1', '--host=localhost', '--allow-remote'])(
    'rejects %s without --http',
    (option) => {
      expect(() => parseCli([option])).toThrow(/needs --http/);
    },
  );
});

describe('parseCli: help and version', () => {
  it.each([['--help'], ['-h'], ['help'], ['doctor', '--help'], ['--http', '-h']])(
    'answers help for %j',
    (...argv) => {
      expect(parseCli(argv)).toEqual({ kind: 'help' });
    },
  );

  it.each([['--version'], ['-v'], ['version'], ['warm', '--version']])(
    'answers version for %j',
    (...argv) => {
      expect(parseCli(argv)).toEqual({ kind: 'version' });
    },
  );

  it('documents every command, tool and environment variable', () => {
    for (const word of ['--http', 'doctor', 'cache info', 'cache clear', 'warm', 'call']) {
      expect(HELP_TEXT).toContain(word);
    }
    for (const tool of TOOL_ORDER) expect(HELP_TEXT).toContain(tool);
    for (const name of [
      'ARCGIS_DOCS_SOURCES',
      'ARCGIS_DOCS_OFFLINE',
      'ARCGIS_DOCS_CACHE_DIR',
      'ARCGIS_DOCS_CACHE_MAX_MB',
      'ARCGIS_DOCS_PROJECT_DIR',
      'ARCGIS_DOCS_MAX_TOKENS',
      'ARCGIS_DOCS_LOG_LEVEL',
      'GITHUB_TOKEN',
      'ARCGIS_DOCS_HTTP_TOKEN',
      'ARCGIS_DOCS_HTTP_ALLOWED_HOSTS',
      'PORT',
    ]) {
      expect(HELP_TEXT).toContain(name);
    }
  });
});

describe('parseCli: doctor', () => {
  it('defaults to the developer tier and text output', () => {
    expect(parseCli(['doctor'])).toEqual({ kind: 'doctor', tier: 'developer', json: false });
  });

  it('takes a product, a tier and --json', () => {
    expect(parseCli(['doctor', '--product', 'js-maps-sdk', '--tier', 'all', '--json'])).toEqual({
      kind: 'doctor',
      product: 'js-maps-sdk',
      tier: 'all',
      json: true,
    });
  });

  it('rejects an unknown tier and stray arguments', () => {
    expect(() => parseCli(['doctor', '--tier', 'help'])).toThrow(/developer or all/);
    expect(() => parseCli(['doctor', 'now'])).toThrow(/unexpected argument "now"/);
  });
});

describe('parseCli: cache, warm, call', () => {
  it('parses cache info and cache clear with its scopes', () => {
    expect(parseCli(['cache', 'info'])).toEqual({ kind: 'cache-info' });
    expect(parseCli(['cache', 'clear'])).toEqual({ kind: 'cache-clear', scope: 'all' });
    expect(parseCli(['cache', 'clear', 'http'])).toEqual({ kind: 'cache-clear', scope: 'http' });
    expect(parseCli(['cache', 'clear', 'derived'])).toEqual({
      kind: 'cache-clear',
      scope: 'derived',
    });
  });

  it('rejects other cache actions and scopes', () => {
    expect(() => parseCli(['cache'])).toThrow(/info.*clear/);
    expect(() => parseCli(['cache', 'purge'])).toThrow(UsageError);
    expect(() => parseCli(['cache', 'clear', 'everything'])).toThrow(/http, derived or all/);
    expect(() => parseCli(['cache', 'info', 'extra'])).toThrow(/unexpected argument/);
  });

  it('collects the products to warm', () => {
    expect(parseCli(['warm', 'js-maps-sdk', 'rest-api/portal'])).toEqual({
      kind: 'warm',
      products: ['js-maps-sdk', 'rest-api/portal'],
    });
    expect(() => parseCli(['warm'])).toThrow(/at least one product/);
  });

  it('parses a tool call with JSON arguments', () => {
    expect(parseCli(['call', TOOLS.search, '{"query":"clustering","limit":3}'])).toEqual({
      kind: 'call',
      tool: TOOLS.search,
      args: { query: 'clustering', limit: 3 },
    });
  });

  it('accepts short tool names and defaults the arguments to an empty object', () => {
    expect(parseCli(['call', 'list-products'])).toEqual({
      kind: 'call',
      tool: TOOLS.listProducts,
      args: {},
    });
    expect(parseCli(['call', 'lookup_symbol', '{"symbol":"Map"}'])).toMatchObject({
      tool: TOOLS.lookupSymbol,
    });
  });

  it('rejects unknown tools and arguments that are not a JSON object', () => {
    expect(() => parseCli(['call'])).toThrow(/name a tool/);
    expect(() => parseCli(['call', 'arcgis_docs_status'])).toThrow(/unknown tool/);
    expect(() => parseCli(['call', 'search', '{query:1}'])).toThrow(/not valid JSON/);
    expect(() => parseCli(['call', 'search', '[1]'])).toThrow(/JSON object/);
    expect(() => parseCli(['call', 'search', '"text"'])).toThrow(/JSON object/);
    expect(() => parseCli(['call', 'search', '{}', 'more'])).toThrow(/unexpected argument/);
  });
});

describe('parseCli: errors', () => {
  it('rejects unknown commands and options', () => {
    expect(() => parseCli(['status'])).toThrow(/Unknown command "status"/);
    expect(() => parseCli(['--verbose'])).toThrow(UsageError);
  });

  it('rejects an option that belongs to another command', () => {
    expect(() => parseCli(['doctor', '--http'])).toThrow(/--http is not an option of "doctor"/);
    expect(() => parseCli(['--json'])).toThrow(/--json is not an option of "serve"/);
    expect(() => parseCli(['warm', 'x', '--product', 'y'])).toThrow(UsageError);
  });
});

describe('isLoopbackHost', () => {
  it.each(['localhost', 'LOCALHOST', '127.0.0.1', '127.8.9.1', '::1', '[::1]'])(
    'accepts %s',
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    },
  );

  it.each(['0.0.0.0', '::', '192.168.0.1', 'example.com', '127.0.0.1.example.com', ''])(
    'rejects %j',
    (host) => {
      expect(isLoopbackHost(host)).toBe(false);
    },
  );
});
