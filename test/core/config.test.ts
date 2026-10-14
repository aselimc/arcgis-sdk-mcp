import { describe, expect, it, vi } from 'vitest';
import {
  CAPABILITIES,
  ConfigError,
  DEFAULT_PRESET,
  PRESETS,
  STDIO_ONLY_CAPABILITIES,
  isCapability,
  parseSources,
} from '../../src/core/capabilities.js';
import {
  CONFIG_DEFAULTS,
  ConfigSchema,
  DEFAULT_LIMITS,
  loadConfig,
} from '../../src/core/config.js';
import type { Capability } from '../../src/core/types.js';
import { makeConfig } from '../support/builders.js';

const pkg = { version: '1.2.3', repoUrl: 'https://github.com/aselimc/arcgis-sdk-mcp' };
const stdio = { mode: 'stdio', cwd: '/work/project' } as const;

const sorted = (set: Iterable<Capability>): Capability[] => [...set].sort();

describe('capability presets', () => {
  it('match the policy table of the design', () => {
    expect(sorted(PRESETS.strict)).toEqual(
      sorted(['github', 'registries', 'local-packages', 'workspace']),
    );
    expect(sorted(PRESETS.standard)).toEqual(
      sorted([
        'github',
        'registries',
        'local-packages',
        'workspace',
        'website',
        'site-index',
        'package-cdn',
      ]),
    );
    expect(DEFAULT_PRESET).toBe('standard');
  });

  it('never enable the opt-in capabilities', () => {
    for (const preset of Object.values(PRESETS)) {
      expect(preset).not.toContain('site-search');
      expect(preset).not.toContain('lifecycle-api');
    }
  });

  it('list every capability exactly once', () => {
    expect(new Set(CAPABILITIES).size).toBe(CAPABILITIES.length);
    expect(CAPABILITIES).toHaveLength(9);
    expect(isCapability('website')).toBe(true);
    expect(isCapability('websites')).toBe(false);
  });
});

describe('parseSources', () => {
  it('defaults to preset standard', () => {
    for (const value of [undefined, '', '  ', ' , ']) {
      const result = parseSources(value);
      expect(result.preset).toBe('standard');
      expect(sorted(result.capabilities)).toEqual(sorted(PRESETS.standard));
    }
  });

  it('applies a preset with additions and removals', () => {
    expect(sorted(parseSources('strict').capabilities)).toEqual(sorted(PRESETS.strict));
    expect(sorted(parseSources('strict,+website').capabilities)).toEqual(
      sorted([...PRESETS.strict, 'website']),
    );
    const result = parseSources(' Standard , -Package-CDN , +site-search ');
    expect(result.preset).toBe('standard');
    expect(result.capabilities.has('package-cdn')).toBe(false);
    expect(result.capabilities.has('site-search')).toBe(true);
  });

  it('accepts overrides without a preset and the preset in any position', () => {
    expect(parseSources('-site-index').capabilities.has('site-index')).toBe(false);
    expect(parseSources('-site-index').preset).toBe('standard');
    expect(sorted(parseSources('+website,strict').capabilities)).toEqual(
      sorted([...PRESETS.strict, 'website']),
    );
  });

  it('applies overrides left to right', () => {
    expect(parseSources('+site-search,-site-search').capabilities.has('site-search')).toBe(false);
    expect(parseSources('-website,+website').capabilities.has('website')).toBe(true);
  });

  it('returns a fresh set each time', () => {
    parseSources('standard').capabilities.clear();
    expect(parseSources('standard').capabilities.size).toBe(PRESETS.standard.length);
  });

  it.each([
    ['extended', /unknown item "extended"/],
    ['+esearch', /unknown capability "esearch"/],
    ['-', /unknown capability ""/],
    ['strict,standard', /more than one preset/],
    ['website', /unknown item "website"/],
  ])('rejects %j', (value, message) => {
    expect(() => parseSources(value)).toThrow(ConfigError);
    expect(() => parseSources(value)).toThrow(message);
  });
});

describe('loadConfig', () => {
  it('applies the documented defaults', () => {
    const config = loadConfig({}, stdio, pkg);
    expect(config).toMatchObject({
      version: '1.2.3',
      repoUrl: pkg.repoUrl,
      mode: 'stdio',
      preset: 'standard',
      offline: false,
      cacheMaxMb: 500,
      memoryMaxMb: 256,
      projectDir: '/work/project',
      defaultMaxTokens: 6000,
      logLevel: 'warn',
      limits: {
        requestsPerCall: 12,
        requestsPerIndexBuild: 30,
        callDeadlineMs: 25_000,
        indexBuildDeadlineMs: 20_000,
        pageMaxBytes: 8_388_608,
        indexMaxBytes: 33_554_432,
      },
    });
    expect(config.cacheDir).toBeUndefined();
    expect(config.githubToken).toBeUndefined();
    expect(sorted(config.capabilities)).toEqual(sorted(PRESETS.standard));
    expect(config.limits).not.toBe(DEFAULT_LIMITS);
    expect(CONFIG_DEFAULTS.logLevel).toBe('warn');
  });

  it('reads every variable', () => {
    const config = loadConfig(
      {
        ARCGIS_DOCS_SOURCES: 'strict,+website',
        ARCGIS_DOCS_OFFLINE: '1',
        ARCGIS_DOCS_CACHE_DIR: ' /tmp/cache ',
        ARCGIS_DOCS_CACHE_MAX_MB: '50',
        ARCGIS_DOCS_PROJECT_DIR: '/elsewhere',
        ARCGIS_DOCS_MAX_TOKENS: '3000',
        ARCGIS_DOCS_LOG_LEVEL: 'DEBUG',
        GITHUB_TOKEN: 'ghp_example',
      },
      stdio,
      pkg,
    );
    expect(config).toMatchObject({
      preset: 'strict',
      offline: true,
      cacheDir: '/tmp/cache',
      cacheMaxMb: 50,
      projectDir: '/elsewhere',
      defaultMaxTokens: 3000,
      logLevel: 'debug',
      githubToken: 'ghp_example',
    });
    expect(config.capabilities.has('website')).toBe(true);
    expect(config.capabilities.has('site-index')).toBe(false);
  });

  it('treats empty variables as unset', () => {
    const config = loadConfig(
      { GITHUB_TOKEN: '  ', ARCGIS_DOCS_CACHE_DIR: '', ARCGIS_DOCS_OFFLINE: '' },
      stdio,
      pkg,
    );
    expect(config.githubToken).toBeUndefined();
    expect(config.cacheDir).toBeUndefined();
    expect(config.offline).toBe(false);
  });

  it.each(['1', 'true', 'YES', 'on'])('ARCGIS_DOCS_OFFLINE=%s is on', (value) => {
    expect(loadConfig({ ARCGIS_DOCS_OFFLINE: value }, stdio, pkg).offline).toBe(true);
  });

  it.each(['0', 'false', 'No', 'off'])('ARCGIS_DOCS_OFFLINE=%s is off', (value) => {
    expect(loadConfig({ ARCGIS_DOCS_OFFLINE: value }, stdio, pkg).offline).toBe(false);
  });

  it('forces the file-system capabilities off in http mode, whatever the variable says', () => {
    const config = loadConfig(
      { ARCGIS_DOCS_SOURCES: 'standard,+workspace,+local-packages' },
      { mode: 'http', cwd: '/srv' },
      pkg,
    );
    expect(config.mode).toBe('http');
    for (const capability of STDIO_ONLY_CAPABILITIES) {
      expect(config.capabilities.has(capability)).toBe(false);
    }
    expect(config.capabilities.has('website')).toBe(true);
    for (const capability of STDIO_ONLY_CAPABILITIES) {
      expect(loadConfig({}, stdio, pkg).capabilities.has(capability)).toBe(true);
    }
  });

  it('uses the working directory when no project directory is given', () => {
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue('/from/process');
    expect(loadConfig({}, { mode: 'stdio' }, pkg).projectDir).toBe('/from/process');
    expect(cwd).toHaveBeenCalled();
  });

  it.each([
    [
      { ARCGIS_DOCS_CACHE_MAX_MB: 'lots' },
      /ARCGIS_DOCS_CACHE_MAX_MB: expected a whole number of at least 1, got "lots"/,
    ],
    [{ ARCGIS_DOCS_CACHE_MAX_MB: '-5' }, /ARCGIS_DOCS_CACHE_MAX_MB/],
    [
      { ARCGIS_DOCS_CACHE_MAX_MB: '0' },
      /^ARCGIS_DOCS_CACHE_MAX_MB: expected a whole number of at least 1, got "0"$/,
    ],
    [
      { ARCGIS_DOCS_MAX_TOKENS: '10' },
      /^ARCGIS_DOCS_MAX_TOKENS: expected a whole number from 500 to 20000, got "10"$/,
    ],
    [
      { ARCGIS_DOCS_MAX_TOKENS: '999999' },
      /^ARCGIS_DOCS_MAX_TOKENS: expected a whole number from 500 to 20000, got "999999"$/,
    ],
    [{ ARCGIS_DOCS_OFFLINE: 'maybe' }, /ARCGIS_DOCS_OFFLINE: expected 1 or 0/],
    [{ ARCGIS_DOCS_LOG_LEVEL: 'verbose' }, /ARCGIS_DOCS_LOG_LEVEL: expected one of/],
    [{ ARCGIS_DOCS_SOURCES: '+everything' }, /unknown capability "everything"/],
  ])('rejects %j with a message naming the problem', (env, message) => {
    expect(() => loadConfig(env, stdio, pkg)).toThrow(ConfigError);
    expect(() => loadConfig(env, stdio, pkg)).toThrow(message);
  });

  it('rejects package metadata that is not usable', () => {
    expect(() => loadConfig({}, stdio, { version: '', repoUrl: pkg.repoUrl })).toThrow(/version/);
    expect(() => loadConfig({}, stdio, { version: '1.0.0', repoUrl: 'not a url' })).toThrow(
      /repoUrl/,
    );
  });
});

describe('ConfigSchema', () => {
  it('accepts the test builder’s config and a loaded config', () => {
    expect(ConfigSchema.safeParse(makeConfig()).success).toBe(true);
    expect(ConfigSchema.safeParse(loadConfig({}, stdio, pkg)).success).toBe(true);
  });

  it('accepts tightened limits, which tests rely on', () => {
    const config = makeConfig({ limits: { ...DEFAULT_LIMITS, requestsPerCall: 2 } });
    expect(ConfigSchema.parse(config).limits.requestsPerCall).toBe(2);
  });

  it('rejects unknown capabilities, modes and non-positive limits', () => {
    const base = makeConfig();
    const bad = [
      { ...base, capabilities: new Set(['telepathy']) },
      { ...base, mode: 'sse' },
      { ...base, preset: 'extended' },
      { ...base, limits: { ...base.limits, requestsPerCall: 0 } },
      { ...base, capabilities: ['website'] },
    ];
    for (const candidate of bad) expect(ConfigSchema.safeParse(candidate).success).toBe(false);
  });
});
