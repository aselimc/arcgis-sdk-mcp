/**
 * Readers for the two symbol indexes a Sphinx site publishes: `objects.inv` (the intersphinx
 * inventory: four text lines, then zlib-compressed rows) and `searchindex.js` (the data of
 * the search page). Both are reduced to the same entry shape, so the adapter has one way of
 * turning them into records.
 */
import { inflateSync } from 'node:zlib';

/** One object of a Sphinx site, as an inventory row describes it. */
export interface SphinxEntry {
  /** Fully qualified name: `package.module.Class.method`; for `std:doc` the document name. */
  name: string;
  /** `py`, `std`, `c`, ... */
  domain: string;
  /** `class`, `method`, `function`, `attribute`, `doc`, `label`, ... */
  role: string;
  /**
   * Search priority as Sphinx assigns it; negative for an object that is hidden from search,
   * which is how an alias of an object documented under another name is marked.
   */
  priority: number;
  /** Page and anchor relative to the site root: `package.module.html#package.module.Class`. */
  uri: string;
  /** Display name; equal to `name` when the index gives none. */
  display: string;
}

/** A parsed index with whatever the file says about the documented project. */
export interface SphinxIndex {
  project?: string;
  version?: string;
  entries: SphinxEntry[];
}

const INVENTORY_HEADER = /^# Sphinx inventory version 2\s*$/;
/** `name domain:role priority uri dispname`; names and display names may contain spaces. */
const INVENTORY_ROW = /^(.+?)\s+([^\s:]+):(\S+)\s+(-?\d+)\s+(\S*)\s+(.*)$/;
const HEADER_LINES = 4;

/**
 * Reads an `objects.inv` (inventory version 2). In a row, a URI ending in `$` stands for the
 * object's name and a display name of `-` for "same as the name"; both are expanded.
 *
 * @returns `undefined` when the bytes are not a version 2 inventory or the compressed part
 *   is damaged (a truncated download).
 */
export function parseObjectsInv(bytes: Uint8Array): SphinxIndex | undefined {
  let offset = 0;
  const header: string[] = [];
  for (let line = 0; line < HEADER_LINES; line++) {
    const end = bytes.indexOf(0x0a, offset);
    if (end < 0) return undefined;
    header.push(Buffer.from(bytes.subarray(offset, end)).toString('utf8').trimEnd());
    offset = end + 1;
  }
  if (!INVENTORY_HEADER.test(header[0] ?? '')) return undefined;

  let body: string;
  try {
    body = inflateSync(bytes.subarray(offset)).toString('utf8');
  } catch {
    return undefined;
  }
  const entries: SphinxEntry[] = [];
  for (const line of body.split('\n')) {
    const row = INVENTORY_ROW.exec(line.trimEnd());
    if (row === null) continue;
    const [, name = '', domain = '', role = '', priority = '', uri = '', display = ''] = row;
    entries.push({
      name,
      domain,
      role,
      priority: Number(priority),
      uri: uri.endsWith('$') ? `${uri.slice(0, -1)}${name}` : uri,
      display: display === '-' || display === '' ? name : display,
    });
  }
  const project = /^# Project:\s*(.*)$/.exec(header[1] ?? '')?.[1];
  const version = /^# Version:\s*(.*)$/.exec(header[2] ?? '')?.[1];
  return {
    ...(project === undefined || project === '' ? {} : { project }),
    ...(version === undefined || version === '' ? {} : { version }),
    entries,
  };
}

/** `[document, object type, priority, anchor]`, with the name appended in the list form. */
type ObjectRow = readonly unknown[];

interface RawSearchIndex {
  docnames?: unknown;
  titles?: unknown;
  objects?: unknown;
  objtypes?: unknown;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item : '')) : [];
}

/** The rows below one name prefix: a list of rows (Sphinx 5 and later) or a map by name. */
function objectRows(group: unknown): Array<{ name: string; row: ObjectRow }> {
  if (Array.isArray(group)) {
    return (group as unknown[]).flatMap((row) =>
      Array.isArray(row) && typeof row[4] === 'string'
        ? [{ name: row[4], row: row as ObjectRow }]
        : [],
    );
  }
  if (typeof group !== 'object' || group === null) return [];
  return Object.entries(group).flatMap(([name, row]) =>
    Array.isArray(row) ? [{ name, row: row as ObjectRow }] : [],
  );
}

/**
 * Reads `searchindex.js` (`Search.setIndex({...})`) as far as it describes pages and objects:
 * one `std:doc` entry per document with its title, and one entry per object. An object's
 * anchor is its full name when the index stores an empty string, and absent for `-`.
 *
 * @returns `undefined` when the script holds no JSON object (old Sphinx versions wrote
 *   JavaScript with unquoted keys) or names no documents.
 */
export function parseSphinxSearchIndex(script: string): SphinxIndex | undefined {
  const start = script.indexOf('{');
  const end = script.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  let raw: RawSearchIndex;
  try {
    raw = JSON.parse(script.slice(start, end + 1)) as RawSearchIndex;
  } catch {
    return undefined;
  }
  const docnames = strings(raw.docnames);
  if (docnames.length === 0) return undefined;
  const titles = strings(raw.titles);
  const types = (
    typeof raw.objtypes === 'object' && raw.objtypes !== null ? raw.objtypes : {}
  ) as Record<string, unknown>;

  const entries: SphinxEntry[] = docnames.map((name, index) => {
    const title = titles[index];
    return {
      name,
      domain: 'std',
      role: 'doc',
      priority: -1,
      uri: `${name}.html`,
      display: title === undefined || title === '' ? name : title,
    };
  });
  const groups = typeof raw.objects === 'object' && raw.objects !== null ? raw.objects : {};
  for (const [prefix, group] of Object.entries(groups)) {
    for (const { name, row } of objectRows(group)) {
      const document = docnames[Number(row[0])];
      const type = types[String(row[1])];
      if (document === undefined || typeof type !== 'string' || !type.includes(':')) continue;
      const full = prefix === '' ? name : `${prefix}.${name}`;
      const anchor = row[3] === '' ? full : row[3] === '-' ? '' : String(row[3]);
      entries.push({
        name: full,
        domain: type.slice(0, type.indexOf(':')),
        role: type.slice(type.indexOf(':') + 1),
        priority: typeof row[2] === 'number' ? row[2] : 1,
        uri: anchor === '' ? `${document}.html` : `${document}.html#${anchor}`,
        display: full,
      });
    }
  }
  return { entries };
}
