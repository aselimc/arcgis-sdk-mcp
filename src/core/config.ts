/**
 * Runtime configuration (design sections 5.4 and 6.3). `loadConfig` is the only place that
 * interprets environment variables; every other module receives a {@link Config}.
 */
import * as z from 'zod/v4';
import {
  CAPABILITIES,
  ConfigError,
  PRESET_NAMES,
  STDIO_ONLY_CAPABILITIES,
  parseSources,
  type Preset,
} from './capabilities.js';
import type { Capability } from './types.js';

/** Hard limits applied to one tool call or one index build. */
export interface Limits {
  /** Upstream requests one tool call may issue. */
  requestsPerCall: number;
  /** Upstream requests one index build may issue. */
  requestsPerIndexBuild: number;
  /** Deadline of a tool call's request budget. */
  callDeadlineMs: number;
  /** Deadline after which an index build continues in the background. */
  indexBuildDeadlineMs: number;
  /** Size cap of a page body. */
  pageMaxBytes: number;
  /** Size cap of an index file. */
  indexMaxBytes: number;
}

/** Log verbosity; `silent` writes nothing. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/** Effective configuration of one server process. */
export interface Config {
  /** This package's version (read from package.json by the composition root and passed in). */
  version: string;
  /** Project URL, used in the User-Agent. */
  repoUrl: string;
  mode: 'stdio' | 'http';
  preset: Preset;
  /** Preset plus and minus overrides; `workspace` and `local-packages` are forced off in http mode. */
  capabilities: ReadonlySet<Capability>;
  offline: boolean;
  /** Override only; the default is resolved by `src/cache/paths.ts`. */
  cacheDir?: string | undefined;
  cacheMaxMb: number;
  /** Budget for loaded indexes and parsed documents. */
  memoryMaxMb: number;
  /** The user's project; `ARCGIS_DOCS_PROJECT_DIR` or the working directory. */
  projectDir: string;
  defaultMaxTokens: number;
  githubToken?: string | undefined;
  logLevel: LogLevel;
  limits: Limits;
}

/** The limits of design section 5.4. */
export const DEFAULT_LIMITS: Readonly<Limits> = {
  requestsPerCall: 12,
  requestsPerIndexBuild: 30,
  callDeadlineMs: 25_000,
  indexBuildDeadlineMs: 20_000,
  pageMaxBytes: 8_388_608,
  indexMaxBytes: 33_554_432,
};

/** Defaults of the tunable values. */
export const CONFIG_DEFAULTS = {
  cacheMaxMb: 500,
  memoryMaxMb: 256,
  defaultMaxTokens: 6000,
  logLevel: 'warn',
} as const satisfies Partial<Config>;

const LOG_LEVELS = [
  'debug',
  'info',
  'warn',
  'error',
  'silent',
] as const satisfies readonly LogLevel[];

const positiveInt = z.number().int().positive();

/** Bounds of `ARCGIS_DOCS_MAX_TOKENS`, the same as of `max_tokens` on `arcgis_docs_read`. */
const MIN_MAX_TOKENS = 500;
const MAX_MAX_TOKENS = 20_000;

/** Validates a complete {@link Config}; `loadConfig` runs its result through this schema. */
export const ConfigSchema: z.ZodType<Config> = z.object({
  version: z.string().min(1),
  repoUrl: z.string().regex(/^https:\/\/\S+$/, 'must be an https URL'),
  mode: z.enum(['stdio', 'http']),
  preset: z.enum(PRESET_NAMES),
  capabilities: z.set(z.enum(CAPABILITIES)),
  offline: z.boolean(),
  cacheDir: z.string().min(1).optional(),
  cacheMaxMb: positiveInt,
  memoryMaxMb: positiveInt,
  projectDir: z.string().min(1),
  defaultMaxTokens: z.number().int().min(MIN_MAX_TOKENS).max(MAX_MAX_TOKENS),
  githubToken: z.string().min(1).optional(),
  logLevel: z.enum(LOG_LEVELS),
  limits: z.object({
    requestsPerCall: positiveInt,
    requestsPerIndexBuild: positiveInt,
    callDeadlineMs: positiveInt,
    indexBuildDeadlineMs: positiveInt,
    pageMaxBytes: positiveInt,
    indexMaxBytes: positiveInt,
  }),
});

function text(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

/** Range a variable accepts, stated in its error message. */
interface Range {
  min: number;
  max?: number;
}

function integer(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  range: Range = { min: 0 },
): number {
  const raw = text(env, name);
  if (raw === undefined) return fallback;
  const accepted =
    range.max === undefined
      ? `a whole number of at least ${range.min}`
      : `a whole number from ${range.min} to ${range.max}`;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || value < range.min || (range.max !== undefined && value > range.max)) {
    throw new ConfigError(`${name}: expected ${accepted}, got "${raw}"`);
  }
  return value;
}

function flag(env: NodeJS.ProcessEnv, name: string): boolean {
  const raw = text(env, name)?.toLowerCase();
  if (raw === undefined || ['0', 'false', 'no', 'off'].includes(raw)) return false;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  throw new ConfigError(`${name}: expected 1 or 0, got "${raw}"`);
}

function logLevel(env: NodeJS.ProcessEnv): LogLevel {
  const raw = text(env, 'ARCGIS_DOCS_LOG_LEVEL')?.toLowerCase();
  if (raw === undefined) return CONFIG_DEFAULTS.logLevel;
  const level = LOG_LEVELS.find((candidate) => candidate === raw);
  if (level === undefined) {
    throw new ConfigError(
      `ARCGIS_DOCS_LOG_LEVEL: expected one of ${LOG_LEVELS.join(', ')}, got "${raw}"`,
    );
  }
  return level;
}

/**
 * Builds the configuration from environment variables.
 *
 * Variables: `ARCGIS_DOCS_SOURCES`, `ARCGIS_DOCS_OFFLINE`, `ARCGIS_DOCS_CACHE_DIR`,
 * `ARCGIS_DOCS_CACHE_MAX_MB`, `ARCGIS_DOCS_PROJECT_DIR`, `ARCGIS_DOCS_MAX_TOKENS`,
 * `ARCGIS_DOCS_LOG_LEVEL`, `GITHUB_TOKEN`.
 *
 * @param argv `mode` from the command line; `cwd` replaces `process.cwd()` as the default
 *   project directory (tests and embedders).
 * @throws ConfigError naming the variable when a value is invalid.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv,
  argv: { mode: 'stdio' | 'http'; cwd?: string },
  pkg: { version: string; repoUrl: string },
): Config {
  const { preset, capabilities } = parseSources(env.ARCGIS_DOCS_SOURCES);
  if (argv.mode === 'http') {
    // A remote caller must never make the server read the host's file system.
    for (const capability of STDIO_ONLY_CAPABILITIES) capabilities.delete(capability);
  }

  const candidate: Config = {
    version: pkg.version,
    repoUrl: pkg.repoUrl,
    mode: argv.mode,
    preset,
    capabilities,
    offline: flag(env, 'ARCGIS_DOCS_OFFLINE'),
    cacheDir: text(env, 'ARCGIS_DOCS_CACHE_DIR'),
    cacheMaxMb: integer(env, 'ARCGIS_DOCS_CACHE_MAX_MB', CONFIG_DEFAULTS.cacheMaxMb, { min: 1 }),
    memoryMaxMb: CONFIG_DEFAULTS.memoryMaxMb,
    projectDir: text(env, 'ARCGIS_DOCS_PROJECT_DIR') ?? argv.cwd ?? process.cwd(),
    defaultMaxTokens: integer(env, 'ARCGIS_DOCS_MAX_TOKENS', CONFIG_DEFAULTS.defaultMaxTokens, {
      min: MIN_MAX_TOKENS,
      max: MAX_MAX_TOKENS,
    }),
    githubToken: text(env, 'GITHUB_TOKEN'),
    logLevel: logLevel(env),
    limits: { ...DEFAULT_LIMITS },
  };

  const parsed = ConfigSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ConfigError(
      `Invalid configuration at ${issue?.path.join('.') ?? '(root)'}: ${issue?.message ?? 'unknown'}`,
    );
  }
  return parsed.data;
}

/**
 * Settings of the HTTP transport only. They are kept out of {@link Config} on purpose: the
 * bearer token stays with the HTTP front door and never reaches `ctx.config`, which every
 * adapter and service can read.
 */
export interface HttpSettings {
  /** `ARCGIS_DOCS_HTTP_TOKEN`: the bearer token every `/mcp` request must carry, when set. */
  token?: string | undefined;
  /** `PORT`, the variable hosting platforms set; `--port` wins over it. */
  port?: number | undefined;
  /**
   * Host names accepted in `Host` and `Origin` besides the bind address and loopback:
   * `ARCGIS_DOCS_HTTP_ALLOWED_HOSTS` plus the deployment's own names on Vercel
   * (`VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_URL`, `VERCEL_BRANCH_URL`). Lower case, no port.
   */
  allowedHosts: string[];
  /** The hosting platform detected from its environment, or `undefined` on a plain machine. */
  platform?: string | undefined;
}

/** Shortest accepted bearer token: 32 characters, such as `openssl rand -hex 16` prints. */
export const MIN_HTTP_TOKEN_LENGTH = 32;

/** RFC 6750 `b64token`: the characters a bearer token may consist of. */
const B64TOKEN = /^[A-Za-z0-9\-._~+/]+=*$/;

/**
 * Environment variables that only a hosting platform sets, and the platform each names.
 * Detecting one makes the HTTP server refuse to serve without a token, whatever it binds.
 */
export const HOSTING_PLATFORMS: ReadonlyArray<{ variable: string; name: string }> = [
  { variable: 'VERCEL', name: 'Vercel' },
  { variable: 'K_SERVICE', name: 'Google Cloud Run' },
  { variable: 'AWS_LAMBDA_FUNCTION_NAME', name: 'AWS Lambda' },
  { variable: 'FLY_APP_NAME', name: 'Fly.io' },
  { variable: 'RENDER', name: 'Render' },
  { variable: 'RAILWAY_ENVIRONMENT', name: 'Railway' },
  { variable: 'DYNO', name: 'Heroku' },
  { variable: 'WEBSITE_SITE_NAME', name: 'Azure App Service' },
];

/** Vercel's own host names of a deployment; none of them includes the scheme. */
const VERCEL_HOST_VARIABLES = ['VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_URL', 'VERCEL_BRANCH_URL'];

/** A DNS name, an IPv4 address or a bracketed IPv6 address; no scheme, port or path. */
const HOST_NAME = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*|\[[0-9a-f:.]+\])$/;

function httpToken(env: NodeJS.ProcessEnv): string | undefined {
  const token = text(env, 'ARCGIS_DOCS_HTTP_TOKEN');
  if (token === undefined) return undefined;
  if (!B64TOKEN.test(token)) {
    throw new ConfigError(
      'ARCGIS_DOCS_HTTP_TOKEN: expected letters, digits and - . _ ~ + / (a bearer token), ' +
        'for example the output of "openssl rand -hex 32"',
    );
  }
  if (token.length < MIN_HTTP_TOKEN_LENGTH) {
    throw new ConfigError(
      `ARCGIS_DOCS_HTTP_TOKEN: expected at least ${MIN_HTTP_TOKEN_LENGTH} characters, got ${token.length}. ` +
        'Generate one with "openssl rand -hex 32"',
    );
  }
  return token;
}

function hostList(raw: string | undefined, name: string): string[] {
  if (raw === undefined) return [];
  return raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== '')
    .map((item) => {
      if (!HOST_NAME.test(item)) {
        throw new ConfigError(
          `${name}: expected host names without scheme, port or path (for example ` +
            `"docs.example.com"), got "${item}"`,
        );
      }
      return item;
    });
}

/**
 * Reads the settings of the HTTP transport: `ARCGIS_DOCS_HTTP_TOKEN`,
 * `ARCGIS_DOCS_HTTP_ALLOWED_HOSTS`, `PORT`, and the variables that identify a hosting
 * platform (see {@link HOSTING_PLATFORMS}).
 *
 * @throws ConfigError naming the variable when a value is invalid: a token shorter than
 *   {@link MIN_HTTP_TOKEN_LENGTH} or with characters a bearer token cannot have, a port out of
 *   range, a host given with a scheme or port.
 */
export function loadHttpSettings(env: NodeJS.ProcessEnv): HttpSettings {
  const platform = HOSTING_PLATFORMS.find(({ variable }) => text(env, variable) !== undefined);
  const allowed = hostList(text(env, 'ARCGIS_DOCS_HTTP_ALLOWED_HOSTS'), 'ARCGIS_DOCS_HTTP_ALLOWED_HOSTS');
  if (platform?.variable === 'VERCEL') {
    for (const variable of VERCEL_HOST_VARIABLES) allowed.push(...hostList(text(env, variable), variable));
  }
  return {
    token: httpToken(env),
    port:
      text(env, 'PORT') === undefined ? undefined : integer(env, 'PORT', 0, { min: 0, max: 65_535 }),
    allowedHosts: [...new Set(allowed)],
    platform: platform?.name,
  };
}
