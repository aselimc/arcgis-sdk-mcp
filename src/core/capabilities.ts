/**
 * Capability presets and the `ARCGIS_DOCS_SOURCES` grammar (design section 6.3).
 *
 * They live in `core` because `loadConfig` must compute `Config.capabilities` and `core` may
 * not import `src/policy`. `src/policy/presets.ts` builds on these exports.
 */
import type { Capability } from './types.js';

/** Every capability, in the order of the policy table. */
export const CAPABILITIES = [
  'github',
  'registries',
  'local-packages',
  'workspace',
  'website',
  'site-index',
  'package-cdn',
  'site-search',
  'lifecycle-api',
] as const satisfies readonly Capability[];

/** Name of a capability preset. */
export type Preset = 'strict' | 'standard';

/** Every preset name. */
export const PRESET_NAMES = ['strict', 'standard'] as const satisfies readonly Preset[];

/** The preset used when `ARCGIS_DOCS_SOURCES` names none. */
export const DEFAULT_PRESET: Preset = 'standard';

/** Capabilities switched on by each preset. `site-search` and `lifecycle-api` are opt-in only. */
export const PRESETS: Readonly<Record<Preset, readonly Capability[]>> = {
  strict: ['github', 'registries', 'local-packages', 'workspace'],
  standard: [
    'github',
    'registries',
    'local-packages',
    'workspace',
    'website',
    'site-index',
    'package-cdn',
  ],
};

/** Capabilities that read the local file system and are therefore forced off in HTTP mode. */
export const STDIO_ONLY_CAPABILITIES = [
  'local-packages',
  'workspace',
] as const satisfies readonly Capability[];

/** Raised for an invalid environment value; the message names the variable and what it accepts. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/** Type guard for capability names. */
export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

function isPreset(value: string): value is Preset {
  return (PRESET_NAMES as readonly string[]).includes(value);
}

/**
 * Parses an `ARCGIS_DOCS_SOURCES` value: an optional preset name and any number of
 * `+capability` / `-capability` items, comma separated, applied left to right.
 *
 * @example parseSources('strict,+website') // preset strict plus page fetches
 * @example parseSources('-package-cdn')    // preset standard without jsDelivr
 * @throws ConfigError for an unknown preset or capability, or a second preset name.
 */
export function parseSources(value: string | undefined): {
  preset: Preset;
  capabilities: Set<Capability>;
} {
  const items = (value ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);

  let preset: Preset | undefined;
  const changes: Array<{ add: boolean; capability: Capability }> = [];
  for (const item of items) {
    const sign = item[0];
    if (sign === '+' || sign === '-') {
      const name = item.slice(1);
      if (!isCapability(name)) {
        throw new ConfigError(
          `ARCGIS_DOCS_SOURCES: unknown capability "${name}". Capabilities: ${CAPABILITIES.join(', ')}`,
        );
      }
      changes.push({ add: sign === '+', capability: name });
    } else if (isPreset(item)) {
      if (preset !== undefined) {
        throw new ConfigError(`ARCGIS_DOCS_SOURCES: more than one preset ("${preset}", "${item}")`);
      }
      preset = item;
    } else {
      throw new ConfigError(
        `ARCGIS_DOCS_SOURCES: unknown item "${item}". Use a preset (${PRESET_NAMES.join(', ')}) and/or +capability / -capability`,
      );
    }
  }

  const resolved = preset ?? DEFAULT_PRESET;
  const capabilities = new Set<Capability>(PRESETS[resolved]);
  for (const change of changes) {
    if (change.add) capabilities.add(change.capability);
    else capabilities.delete(change.capability);
  }
  return { preset: resolved, capabilities };
}
