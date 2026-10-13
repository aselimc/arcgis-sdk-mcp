import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Cassette, Interaction, RecordedResponse } from './fake-http.js';

/**
 * Fixture loader. This module owns no data: each package keeps its fixtures in its own
 * directory under `test/fixtures/` (synthetic, oss, cassettes) and reads them through here.
 */

/** Absolute path of `test/fixtures`. */
export const FIXTURES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

/** Absolute path of a fixture, from segments relative to `test/fixtures`. */
export function fixturePath(...segments: string[]): string {
  return join(FIXTURES_DIR, ...segments);
}

/** True when the fixture exists. */
export function hasFixture(...segments: string[]): boolean {
  return existsSync(fixturePath(...segments));
}

/**
 * Reads a text fixture as UTF-8 with line endings normalised to `\n`, so goldens compare
 * equal on a Windows checkout with `core.autocrlf` enabled.
 */
export function readFixture(...segments: string[]): string {
  return readFileSync(fixturePath(...segments), 'utf8').replace(/\r\n/g, '\n');
}

/** Reads and parses a JSON fixture. */
export function readJsonFixture<V = unknown>(...segments: string[]): V {
  return JSON.parse(readFileSync(fixturePath(...segments), 'utf8')) as V;
}

/** A response as written in a cassette file: `bodyFile` names a sibling file holding the body. */
type StoredResponse = RecordedResponse & { bodyFile?: string };

interface StoredCassette {
  name?: string;
  interactions: Array<Omit<Interaction, 'response'> & { response: StoredResponse }>;
}

/**
 * Loads a cassette for `FakeHttp`.
 *
 * A cassette is a JSON file:
 *
 * ```json
 * {
 *   "name": "astro guide, happy path",
 *   "interactions": [
 *     { "url": "https://developers.arcgis.com/x/sitemap-0.xml",
 *       "response": { "contentType": "application/xml", "bodyFile": "sitemap-0.xml" } },
 *     { "url": "https://developers.arcgis.com/x/index.json", "response": { "json": { "a": 1 } } },
 *     { "url": "https://developers.arcgis.com/x/gone/", "response": { "status": 404 } }
 *   ]
 * }
 * ```
 *
 * `bodyFile` is resolved relative to the cassette file and read as UTF-8 (line endings
 * normalised). Bodies must be synthetic or Apache-2.0 material, never recorded Esri pages.
 */
export function loadCassette(...segments: string[]): Cassette {
  const file = fixturePath(...segments);
  const stored = JSON.parse(readFileSync(file, 'utf8')) as StoredCassette;
  const interactions = stored.interactions.map(({ response, ...request }): Interaction => {
    const { bodyFile, ...rest } = response;
    if (bodyFile === undefined) return { ...request, response: rest };
    const body = readFileSync(join(dirname(file), bodyFile), 'utf8').replace(/\r\n/g, '\n');
    return { ...request, response: { ...rest, body } };
  });
  return stored.name === undefined ? { interactions } : { name: stored.name, interactions };
}
