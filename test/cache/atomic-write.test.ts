import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RENAME_RETRY_DELAYS_MS, TEMP_SUFFIX, atomicWrite } from '../../src/cache/atomic-write.js';
import { nodeFs } from '../../src/cache/fs-port.js';
import { errno, fsWith, listFiles, useTempCaches } from './helpers.js';

const { tempDir } = useTempCaches();

/** A file system whose first `failures` renames fail with `code`; records the waits. */
function flakyRename(code: string, failures: number) {
  let attempts = 0;
  const waits: number[] = [];
  const fs = fsWith({
    rename: async (from, to) => {
      attempts += 1;
      if (attempts <= failures) throw errno(code);
      await nodeFs.rename(from, to);
    },
  });
  const sleep = async (ms: number) => {
    waits.push(ms);
  };
  return { fs, sleep, waits, attempts: () => attempts };
}

describe('atomicWrite', () => {
  it('writes a new file and leaves no temporary file', async () => {
    const dir = await tempDir();
    await atomicWrite(nodeFs, join(dir, 'value.json'), '{"a":1}');
    expect(await readFile(join(dir, 'value.json'), 'utf8')).toBe('{"a":1}');
    expect(await listFiles(dir)).toEqual(['value.json']);
  });

  it('replaces an existing file', async () => {
    const dir = await tempDir();
    const path = join(dir, 'value.json');
    await writeFile(path, 'old');
    await atomicWrite(nodeFs, path, Buffer.from('new'));
    expect(await readFile(path, 'utf8')).toBe('new');
    expect(await listFiles(dir)).toEqual(['value.json']);
  });

  it('creates missing parent directories', async () => {
    const dir = await tempDir();
    const path = join(dir, 'a', 'b', 'value.json');
    await atomicWrite(nodeFs, path, 'deep');
    expect(await readFile(path, 'utf8')).toBe('deep');
  });

  it.each(['EPERM', 'EBUSY', 'EACCES'])('retries a rename that fails with %s', async (code) => {
    const dir = await tempDir();
    const path = join(dir, 'value.json');
    await writeFile(path, 'old');
    const flaky = flakyRename(code, 2);

    await atomicWrite(flaky.fs, path, 'new', { sleep: flaky.sleep });

    expect(await readFile(path, 'utf8')).toBe('new');
    expect(flaky.attempts()).toBe(3);
    expect(flaky.waits).toEqual(RENAME_RETRY_DELAYS_MS.slice(0, 2));
    expect(await listFiles(dir)).toEqual(['value.json']);
  });

  it('succeeds on the third and last retry', async () => {
    const dir = await tempDir();
    const flaky = flakyRename('EPERM', 3);
    await atomicWrite(flaky.fs, join(dir, 'value.json'), 'new', { sleep: flaky.sleep });
    expect(flaky.attempts()).toBe(4);
    expect(flaky.waits).toEqual([...RENAME_RETRY_DELAYS_MS]);
    expect(await readFile(join(dir, 'value.json'), 'utf8')).toBe('new');
  });

  it('gives up after three retries, keeps the old content and removes the temporary file', async () => {
    const dir = await tempDir();
    const path = join(dir, 'value.json');
    await writeFile(path, 'old');
    const flaky = flakyRename('EPERM', Number.POSITIVE_INFINITY);

    await expect(atomicWrite(flaky.fs, path, 'new', { sleep: flaky.sleep })).rejects.toMatchObject({
      code: 'EPERM',
    });

    expect(flaky.attempts()).toBe(4);
    expect(await readFile(path, 'utf8')).toBe('old');
    expect(await listFiles(dir)).toEqual(['value.json']);
  });

  it('does not retry an error that waiting cannot fix', async () => {
    const dir = await tempDir();
    const flaky = flakyRename('ENOSPC', Number.POSITIVE_INFINITY);
    await expect(
      atomicWrite(flaky.fs, join(dir, 'value.json'), 'new', { sleep: flaky.sleep }),
    ).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(flaky.attempts()).toBe(1);
    expect(flaky.waits).toEqual([]);
    expect(await listFiles(dir)).toEqual([]);
  });

  it('rejects when the temporary file cannot be written', async () => {
    const dir = await tempDir();
    const fs = fsWith({
      writeFile: async () => {
        throw errno('EACCES');
      },
    });
    await expect(atomicWrite(fs, join(dir, 'value.json'), 'new')).rejects.toMatchObject({
      code: 'EACCES',
    });
    expect(await listFiles(dir)).toEqual([]);
  });

  it('still reports the rename error when the temporary file cannot be removed', async () => {
    const dir = await tempDir();
    const fs = fsWith({
      rename: async () => {
        throw errno('EXDEV');
      },
      rm: async () => {
        throw errno('EPERM');
      },
    });
    await expect(atomicWrite(fs, join(dir, 'value.json'), 'new')).rejects.toMatchObject({
      code: 'EXDEV',
    });
  });

  it('waits with real timers by default', async () => {
    const dir = await tempDir();
    const flaky = flakyRename('EBUSY', 1);
    const started = performance.now();
    await atomicWrite(flaky.fs, join(dir, 'value.json'), 'new');
    // Timers may fire a millisecond early; the point is that it waited at all.
    expect(performance.now() - started).toBeGreaterThanOrEqual(RENAME_RETRY_DELAYS_MS[0]! - 5);
    expect(await readFile(join(dir, 'value.json'), 'utf8')).toBe('new');
  });

  it('names temporary files so that the sweep can recognise them', async () => {
    const dir = await tempDir();
    await mkdir(join(dir, 'sub'));
    const seen: string[] = [];
    const fs = fsWith({
      writeFile: async (path, data) => {
        seen.push(path);
        await nodeFs.writeFile(path, data);
      },
    });
    await Promise.all([
      atomicWrite(fs, join(dir, 'sub', 'value.json'), 'one'),
      atomicWrite(fs, join(dir, 'sub', 'value.json'), 'two'),
    ]);
    expect(seen).toHaveLength(2);
    expect(new Set(seen).size).toBe(2);
    for (const path of seen) {
      expect(path.startsWith(join(dir, 'sub', 'value.json.'))).toBe(true);
      expect(path.endsWith(TEMP_SUFFIX)).toBe(true);
    }
    expect(['one', 'two']).toContain(await readFile(join(dir, 'sub', 'value.json'), 'utf8'));
  });
});
