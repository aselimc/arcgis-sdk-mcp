/**
 * Types shared inside the services package. The public contract is `IndexService` in
 * `src/core/ports.ts`; the other services of this package use the wider {@link IndexInternals}.
 */
import type { IndexService } from '../../core/ports.js';
import type { CatalogRecord, DocKind, SearchHit } from '../../core/types.js';
import type { CatalogIndex } from './minisearch-index.js';
import type { SymbolMap } from './symbol-map.js';

/**
 * Version of the persisted snapshot format and of the way records are indexed. Raising it
 * invalidates every snapshot on disk.
 */
export const INDEX_SCHEMA_VERSION = 1;

/** A snapshot is trusted without a rebuild for this long. */
export const REVALIDATE_AFTER_MS = 24 * 60 * 60 * 1000;

/** Hard maximum age of a snapshot; older ones are deleted, not served. */
export const MAX_SNAPSHOT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** The persisted form of one catalogue index: its records and what they were built from. */
export interface Snapshot {
  v: number;
  /** Fingerprint of the source definition the records were enumerated with. */
  fingerprint: string;
  product: string;
  source: string;
  line: string;
  /** Epoch milliseconds of the enumeration. */
  builtAt: number;
  records: CatalogRecord[];
}

/**
 * Where the records of a loaded unit come from, which is also the rung of the enumeration
 * ladder (design section 6.6): `fresh` is the adapter's enumeration, `stale` a previous
 * snapshot kept after a failed or rejected rebuild, `seed` the registry's entry links.
 */
export type UnitOrigin = 'fresh' | 'stale' | 'seed';

/** One loaded catalogue index: the unit of building, swapping and eviction. */
export interface Unit {
  key: string;
  product: string;
  source: string;
  line: string;
  /** Position of the source in the product, for "core package before others". */
  sourceRank: number;
  records: CatalogRecord[];
  builtAt: number;
  origin: UnitOrigin;
  /** Hash of the record refs and titles; the validator of cursors over this unit. */
  contentHash: string;
  /** Why the unit is not `fresh`. */
  reason?: string;
  search: CatalogIndex;
  symbols: SymbolMap;
  byRef: Map<string, CatalogRecord>;
  /** Approximate heap size, for the memory bound. */
  bytes: number;
  lastUsed: number;
  /** Earliest time of the next rebuild attempt after a failed one. */
  retryAt?: number;
}

/** The argument of `IndexService.query`, with the synonym table the search service adds. */
export type CatalogQuery = Parameters<IndexService['query']>[0] & {
  /** Lower-case term to alternative phrases; each phrase is matched as all of its words. */
  synonyms?: ReadonlyMap<string, readonly string[]>;
};

/** A query over the fetched-pages body index. */
export interface BodyQuery {
  text: string;
  products: string[];
  kind?: DocKind;
  limit: number;
}

/** The answer of a catalogue query. */
export interface CatalogResult {
  /** The requested page of matching records, best first. */
  hits: SearchHit[];
  /** Records that match at least half of the query's words: what "matches" can honestly mean. */
  total: number;
  /** Of those, the records that match every word. 0 means every hit is a partial match. */
  complete: number;
}

/** What the services of this package may ask of the index beyond the public port. */
export interface IndexInternals extends IndexService {
  query(q: CatalogQuery): CatalogResult;
  /** Sections of pages already read whose text matches, best first. */
  queryBodies(q: BodyQuery): SearchHit[];
  /** Persists body indexes changed by `addBody`. Never rejects. */
  flush(): Promise<void>;
  /** Fingerprint of the loaded indexes in a scope; changes when one of them is rebuilt. */
  validator(scope: {
    products: string[];
    sources?: string[] | undefined;
    line?: string | undefined;
  }): string;
  /** The catalogue record with this ref among the loaded indexes. */
  record(ref: string): CatalogRecord | undefined;
  /** Why a source is not serving a fresh index, when that is the case. */
  reason(product: string, source: string): string | undefined;
  /** Resolves when no index build is running. For tests and the `warm` command. */
  idle(): Promise<void>;
}
