/**
 * `arcgis-sdk-mcp cache info|clear`: inspect or empty the per-user cache.
 */
import type { Cache } from '../core/ports.js';
import type { CacheScope } from './args.js';

const SCOPE_LABEL: Readonly<Record<CacheScope, string>> = {
  http: 'cached responses',
  derived: 'derived indexes',
  all: 'cached responses and derived indexes',
};

/** Human-readable size with one decimal: `0 B`, `12.3 KB`, `4.0 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit] ?? 'GB'}`;
}

/** The text of `cache info`. */
export async function cacheInfo(cache: Cache, maxMb: number): Promise<string> {
  const info = await cache.info();
  return [
    `Cache directory: ${info.dir}`,
    `Size: ${formatBytes(info.bytes)} of ${maxMb} MB`,
    `Entries: ${info.entries}`,
    '',
  ].join('\n');
}

/** Clears `scope` and returns the confirmation text of `cache clear`. */
export async function cacheClear(cache: Cache, scope: CacheScope): Promise<string> {
  const before = await cache.info();
  await cache.clear(scope);
  const after = await cache.info();
  const freed = Math.max(0, before.bytes - after.bytes);
  return `Cleared ${SCOPE_LABEL[scope]} in ${before.dir} (${formatBytes(freed)} freed)\n`;
}
