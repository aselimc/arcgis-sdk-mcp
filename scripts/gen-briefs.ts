/**
 * Embeds the curated briefs into the server: `briefs/**\/*.md` becomes
 * `src/registry/data/briefs.generated.ts`, so the registry serves them without disk I/O.
 *
 * Usage: `tsx scripts/gen-briefs.ts` writes the module; `--check` only compares and exits 1
 * when the committed module is out of date.
 *
 * The output depends on the brief files alone (no timestamps, sorted by slug, LF line ends),
 * which is what lets CI assert that `npm run gen` leaves no diff.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** One brief as embedded in the generated module. */
export interface ParsedBrief {
  /** Path under `briefs/` without the extension, with forward slashes: `ai/overview`. */
  slug: string;
  title: string;
  /** ISO date (`YYYY-MM-DD`) on which the claims were last checked against `sources`. */
  verifiedOn: string;
  /** The Esri pages the brief is grounded in. */
  sources: string[];
  /** The body without front matter, starting with its `# title` line; no trailing newline. */
  markdown: string;
}

/** The front matter of a brief. */
export interface FrontMatter {
  title: string;
  verifiedOn: string;
  sources: string[];
}

/** A brief file that the generator refuses, with the place of the problem. */
export class BriefFormatError extends Error {
  constructor(
    readonly file: string,
    readonly reason: string,
    readonly line?: number,
  ) {
    super(`${file}${line === undefined ? '' : `:${line}`}: ${reason}`);
    this.name = 'BriefFormatError';
  }
}

/** Directory holding the brief sources. */
export const BRIEFS_DIR = fileURLToPath(new URL('../briefs/', import.meta.url));

/** The generated module. */
export const OUTPUT_FILE = fileURLToPath(
  new URL('../src/registry/data/briefs.generated.ts', import.meta.url),
);

const FENCE = '---';
const KEYS = ['title', 'verifiedOn', 'sources'] as const;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Line ends are normalised first, so a CRLF checkout generates the same module. */
function normalize(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

/**
 * Removes the column padding of Markdown tables outside code fences.
 *
 * Prettier aligns the tables of the brief sources for human readers; an agent would pay
 * for every padding space and dash, so the embedded copy keeps one space around a cell.
 *
 * @param markdown Markdown with LF line ends
 */
export function compactTables(markdown: string): string {
  let fence: string | undefined;
  return markdown
    .split('\n')
    .map((line) => {
      const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
      if (marker !== undefined) {
        if (fence === undefined) fence = marker;
        else if (marker.startsWith(fence)) fence = undefined;
        return line;
      }
      if (fence !== undefined || !/^\|.*\|$/.test(line)) return line;
      if (/^\|[\s:|-]+\|$/.test(line)) return line.replace(/\s+/g, ' ').replace(/-{3,}/g, '---');
      // Only padding next to a cell border goes: spaces inside a cell are content.
      return line.replace(/ +\|/g, ' |').replace(/\| +/g, '| ');
    })
    .join('\n');
}

/**
 * Reads a scalar of the supported YAML subset: plain text, `'single'` (with `''` for a
 * quote) or `"double"` (JSON escapes).
 */
function parseScalar(raw: string, file: string, line: number): string {
  const text = raw.trim();
  if (text.startsWith('"')) {
    try {
      const value: unknown = JSON.parse(text);
      if (typeof value === 'string') return value;
    } catch {
      // Reported below with the file position.
    }
    throw new BriefFormatError(file, 'malformed double-quoted value', line);
  }
  if (text.startsWith("'")) {
    if (text.length < 2 || !text.endsWith("'")) {
      throw new BriefFormatError(file, 'unterminated single-quoted value', line);
    }
    return text.slice(1, -1).replaceAll("''", "'");
  }
  // Flow collections, anchors, tags and block scalars are YAML this parser does not speak;
  // refusing them is better than reading them as text.
  if (/^[[{&*!|>%@`]/.test(text)) {
    throw new BriefFormatError(file, `unsupported YAML syntax: ${text}`, line);
  }
  return text;
}

function isValidDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (match === null) return false;
  const date = new Date(`${value}T00:00:00Z`);
  // `Date` rolls 2026-02-30 over to March; the round trip catches that.
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validate(found: Map<string, string | string[]>, file: string): FrontMatter {
  for (const key of KEYS) {
    if (!found.has(key)) throw new BriefFormatError(file, `front matter lacks "${key}"`);
  }
  const title = found.get('title');
  const verifiedOn = found.get('verifiedOn');
  const sources = found.get('sources');
  if (typeof title !== 'string' || title === '') {
    throw new BriefFormatError(file, '"title" must be a non-empty string');
  }
  if (typeof verifiedOn !== 'string' || !isValidDate(verifiedOn)) {
    throw new BriefFormatError(file, '"verifiedOn" must be a calendar date as YYYY-MM-DD');
  }
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new BriefFormatError(file, '"sources" must be a non-empty list');
  }
  for (const source of sources) {
    if (!URL.canParse(source) || new URL(source).protocol !== 'https:') {
      throw new BriefFormatError(file, `source is not an https URL: ${source}`);
    }
  }
  if (new Set(sources).size !== sources.length) {
    throw new BriefFormatError(file, '"sources" lists a URL twice');
  }
  return { title, verifiedOn, sources };
}

/**
 * Splits a brief into front matter and body.
 *
 * The front matter is a deliberately small YAML subset, so no YAML dependency is needed:
 * `key: scalar` lines and `key:` followed by `- scalar` items, with `#` comment lines.
 * Exactly the keys `title`, `verifiedOn` and `sources` are accepted.
 *
 * @param text content of the Markdown file
 * @param file name used in error messages
 * @throws BriefFormatError when the front matter is missing, malformed or incomplete
 */
export function parseFrontMatter(text: string, file: string): { meta: FrontMatter; body: string } {
  const lines = normalize(text).split('\n');
  if (lines[0]?.trimEnd() !== FENCE) {
    throw new BriefFormatError(file, 'the file must start with a "---" front matter line', 1);
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trimEnd() === FENCE);
  if (end === -1) throw new BriefFormatError(file, 'the front matter is not closed with "---"');

  const found = new Map<string, string | string[]>();
  let list: string[] | undefined;
  for (let index = 1; index < end; index += 1) {
    const line = lines[index] ?? '';
    const lineNo = index + 1;
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;

    const item = /^\s+-\s+(.*)$/.exec(line) ?? /^-\s+(.*)$/.exec(line);
    if (item !== null) {
      if (list === undefined) {
        throw new BriefFormatError(file, 'list item without a "key:" line above it', lineNo);
      }
      list.push(parseScalar(item[1] ?? '', file, lineNo));
      continue;
    }

    const pair = /^([A-Za-z][A-Za-z0-9]*):(?:\s+(.*))?$/.exec(line);
    if (pair === null) throw new BriefFormatError(file, `cannot read line: ${line}`, lineNo);
    const key = pair[1] ?? '';
    if (!(KEYS as readonly string[]).includes(key)) {
      throw new BriefFormatError(file, `unknown front matter key "${key}"`, lineNo);
    }
    if (found.has(key)) throw new BriefFormatError(file, `duplicate key "${key}"`, lineNo);

    const value = pair[2]?.trim() ?? '';
    if (value === '') {
      list = [];
      found.set(key, list);
    } else {
      list = undefined;
      found.set(key, parseScalar(value, file, lineNo));
    }
  }

  const body = lines
    .slice(end + 1)
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
  return { meta: validate(found, file), body };
}

/**
 * Parses one brief file and checks the rules that tie the body to its front matter.
 *
 * @param slug path under `briefs/` without extension, forward slashes
 * @param text content of the file
 * @throws BriefFormatError when the slug, the front matter or the body breaks a rule
 */
export function parseBrief(slug: string, text: string): ParsedBrief {
  const file = `briefs/${slug}.md`;
  if (!SLUG.test(slug)) {
    throw new BriefFormatError(file, 'slug must be lower-case words joined by "-" and "/"');
  }
  const { meta, body } = parseFrontMatter(text, file);
  // The heading is what a reader sees and the title is what search indexes: keep them equal.
  if (body.split('\n', 1)[0] !== `# ${meta.title}`) {
    throw new BriefFormatError(file, `the body must start with the heading "# ${meta.title}"`);
  }
  return { slug, ...meta, markdown: compactTables(body) };
}

function compareSlugs(a: ParsedBrief, b: ParsedBrief): number {
  // Code-unit order, not locale order: the output must not depend on the machine's locale.
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

/**
 * Reads every `*.md` file below a directory.
 *
 * @param dir directory to scan; defaults to the project's `briefs/`
 * @returns the briefs ordered by slug
 * @throws BriefFormatError for the first file that breaks a rule
 */
export function loadBriefs(dir: string = BRIEFS_DIR): ParsedBrief[] {
  const briefs: ParsedBrief[] = [];
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const path = join(entry.parentPath, entry.name);
    const slug = relative(dir, path).split(sep).join('/').slice(0, -'.md'.length);
    briefs.push(parseBrief(slug, readFileSync(path, 'utf8')));
  }
  return briefs.sort(compareSlugs);
}

/**
 * Renders the TypeScript module that embeds the briefs.
 *
 * The body is written one source line per array element, so a change to a brief shows up
 * as the same lines in the diff of the generated module.
 *
 * @param briefs the briefs in any order; the output is ordered by slug
 */
export function renderModule(briefs: readonly ParsedBrief[]): string {
  const quote = (value: string): string => JSON.stringify(value);
  const out: string[] = [
    '// Generated by scripts/gen-briefs.ts from briefs/**/*.md. Do not edit: change the brief',
    '// and run `npm run gen`.',
    '',
    '/** A curated, project-authored brief, embedded at build time. */',
    'export interface Brief {',
    '  /** Path under `briefs/` without the extension; read with the ref `brief:<slug>`. */',
    '  slug: string;',
    '  title: string;',
    '  /** ISO date on which the claims were last checked against `sources`. */',
    '  verifiedOn: string;',
    '  /** The Esri pages the brief is grounded in. */',
    '  sources: string[];',
    '  /** Markdown body starting with its `# title` line; no trailing newline. */',
    '  markdown: string;',
    '}',
    '',
    '/** Every brief under `briefs/`, ordered by slug. */',
    'export const BRIEFS: readonly Brief[] = [',
  ];
  for (const brief of [...briefs].sort(compareSlugs)) {
    out.push(
      '  {',
      `    slug: ${quote(brief.slug)},`,
      `    title: ${quote(brief.title)},`,
      `    verifiedOn: ${quote(brief.verifiedOn)},`,
      '    sources: [',
      ...brief.sources.map((source) => `      ${quote(source)},`),
      '    ],',
      '    markdown: [',
      ...brief.markdown.split('\n').map((line) => `      ${quote(line)},`),
      "    ].join('\\n'),",
      '  },',
    );
  }
  out.push('];', '');
  return out.join('\n');
}

/**
 * Command-line entry.
 *
 * @param argv arguments after the script name; `--check` compares instead of writing
 * @returns the process exit code
 */
export function main(argv: readonly string[]): number {
  const briefs = loadBriefs();
  const module = renderModule(briefs);
  const target = relative(process.cwd(), OUTPUT_FILE);
  if (argv.includes('--check')) {
    let current = '';
    try {
      current = normalize(readFileSync(OUTPUT_FILE, 'utf8'));
    } catch {
      // A missing module is reported as out of date, like a stale one.
    }
    if (current === module) return 0;
    process.stderr.write(`${target} is out of date: run "npm run gen".\n`);
    return 1;
  }
  mkdirSync(dirname(OUTPUT_FILE), { recursive: true });
  writeFileSync(OUTPUT_FILE, module, 'utf8');
  process.stdout.write(`${target}: ${briefs.length} briefs\n`);
  return 0;
}

// Run only as a script, so tests can import the functions above without side effects.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof BriefFormatError)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
