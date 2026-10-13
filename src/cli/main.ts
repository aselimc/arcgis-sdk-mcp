#!/usr/bin/env node
/**
 * The `arcgis-sdk-mcp` binary. This file only binds the dispatcher of `run.ts` to the real
 * process; it has no logic of its own to test.
 *
 * The application modules and the serving entry points are imported on demand, so
 * `--version` and `--help` answer without loading the registry, the renderers or the MCP SDK.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { readPackageInfo } from '../app/package-info.js';
import { runCli, type CliDeps } from './run.js';
import { checkWritable } from './writable.js';

const stderr = (text: string): void => {
  process.stderr.write(text);
};

const deps: CliDeps = {
  env: process.env,
  cwd: process.cwd(),
  nodeVersion: process.versions.node,
  pkg: readPackageInfo(),
  out: (text) => {
    process.stdout.write(text);
  },
  err: stderr,
  loadApp: async () => {
    const [{ createContainer }, { createServer }] = await Promise.all([
      import('../app/composition-root.js'),
      import('../mcp/server.js'),
    ]);
    return { createContainer, createServer };
  },
  serveStdio: async (factory, logger) => (await import('./stdio.js')).startStdio(factory, logger),
  serveHttp: async (options) => (await import('./http.js')).startHttp(options),
  onShutdown: (close) => {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => {
        void close().finally(() => process.exit(0));
      });
    }
  },
  checkWritable,
  sleep: async (ms) => {
    await sleep(ms);
  },
};

// A background index build that fails after its tool call has returned must not take the
// server down with it; the failure is logged where the host collects diagnostics.
process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
  stderr(
    `${JSON.stringify({ t: new Date().toISOString(), level: 'error', msg: 'unhandled rejection', error: message })}\n`,
  );
});

const code = await runCli(process.argv.slice(2), deps);
if (code !== undefined) {
  process.exitCode = code;
  // Exit explicitly once stdout has drained: rate-limiter and cache timers may still be
  // pending after a one-shot command, and a piped report must not be cut short.
  process.stdout.write('', () => process.exit(code));
}
