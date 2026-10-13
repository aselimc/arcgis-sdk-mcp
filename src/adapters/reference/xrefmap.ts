/**
 * Line reader for DocFX `xrefmap.yml` files. An xrefmap is a flat YAML list of several
 * megabytes whose entries all have the same few scalar keys, so it is read line by line
 * instead of through a YAML parser: no dependency, no object graph of the whole file.
 */

/** One `references` entry, reduced to the keys the catalogue uses. */
export interface XrefEntry {
  /** DocFX uid: `Namespace.Type.Member(ParamType)`; generic arity as `` `1 ``. */
  uid: string;
  /** Short display name: `QueryFeaturesAsync(QueryParameters)`. */
  name?: string;
  /** Page relative to the site root, with an anchor for members. */
  href?: string;
  /** C# documentation id: `T:`, `M:`, `P:`, `F:`, `E:`, `N:` or `Overload:` plus the uid. */
  commentId?: string;
  fullName?: string;
  /** `Type.Member(ParamType)`. */
  nameWithType?: string;
}

const ENTRY_START = /^- uid:\s*(.*)$/;
const ENTRY_KEY = /^ {2}(name|href|commentId|fullName|nameWithType):\s*(.*)$/;

/** A YAML flow scalar on one line: plain, single-quoted (`''` escapes a quote) or double-quoted. */
function scalar(raw: string): string {
  const text = raw.trim();
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    try {
      // The escapes DocFX writes in double-quoted scalars are the JSON ones.
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === 'string') return parsed;
    } catch {
      // Fall through to the text between the quotes.
    }
    return text.slice(1, -1);
  }
  return text;
}

/**
 * Reads the `references` list of an xrefmap. Entries keep file order; keys other than the
 * ones of {@link XrefEntry} (language variants such as `name.vb`, `isSpec`, `spec.csharp`)
 * are ignored. A file with `references: []` gives an empty list: the root `xrefmap.yml` of a
 * multi-platform DocFX site is such a file and must not be mistaken for the symbol index.
 */
export function parseXrefmap(yaml: string): XrefEntry[] {
  const entries: XrefEntry[] = [];
  let current: XrefEntry | undefined;
  let from = 0;
  while (from < yaml.length) {
    let to = yaml.indexOf('\n', from);
    if (to < 0) to = yaml.length;
    const line = yaml.charCodeAt(to - 1) === 0x0d ? yaml.slice(from, to - 1) : yaml.slice(from, to);
    from = to + 1;

    const start = ENTRY_START.exec(line);
    if (start !== null) {
      const uid = scalar(start[1] ?? '');
      current = uid === '' ? undefined : { uid };
      if (current !== undefined) entries.push(current);
      continue;
    }
    if (current === undefined) continue;
    const pair = ENTRY_KEY.exec(line);
    if (pair === null) continue;
    const value = scalar(pair[2] ?? '');
    if (value !== '') current[pair[1] as keyof Omit<XrefEntry, 'uid'>] = value;
  }
  return entries;
}
