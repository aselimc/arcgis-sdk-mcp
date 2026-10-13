/**
 * Directory write test used by `doctor`.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Creates `dir` if needed, then writes and removes a small file in it.
 *
 * @returns the failure message, or `undefined` when the directory is writable. Never throws:
 *   an unwritable cache directory is a finding of the report, not a crash.
 */
export async function checkWritable(dir: string): Promise<string | undefined> {
  const probe = join(dir, `.write-test-${process.pid}-${Date.now()}`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(probe, 'ok');
    await rm(probe, { force: true });
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
