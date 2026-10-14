/**
 * Capability presets seen from the policy: which capabilities a preset
 * switches on in each server mode, the `ARCGIS_DOCS_SOURCES` parser with the mode applied,
 * and its inverse, which error messages use to name the exact value to set.
 *
 * The preset table and the grammar themselves live in `src/core/capabilities.ts` because
 * `loadConfig` needs them; this file adds only what depends on a `Config`.
 */
import {
  CAPABILITIES,
  PRESETS,
  STDIO_ONLY_CAPABILITIES,
  parseSources,
  type Preset,
} from '../core/capabilities.js';
import type { Config } from '../core/config.js';
import type { Capability } from '../core/types.js';

/** Server mode; file-system capabilities exist only in `stdio`. */
export type Mode = Config['mode'];

/** True for the capabilities that read the local file system (`local-packages`, `workspace`). */
export function isStdioOnly(capability: Capability): boolean {
  return (STDIO_ONLY_CAPABILITIES as readonly Capability[]).includes(capability);
}

function withoutStdioOnly(capabilities: Iterable<Capability>, mode: Mode): Set<Capability> {
  const result = new Set(capabilities);
  if (mode === 'http') {
    // A remote caller must never make the server read the host's file system.
    for (const capability of STDIO_ONLY_CAPABILITIES) result.delete(capability);
  }
  return result;
}

/** The capabilities a preset switches on in the given mode: one column of the 6.3 table. */
export function presetCapabilities(preset: Preset, mode: Mode): Set<Capability> {
  return withoutStdioOnly(PRESETS[preset], mode);
}

/**
 * The capabilities in force for a configuration. `loadConfig` already removes the
 * file-system capabilities in HTTP mode; the policy applies the rule again so that a
 * hand-built `Config` cannot switch them on.
 */
export function effectiveCapabilities(
  config: Pick<Config, 'capabilities' | 'mode'>,
): Set<Capability> {
  return withoutStdioOnly(config.capabilities, config.mode);
}

/**
 * Parses an `ARCGIS_DOCS_SOURCES` value for a server mode.
 *
 * @example resolveSources('strict,+website', 'stdio')
 * @throws ConfigError for an unknown preset or capability.
 */
export function resolveSources(
  value: string | undefined,
  mode: Mode,
): { preset: Preset; capabilities: Set<Capability> } {
  const { preset, capabilities } = parseSources(value);
  return { preset, capabilities: withoutStdioOnly(capabilities, mode) };
}

/**
 * The canonical `ARCGIS_DOCS_SOURCES` value of a configuration, optionally with one more
 * capability switched on: the preset followed by every difference from it, in table order.
 *
 * @example sourcesValue(strictConfig, 'website') // 'strict,+website'
 */
export function sourcesValue(
  config: Pick<Config, 'preset' | 'capabilities' | 'mode'>,
  add?: Capability,
): string {
  const wanted = effectiveCapabilities(config);
  if (add !== undefined) wanted.add(add);
  const preset = new Set<Capability>(PRESETS[config.preset]);
  const items: string[] = [config.preset];
  for (const capability of CAPABILITIES) {
    if (wanted.has(capability) && !preset.has(capability)) items.push(`+${capability}`);
    // In HTTP mode the file-system capabilities are off by mode, not by the variable.
    const offByMode = config.mode === 'http' && isStdioOnly(capability);
    if (!wanted.has(capability) && preset.has(capability) && !offByMode) {
      items.push(`-${capability}`);
    }
  }
  return items.join(',');
}
