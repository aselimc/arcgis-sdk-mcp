/**
 * The npm package adapters: API references read from what Esri
 * publishes inside its npm packages rather than from the documentation website.
 */
import type { SourceAdapter } from '../../../core/ports.js';
import { npmCemAdapter } from './cem.js';
import { npmDtsAdapter } from './dts.js';
import { npmJsonAdapter } from './json.js';

export { npmCemAdapter } from './cem.js';
export { npmDtsAdapter } from './dts.js';
export { npmJsonAdapter } from './json.js';

/**
 * The adapters of types `npm-dts` (TypeScript declarations), `npm-cem` (Custom Elements
 * Manifests) and `npm-json` (JSON reference data). Adapters are stateless values, so the
 * same instances are returned on every call.
 */
export function npmAdapters(): SourceAdapter[] {
  return [npmDtsAdapter, npmCemAdapter, npmJsonAdapter];
}
