/**
 * A dependency as a manifest states it, and the reading of version specifications
 * (`^5.1.0`, `>=2.4,<3`, `300.1.0+5042`, `workspace:*`).
 */
import type { PackageRef } from '../core/types.js';

/** One dependency stated by a manifest. */
export interface Dependency {
  /** The package registry the name belongs to. Conda names are looked up as PyPI names. */
  ecosystem: PackageRef['registry'];
  name: string;
  /** The version without range operators; an empty string when the manifest states none. */
  version: string;
  /** True for a lock file or an exact pin, which beats a range for the same package. */
  exact: boolean;
}

/**
 * The version inside a dependency specification, without range operators, build metadata or
 * wildcards: `^5.1.0` and `>=5.1.0,<6` give `5.1.0`, `300.1.0+5042` gives `300.1.0`,
 * `2.4.*` gives `2.4`. Specifications without a version (`*`, `workspace:*`, a path or
 * a property reference) give an empty string.
 */
export function cleanVersion(spec: string): string {
  if (/^\s*(?:file|link|workspace|git|github|https?|path):|\$[({]/i.test(spec)) return '';
  const match = /\d+(?:\.\d+)*(?:-[0-9A-Za-z][0-9A-Za-z.-]*|(?:a|b|rc|\.dev|\.post)\d+)?/.exec(
    spec,
  );
  return match?.[0] ?? '';
}

/** True when a specification pins one version: no range operator, wildcard or alternative. */
export function isExactSpec(spec: string): boolean {
  return /^\s*(?:===?|=)?\s*\[?v?\d[\w.+-]*\]?\s*$/.test(spec) && !/[*x]$/i.test(spec.trim());
}

/** Builds a {@link Dependency} from a name and a raw version specification. */
export function dependency(
  ecosystem: Dependency['ecosystem'],
  name: string,
  spec: string | undefined,
  exact?: boolean,
): Dependency {
  const raw = spec ?? '';
  return {
    ecosystem,
    name: name.trim(),
    version: cleanVersion(raw),
    exact: exact ?? (raw !== '' && isExactSpec(raw)),
  };
}
