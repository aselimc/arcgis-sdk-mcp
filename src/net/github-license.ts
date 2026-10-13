/**
 * Licence classification of a GitHub repository. The tier decides the attribution line of
 * everything read from the repository and whether its text may be adapted (`cc-by-nd`).
 */
import type { LicenseTier } from '../core/types.js';

/** SPDX ids GitHub reports when it could not name the licence. */
const UNDETECTED: ReadonlySet<string> = new Set(['NOASSERTION', 'OTHER', '']);

/**
 * Classifies the SPDX id of the repository API.
 *
 * @returns the tier, or `undefined` when GitHub found a licence file it could not identify,
 *   in which case the file's text decides ({@link classifyLicenseText}).
 */
export function classifySpdx(spdxId: string | null | undefined): LicenseTier | undefined {
  if (spdxId === null || spdxId === undefined) return 'unlicensed';
  const id = spdxId.trim().toUpperCase();
  if (UNDETECTED.has(id)) return undefined;
  if (id === 'APACHE-2.0') return 'apache-2.0';
  if (id.startsWith('CC-BY-ND')) return 'cc-by-nd';
  // MIT, BSD and the rest: readable, but outside the tiers this project has terms for.
  return 'unlicensed';
}

/**
 * Classifies a licence file by its text. Only an unambiguous match gives a permissive tier;
 * anything else is `unlicensed`, the most conservative attribution.
 */
export function classifyLicenseText(text: string): LicenseTier {
  const flat = text.replace(/\s+/g, ' ');
  if (/Apache License,? Version 2\.0/i.test(flat)) return 'apache-2.0';
  if (
    /Attribution[- ]NoDerivatives|creativecommons\.org\/licenses\/by-nd|CC[- ]BY[- ]ND/i.test(flat)
  ) {
    return 'cc-by-nd';
  }
  if (/Esri Master (?:License )?Agreement/i.test(flat)) return 'esri-ma';
  return 'unlicensed';
}
