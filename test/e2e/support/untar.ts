/**
 * Minimal reader for the gzipped tar archives `npm pack` writes: regular files only, with
 * the ustar `prefix` field for long paths. Written here so the end-to-end test needs neither
 * a `tar` binary (GNU tar on Windows misreads drive letters) nor a dependency.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';

const BLOCK = 512;

/** One regular file of an archive. */
export interface TarFile {
  /** Path inside the archive, with forward slashes. */
  path: string;
  data: Buffer;
}

function field(header: Buffer, start: number, length: number): string {
  const raw = header.subarray(start, start + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? length : end).toString('utf8');
}

/** The regular files of a `.tgz` archive, in archive order. */
export function readTarGz(archive: Buffer): TarFile[] {
  const tar = gunzipSync(archive);
  const files: TarFile[] = [];
  let offset = 0;
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    // Two zero blocks end the archive; one is enough to stop reading.
    if (header.every((byte) => byte === 0)) break;
    const name = field(header, 0, 100);
    const prefix = field(header, 345, 155);
    const size = Number.parseInt(field(header, 124, 12).trim() || '0', 8);
    const type = field(header, 156, 1);
    const start = offset + BLOCK;
    if (type === '0' || type === '') {
      files.push({
        path: prefix === '' ? name : `${prefix}/${name}`,
        data: tar.subarray(start, start + size),
      });
    }
    offset = start + Math.ceil(size / BLOCK) * BLOCK;
  }
  return files;
}

/**
 * Writes the files below `target`.
 *
 * @throws Error for an entry that would land outside `target`.
 */
export function extractTarGz(archive: Buffer, target: string): string[] {
  const root = resolve(target);
  const written: string[] = [];
  for (const file of readTarGz(archive)) {
    const path = resolve(root, file.path);
    if (!path.startsWith(root + sep)) throw new Error(`Archive entry escapes the target: ${file.path}`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.data);
    written.push(file.path);
  }
  return written;
}
