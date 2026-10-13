import { describe, expect, it } from 'vitest';
import { CAPABILITIES, ConfigError, type Preset } from '../../src/core/capabilities.js';
import type { Capability } from '../../src/core/types.js';
import { createPolicy } from '../../src/policy/index.js';
import {
  effectiveCapabilities,
  isStdioOnly,
  presetCapabilities,
  resolveSources,
  sourcesValue,
  type Mode,
} from '../../src/policy/presets.js';
import { makeConfig } from '../support/builders.js';

/** The policy table of design section 6.3, written out cell by cell. */
const TABLE: Record<Capability, { strict: boolean; standard: boolean; stdioOnly: boolean }> = {
  github: { strict: true, standard: true, stdioOnly: false },
  registries: { strict: true, standard: true, stdioOnly: false },
  'local-packages': { strict: true, standard: true, stdioOnly: true },
  workspace: { strict: true, standard: true, stdioOnly: true },
  website: { strict: false, standard: true, stdioOnly: false },
  'site-index': { strict: false, standard: true, stdioOnly: false },
  'package-cdn': { strict: false, standard: true, stdioOnly: false },
  'site-search': { strict: false, standard: false, stdioOnly: false },
  'lifecycle-api': { strict: false, standard: false, stdioOnly: false },
};

const PRESET_LIST: Preset[] = ['strict', 'standard'];
const MODES: Mode[] = ['stdio', 'http'];

const cells = PRESET_LIST.flatMap((preset) =>
  MODES.flatMap((mode) =>
    CAPABILITIES.map((capability) => ({
      preset,
      mode,
      capability,
      expected: TABLE[capability][preset] && !(mode === 'http' && TABLE[capability].stdioOnly),
    })),
  ),
);

describe('the capability table', () => {
  it('covers every capability', () => {
    expect(Object.keys(TABLE).sort()).toEqual([...CAPABILITIES].sort());
    expect(cells).toHaveLength(2 * 2 * 9);
  });

  it.each(cells)(
    '$preset / $mode / $capability is $expected',
    ({ preset, mode, capability, expected }) => {
      expect(presetCapabilities(preset, mode).has(capability)).toBe(expected);
      expect(resolveSources(preset, mode).capabilities.has(capability)).toBe(expected);

      const config = makeConfig({
        preset,
        mode,
        capabilities: presetCapabilities(preset, 'stdio'),
      });
      const policy = createPolicy({ config, hosts: [] });
      expect(policy.enabled(capability)).toBe(expected);
      const summary = policy.summary();
      expect(summary.enabled.includes(capability)).toBe(expected);
      expect(summary.disabled.includes(capability)).toBe(!expected);
    },
  );

  it.each(CAPABILITIES.map((capability) => ({ capability })))(
    '+$capability switches it on over strict, -$capability off over standard',
    ({ capability }) => {
      expect(resolveSources(`strict,+${capability}`, 'stdio').capabilities.has(capability)).toBe(
        true,
      );
      expect(resolveSources(`standard,-${capability}`, 'stdio').capabilities.has(capability)).toBe(
        false,
      );
      // The file-system capabilities cannot be switched on in HTTP mode by any value.
      expect(resolveSources(`+${capability}`, 'http').capabilities.has(capability)).toBe(
        !isStdioOnly(capability),
      );
    },
  );
});

describe('resolveSources', () => {
  it('defaults to standard', () => {
    const { preset, capabilities } = resolveSources(undefined, 'stdio');
    expect(preset).toBe('standard');
    expect(capabilities).toEqual(presetCapabilities('standard', 'stdio'));
  });

  it('rejects unknown names with a ConfigError', () => {
    expect(() => resolveSources('everything', 'stdio')).toThrow(ConfigError);
    expect(() => resolveSources('+telepathy', 'stdio')).toThrow(ConfigError);
  });
});

describe('effectiveCapabilities', () => {
  it('returns a copy, so the configuration cannot be changed through it', () => {
    const config = makeConfig();
    const effective = effectiveCapabilities(config);
    effective.delete('website');
    expect(config.capabilities.has('website')).toBe(true);
  });

  it('removes the file-system capabilities from a hand-built HTTP configuration', () => {
    const config = makeConfig({ mode: 'http', capabilities: new Set(CAPABILITIES) });
    const effective = effectiveCapabilities(config);
    expect(effective.has('workspace')).toBe(false);
    expect(effective.has('local-packages')).toBe(false);
    expect(effective.size).toBe(CAPABILITIES.length - 2);
  });
});

describe('sourcesValue', () => {
  it('is the preset name alone for an unchanged preset', () => {
    for (const preset of PRESET_LIST) {
      for (const mode of MODES) {
        const config = makeConfig({ preset, mode, capabilities: presetCapabilities(preset, mode) });
        expect(sourcesValue(config)).toBe(preset);
      }
    }
  });

  it('lists additions and removals in table order', () => {
    const config = makeConfig({
      preset: 'standard',
      capabilities: new Set<Capability>([
        'github',
        'registries',
        'workspace',
        'website',
        'site-index',
        'lifecycle-api',
      ]),
    });
    expect(sourcesValue(config)).toBe('standard,-local-packages,-package-cdn,+lifecycle-api');
  });

  it('adds the requested capability while keeping the current settings', () => {
    const strict = makeConfig({
      preset: 'strict',
      capabilities: presetCapabilities('strict', 'stdio'),
    });
    expect(sourcesValue(strict, 'website')).toBe('strict,+website');
    const custom = makeConfig({
      preset: 'strict',
      capabilities: new Set<Capability>(['github', 'registries', 'workspace', 'website']),
    });
    expect(sourcesValue(custom, 'site-search')).toBe(
      'strict,-local-packages,+website,+site-search',
    );
  });

  it('does not repeat a capability that is already on', () => {
    expect(sourcesValue(makeConfig(), 'website')).toBe('standard');
  });

  it('round-trips through the parser for every subset, preset and mode', () => {
    for (const preset of PRESET_LIST) {
      for (const mode of MODES) {
        for (let mask = 0; mask < 1 << CAPABILITIES.length; mask += 1) {
          const capabilities = new Set(CAPABILITIES.filter((_, bit) => (mask & (1 << bit)) !== 0));
          const config = makeConfig({ preset, mode, capabilities });
          const parsed = resolveSources(sourcesValue(config), mode);
          expect(parsed.preset).toBe(preset);
          expect([...parsed.capabilities].sort()).toEqual(
            [...effectiveCapabilities(config)].sort(),
          );
        }
      }
    }
  });
});
