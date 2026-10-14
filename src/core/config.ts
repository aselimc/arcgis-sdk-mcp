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
