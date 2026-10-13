/**
 * Downloads the URLs of `test/fixtures/fixtures.manifest.json` into `test/fixtures/recorded`
 * for the live-recorded test suite. That directory is git-ignored: recorded bodies are
 * Esri-authored and are never committed (docs/adr/0006-fixture-policy.md).
 *
 * Every request goes through the server's own HTTP gateway, so the recorder obeys the same
 * allow-list, robots rules, User-Agent, rate limit and cache as the server, and is paced at
 * one request per second or slower on top of that.
 *
 * Usage: `tsx scripts/record-fixtures.ts [--only id,id] [--force] [--list]`
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import * as z from 'zod/v4';
import { ADAPTER_TYPES, HTML_FAMILIES } from '../src/core/types.js';

/** Pause per upstream request. */
const INTERVAL_MS = 1000;

/** Requests one entry may cost: the URL plus redirect and meta-refresh hops. */
const MAX_REQUESTS_PER_ENTRY = 6;

const EntrySchema = z.strictObject({
  /** File name stem of the recording; lower-case words joined by hyphens. */
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  url: z.string().regex(/^https:\/\/\S+$/),
  expect: z.enum(['html', 'json', 'xml', 'text', 'yaml']),
  /** `base64` for binary bodies, which are written as bytes. */
  encoding: z.literal('base64').optional(),
  /** The HTML family the page must be detected as. */
  family: z.enum(HTML_FAMILIES).optional(),
  /** The adapter type the file belongs to. */
  adapter: z.enum(ADAPTER_TYPES).optional(),
  /** What the recording is for. */
  covers: z.string().min(10),
});

/** Schema of `fixtures.manifest.json`. */
export const ManifestSchema = z.strictObject({
  schema: z.literal(1),
  about: z.string().min(1),
  entries: z.array(EntrySchema).min(1),
});

/** One URL to record. */
export type ManifestEntry = z.infer<typeof EntrySchema>;

/** The parsed manifest. */
export type Manifest = z.infer<typeof ManifestSchema>;

/** Provenance of one recording, written to `recorded/index.json`. */
export interface RecordedFile {
  id: string;
  file: string;
  url: string;
  finalUrl: string;
  aliasChain: string[];
  fetchedAt: string;
  bytes: number;
  sha256: string;
}

/**
 * Parses and validates the manifest text.
 *
 * @throws Error naming the first invalid field, or a duplicated id.
 */
export function parseManifest(json: string): Manifest {
  const parsed = ManifestSchema.safeParse(JSON.parse(json));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `fixtures.manifest.json: ${issue?.path.join('.') ?? '(root)'}: ${issue?.message ?? 'invalid'}`,
    );
  }
  const seen = new Set<string>();
  for (const entry of parsed.data.entries) {
    if (seen.has(entry.id)) throw new Error(`fixtures.manifest.json: duplicate id "${entry.id}"`);
    seen.add(entry.id);
  }
  return parsed.data;
}

/**
 * File name of a recording: the id plus an extension from the expected shape. `text` bodies
 * keep the extension of the URL (`.d.ts`, `.js`, `.inv`, `.md`) so editors and the TypeScript
 * differential test treat them correctly.
 */
export function fileNameFor(entry: ManifestEntry): string {
  const fixed = { html: '.html', json: '.json', xml: '.xml', yaml: '.yml' } as const;
  if (entry.expect !== 'text') return `${entry.id}${fixed[entry.expect]}`;
  const base = new URL(entry.url).pathname.split('/').pop() ?? '';
  const dot = base.indexOf('.');
  return `${entry.id}${dot > 0 ? base.slice(dot).toLowerCase() : '.txt'}`;
}

/**
 * The entries to record: all of them, or those named in `only`.
 *
 * @throws Error for an id that is not in the manifest.
 */
export function selectEntries(manifest: Manifest, only: readonly string[] = []): ManifestEntry[] {
  if (only.length === 0) return manifest.entries;
  const byId = new Map(manifest.entries.map((entry) => [entry.id, entry]));
  return only.map((id) => {
    const entry = byId.get(id);
    if (entry === undefined) throw new Error(`No fixture with id "${id}" in the manifest`);
    return entry;
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      only: { type: 'string' },
      force: { type: 'boolean' },
      list: { type: 'boolean' },
    },
  });
  const fixtures = resolve(fileURLToPath(import.meta.url), '..', '..', 'test', 'fixtures');
  const manifest = parseManifest(readFileSync(resolve(fixtures, 'fixtures.manifest.json'), 'utf8'));
  const entries = selectEntries(
    manifest,
    values.only?.split(',').filter((id) => id !== ''),
  );
  if (values.list === true) {
    for (const entry of entries) console.log(`${fileNameFor(entry)}\t${entry.url}`);
    return;
  }

  // Loaded here so that `--list` and the unit tests of the helpers need no built server.
  const [{ createContainer }, { loadConfig }, { readPackageInfo }, { newBudget }] =
    await Promise.all([
      import('../src/app/composition-root.js'),
      import('../src/core/config.js'),
      import('../src/app/package-info.js'),
      import('../src/core/async.js'),
    ]);
  const config = loadConfig(process.env, { mode: 'stdio' }, readPackageInfo());
  const { http, clock } = createContainer(config);

  const outDir = resolve(fixtures, 'recorded');
  mkdirSync(outDir, { recursive: true });
  const indexPath = resolve(outDir, 'index.json');
  const index = new Map<string, RecordedFile>(
    existsSync(indexPath)
      ? (JSON.parse(readFileSync(indexPath, 'utf8')) as RecordedFile[]).map((file) => [
          file.id,
          file,
        ])
      : [],
  );

  let failed = 0;
  let owed = 0;
  for (const entry of entries) {
    const file = fileNameFor(entry);
    if (values.force !== true && index.has(entry.id) && existsSync(resolve(outDir, file))) {
      console.log(`kept      ${file}`);
      continue;
    }
    if (owed > 0) await sleep(owed * INTERVAL_MS);
    const budget = newBudget(MAX_REQUESTS_PER_ENTRY, 60_000, clock);
    try {
      const res = await http.get({
        url: entry.url,
        expect: entry.expect,
        maxBytes: config.limits.indexMaxBytes,
        budget,
        ...(entry.encoding === undefined ? {} : { encoding: entry.encoding }),
      });
      const body =
        entry.encoding === 'base64' ? Buffer.from(res.text, 'base64') : Buffer.from(res.text);
      writeFileSync(resolve(outDir, file), body);
      index.set(entry.id, {
        id: entry.id,
        file,
        url: entry.url,
        finalUrl: res.finalUrl,
        aliasChain: res.aliasChain,
        fetchedAt: res.fetchedAt,
        bytes: body.byteLength,
        sha256: createHash('sha256').update(body).digest('hex'),
      });
      console.log(`recorded  ${file} (${body.byteLength} bytes, ${res.cache})`);
    } catch (error) {
      failed += 1;
      console.error(`failed    ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
    owed = Math.max(1, budget.used);
  }

  // The index is the provenance file of the directory: where each body came from and when.
  const sorted = [...index.values()].sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(indexPath, `${JSON.stringify(sorted, null, 2)}\n`);
  if (failed > 0) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
  // The gateway's limiter and cache may hold timers that would keep the process open.
  process.exit(process.exitCode ?? 0);
}
