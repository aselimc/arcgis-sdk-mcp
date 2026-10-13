/**
 * On-disk snapshots of catalogue indexes (design section 6.4): the enumerated records, keyed
 * by product, source and line, with a fingerprint of what they were built from. The search
 * structures are rebuilt from the records on load, which is faster than parsing a dump.
 */
import { shortHash } from '../../core/hash.js';
import type { Ctx } from '../../core/ports.js';
import type { CatalogRecord, SourceDef, VersionLine } from '../../core/types.js';
import { INDEX_SCHEMA_VERSION, MAX_SNAPSHOT_AGE_MS, type Snapshot } from './types.js';

/** Identity of one catalogue index in memory: `product/source/line`. */
export function unitKey(product: string, source: string, line: string): string {
  return `${product}/${source}/${line}`;
}

/** Cache key of a snapshot under the `catalog` namespace. */
export function snapshotKey(product: string, source: string, line: string): string {
  return shortHash(`${product}\n${source}\n${line}`);
}

/**
 * Fingerprint of everything that decides what an enumeration returns, short of the upstream
 * files themselves: the snapshot format, this server's version (a release may change how an
 * adapter names or classifies records), the adapter, the source configuration and the line
 * variables. A snapshot whose fingerprint differs was built for another definition of the
 * source and is discarded.
 */
export function sourceFingerprint(
  source: SourceDef,
  line: VersionLine,
  serverVersion: string,
): string {
  return shortHash(
    JSON.stringify([
      INDEX_SCHEMA_VERSION,
      serverVersion,
      source.adapter,
      source.config,
      line.id,
      line.vars,
    ]),
  );
}

/** Hash of what a client can see of a record list; the validator of cursors over it. */
export function contentHash(records: readonly CatalogRecord[]): string {
  return shortHash(records.map((record) => `${record.ref}\t${record.title}`).join('\n'));
}

function isSnapshot(value: unknown): value is Snapshot {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<Snapshot>;
  return (
    typeof candidate.v === 'number' &&
    typeof candidate.fingerprint === 'string' &&
    typeof candidate.builtAt === 'number' &&
    Array.isArray(candidate.records)
  );
}

/**
 * Reads the snapshot of a source, or `undefined` when there is none that may be used: a
 * missing or unreadable entry, another schema version or fingerprint, or one past the hard
 * maximum age. Unusable entries are deleted. Never rejects.
 */
export async function loadSnapshot(
  ctx: Ctx,
  product: string,
  source: SourceDef,
  line: VersionLine,
): Promise<Snapshot | undefined> {
  const key = snapshotKey(product, source.id, line.id);
  try {
    const stored = await ctx.cache.getDerived<unknown>('catalog', key);
    if (stored === undefined) return undefined;
    const usable =
      isSnapshot(stored) &&
      stored.v === INDEX_SCHEMA_VERSION &&
      stored.fingerprint === sourceFingerprint(source, line, ctx.config.version) &&
      ctx.clock.now() - stored.builtAt <= MAX_SNAPSHOT_AGE_MS;
    if (usable) return stored;
    await ctx.cache.deleteDerived('catalog', key);
  } catch (error) {
    ctx.logger.warn('index snapshot could not be read', { product, source: source.id, error });
  }
  return undefined;
}

/** Writes a snapshot. A failure is logged, not thrown: the index still works from memory. */
export async function saveSnapshot(ctx: Ctx, snapshot: Snapshot): Promise<void> {
  try {
    await ctx.cache.putDerived(
      'catalog',
      snapshotKey(snapshot.product, snapshot.source, snapshot.line),
      snapshot,
    );
  } catch (error) {
    ctx.logger.warn('index snapshot could not be written', {
      product: snapshot.product,
      source: snapshot.source,
      error,
    });
  }
}

/** Deletes the snapshot of a source. Never rejects. */
export async function deleteSnapshot(
  ctx: Ctx,
  product: string,
  source: string,
  line: string,
): Promise<void> {
  try {
    await ctx.cache.deleteDerived('catalog', snapshotKey(product, source, line));
  } catch (error) {
    ctx.logger.warn('index snapshot could not be deleted', { product, source, error });
  }
}
