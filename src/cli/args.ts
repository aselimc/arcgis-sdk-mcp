/**
 * Command-line grammar of the `arcgis-sdk-mcp` binary. Pure: it turns `argv` into a
 * {@link Command} or throws {@link UsageError}; nothing is started or read here.
 */
import { parseArgs } from 'node:util';
import { PACKAGE_NAME, TOOL_ORDER, type ToolName } from '../core/names.js';

/** Default port of `--http`. */
export const DEFAULT_HTTP_PORT = 3333;

/** Default bind address of `--http`. */
export const DEFAULT_HTTP_HOST = '127.0.0.1';

/** A command line that cannot be run; the CLI prints the message and exits with status 2. */
export class UsageError extends Error {
  override readonly name = 'UsageError';
}

/** Which products `doctor` probes when no `--product` is given. */
export type DoctorTier = 'developer' | 'all';

/** Part of the cache `cache clear` removes. */
export type CacheScope = 'http' | 'derived' | 'all';

/** One parsed invocation. */
export type Command =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'serve-stdio' }
  | { kind: 'serve-http'; port: number; host: string; allowRemote: boolean }
  | { kind: 'doctor'; product?: string; tier: DoctorTier; json: boolean }
  | { kind: 'cache-info' }
  | { kind: 'cache-clear'; scope: CacheScope }
  | { kind: 'warm'; products: string[] }
  | { kind: 'call'; tool: ToolName; args: Record<string, unknown> };

const OPTIONS = {
  http: { type: 'boolean' },
  port: { type: 'string' },
  host: { type: 'string' },
  'allow-remote': { type: 'boolean' },
  product: { type: 'string' },
  tier: { type: 'string' },
  json: { type: 'boolean' },
  version: { type: 'boolean', short: 'v' },
  help: { type: 'boolean', short: 'h' },
} as const;

type OptionName = keyof typeof OPTIONS;

/** Options each sub-command accepts; anything else is a usage error rather than ignored. */
const ALLOWED: Readonly<Record<string, readonly OptionName[]>> = {
  serve: ['http', 'port', 'host', 'allow-remote'],
  doctor: ['product', 'tier', 'json'],
  cache: [],
  warm: [],
  call: [],
};

/** The text of `--help`. */
export const HELP_TEXT = `${PACKAGE_NAME}: MCP server for Esri ArcGIS developer documentation (unofficial)

Usage:
  ${PACKAGE_NAME}                          Serve MCP over stdio (what an MCP host runs)
  ${PACKAGE_NAME} --http [--port ${DEFAULT_HTTP_PORT}] [--host ${DEFAULT_HTTP_HOST}]
                                          Serve MCP over HTTP at /mcp (health check at /healthz).
                                          Loopback only; any other --host needs --allow-remote
  ${PACKAGE_NAME} doctor [--product <id>] [--tier developer|all] [--json]
                                          Check configuration, cache, proxy and upstream sources.
                                          Exits 1 when a floor source of a developer product fails
  ${PACKAGE_NAME} cache info               Show the cache directory, size and entry count
  ${PACKAGE_NAME} cache clear [http|derived|all]
                                          Delete cached responses, derived indexes, or both (default)
  ${PACKAGE_NAME} warm <product...>        Build the search indexes of the given products
  ${PACKAGE_NAME} call <tool> ['<json>']   Run one tool and print its text result
  ${PACKAGE_NAME} --version | --help

Tools: ${TOOL_ORDER.join(', ')}

Environment:
  ARCGIS_DOCS_SOURCES      preset (strict | standard) and/or +capability / -capability, comma separated
  ARCGIS_DOCS_OFFLINE      1 = answer from the cache only
  ARCGIS_DOCS_CACHE_DIR    cache directory (default: the per-user cache directory)
  ARCGIS_DOCS_CACHE_MAX_MB cache size cap (default 500)
  ARCGIS_DOCS_PROJECT_DIR  project to detect SDK versions in (default: the working directory)
  ARCGIS_DOCS_MAX_TOKENS   default size of a tool result (default 6000)
  ARCGIS_DOCS_LOG_LEVEL    debug | info | warn | error | silent (default warn; logs go to stderr)
  GITHUB_TOKEN             raises the GitHub API quota from 60 to 5000 requests per hour
`;

/** True for a host name or address that only this machine can reach. */
export function isLoopbackHost(host: string): boolean {
  const name = host.trim().toLowerCase();
  return (
    name === 'localhost' || name === '::1' || name === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(name)
  );
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_HTTP_PORT;
  const port = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(port) || port > 65_535) {
    throw new UsageError(`--port: expected a number from 0 to 65535, got "${raw}"`);
  }
  return port;
}

function parseTool(raw: string | undefined): ToolName {
  if (raw === undefined) {
    throw new UsageError(`call: name a tool. Tools: ${TOOL_ORDER.join(', ')}`);
  }
  // The short form drops the common prefix: `search`, `lookup-symbol`.
  const candidates = [raw, `arcgis_docs_${raw.replace(/-/g, '_')}`];
  const tool = TOOL_ORDER.find((name) => candidates.includes(name));
  if (tool === undefined) {
    throw new UsageError(`call: unknown tool "${raw}". Tools: ${TOOL_ORDER.join(', ')}`);
  }
  return tool;
}

function parseToolArgs(raw: string | undefined): Record<string, unknown> {
  if (raw === undefined) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new UsageError(`call: the arguments are not valid JSON (${reason})`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new UsageError(
      'call: the arguments must be a JSON object, for example \'{"query":"x"}\'',
    );
  }
  return value as Record<string, unknown>;
}

function expectNoMore(command: string, rest: readonly string[], max: number): void {
  if (rest.length > max) {
    throw new UsageError(`${command}: unexpected argument "${rest[max] ?? ''}"`);
  }
}

/**
 * Parses the arguments after the binary name.
 *
 * `--help` and `--version` win wherever they appear, so that asking for help never starts
 * a server or fails on the rest of the line.
 *
 * @throws UsageError for unknown options or commands, options that do not belong to the
 *   command, malformed values, and a non-loopback `--host` without `--allow-remote`.
 */
export function parseCli(argv: readonly string[]): Command {
  let parsed;
  try {
    parsed = parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    // Node appends advice about `--` that does not apply here; the first sentence says it all.
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(message.split('. ')[0] ?? message);
  }
  const { values, positionals } = parsed;
  const [first, ...rest] = positionals;

  if (values.help === true || first === 'help') return { kind: 'help' };
  if (values.version === true || first === 'version') return { kind: 'version' };

  const command = first ?? 'serve';
  const allowed = ALLOWED[command];
  if (allowed === undefined) {
    throw new UsageError(`Unknown command "${command}"`);
  }
  for (const name of Object.keys(values) as OptionName[]) {
    if (!allowed.includes(name)) {
      throw new UsageError(`--${name} is not an option of "${command}"`);
    }
  }

  switch (command) {
    case 'doctor': {
      expectNoMore(command, rest, 0);
      const tier = values.tier ?? 'developer';
      if (tier !== 'developer' && tier !== 'all') {
        throw new UsageError(`--tier: expected developer or all, got "${tier}"`);
      }
      return {
        kind: 'doctor',
        ...(values.product === undefined ? {} : { product: values.product }),
        tier,
        json: values.json === true,
      };
    }
    case 'cache': {
      const [action, scope = 'all'] = rest;
      if (action === 'info') {
        expectNoMore(command, rest, 1);
        return { kind: 'cache-info' };
      }
      if (action !== 'clear') {
        throw new UsageError('cache: expected "info" or "clear"');
      }
      expectNoMore(command, rest, 2);
      if (scope !== 'http' && scope !== 'derived' && scope !== 'all') {
        throw new UsageError(`cache clear: expected http, derived or all, got "${scope}"`);
      }
      return { kind: 'cache-clear', scope };
    }
    case 'warm':
      if (rest.length === 0) throw new UsageError('warm: name at least one product');
      return { kind: 'warm', products: rest };
    case 'call':
      expectNoMore(command, rest, 2);
      return { kind: 'call', tool: parseTool(rest[0]), args: parseToolArgs(rest[1]) };
    default: {
      expectNoMore(command, rest, 0);
      if (values.http !== true) {
        const stray = (['port', 'host', 'allow-remote'] as const).find(
          (name) => values[name] !== undefined,
        );
        if (stray !== undefined) throw new UsageError(`--${stray} needs --http`);
        return { kind: 'serve-stdio' };
      }
      const host = values.host ?? DEFAULT_HTTP_HOST;
      const allowRemote = values['allow-remote'] === true;
      if (!isLoopbackHost(host) && !allowRemote) {
        throw new UsageError(
          `--host ${host} is not a loopback address. The HTTP server has no authentication; ` +
            'pass --allow-remote to bind it anyway',
        );
      }
      return { kind: 'serve-http', port: parsePort(values.port), host, allowRemote };
    }
  }
}
