import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, type CursorData } from '../../src/core/cursor.js';
import { isMcpDocError } from '../../src/core/errors.js';
import { forSeeds } from '../support/prng.js';

const TOOL = 'arcgis_docs_read';
const sample: CursorData = { v: 1, t: TOOL, k: 'ba7816bf8f01cfea', e: 'W/"abc123"', o: 4096 };

function raw(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function expectExpired(fn: () => unknown, why?: RegExp): void {
  let error: unknown;
  try {
    fn();
  } catch (caught) {
    error = caught;
  }
  expect(isMcpDocError(error), 'throws McpDocError').toBe(true);
  if (!isMcpDocError(error)) return;
  expect(error.code).toBe('CURSOR_EXPIRED');
  expect(error.details?.next).toMatch(/without the cursor/);
  if (why !== undefined) expect(error.details?.why).toMatch(why);
}

describe('cursor codec', () => {
  it('round-trips a cursor through an opaque URL-safe string', () => {
    const encoded = encodeCursor(sample);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encoded.length).toBeLessThanOrEqual(600);
    expect(decodeCursor(encoded, TOOL)).toEqual(sample);
  });

  it('round-trips arbitrary cursors (property)', () => {
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"/\\ é地';
    forSeeds(300, (rng) => {
      const cursor: CursorData = {
        v: 1,
        t: rng.pick([
          'arcgis_docs_read',
          'arcgis_docs_search',
          'arcgis_docs_list_products',
          rng.string(rng.int(1, 64)),
        ]),
        k: rng.string(rng.int(0, 64), alphabet),
        e: rng.string(rng.int(0, 128), alphabet),
        o: rng.pick([0, 1, rng.int(0, 1_000_000), Number.MAX_SAFE_INTEGER]),
      };
      const encoded = encodeCursor(cursor);
      expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeCursor(encoded, cursor.t, { k: cursor.k, e: cursor.e })).toEqual(cursor);
    });
  });

  it('encodes only the five cursor fields', () => {
    const noisy = { ...sample, extra: 'ignored' } as CursorData;
    expect(encodeCursor(noisy)).toBe(encodeCursor(sample));
  });

  it('rejects a cursor issued by another tool', () => {
    expectExpired(() => decodeCursor(encodeCursor(sample), 'arcgis_docs_search'), /issued by/);
  });

  it('rejects a cursor whose key or validator does not match the current call', () => {
    const encoded = encodeCursor(sample);
    expect(decodeCursor(encoded, TOOL, { k: sample.k, e: sample.e })).toEqual(sample);
    expect(decodeCursor(encoded, TOOL, {})).toEqual(sample);
    expectExpired(() => decodeCursor(encoded, TOOL, { k: 'other' }), /different arguments/);
    expectExpired(() => decodeCursor(encoded, TOOL, { e: 'W/"new"' }), /content changed/);
  });

  it.each([
    ['empty string', ''],
    ['not base64url', 'not a cursor!'],
    ['standard base64 padding', `${encodeCursor(sample)}==`],
    ['base64 of non-JSON', Buffer.from('hello', 'utf8').toString('base64url')],
    ['JSON that is not an object', raw([1, 2, 3])],
    ['JSON null', raw(null)],
    ['wrong version', raw({ ...sample, v: 2 })],
    ['missing field', raw({ v: 1, t: TOOL, k: 'k', e: 'e' })],
    ['extra field', raw({ ...sample, admin: true })],
    ['negative offset', raw({ ...sample, o: -1 })],
    ['fractional offset', raw({ ...sample, o: 1.5 })],
    ['string offset', raw({ ...sample, o: '10' })],
    ['unsafe offset', raw({ ...sample, o: 2 ** 60 })],
    ['empty tool', raw({ ...sample, t: '' })],
    ['oversized key', raw({ ...sample, k: 'k'.repeat(129) })],
    ['oversized validator', raw({ ...sample, e: 'e'.repeat(257) })],
    ['numeric key', raw({ ...sample, k: 7 })],
  ])('rejects a tampered cursor: %s', (_label, value) => {
    expectExpired(() => decodeCursor(value, TOOL), /malformed/);
  });

  it('rejects every single-character corruption or decodes to a different, still valid cursor (property)', () => {
    const encoded = encodeCursor(sample);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    forSeeds(300, (rng) => {
      const index = rng.int(0, encoded.length - 1);
      const replacement = rng.pick([...alphabet].filter((char) => char !== encoded[index]));
      const corrupted = encoded.slice(0, index) + replacement + encoded.slice(index + 1);
      try {
        const decoded = decodeCursor(corrupted, TOOL, { k: sample.k, e: sample.e });
        // A flip that survives can only have changed the offset; everything else is pinned.
        expect({ ...decoded, o: sample.o }).toEqual(sample);
        expect(Number.isSafeInteger(decoded.o) && decoded.o >= 0).toBe(true);
      } catch (error) {
        expect(isMcpDocError(error) && error.code === 'CURSOR_EXPIRED').toBe(true);
      }
    });
  });

  it('never throws anything but CURSOR_EXPIRED for random input (property)', () => {
    forSeeds(300, (rng) => {
      const junk = rng.string(rng.int(0, 80), 'abcXYZ019-_=+/ {}":,[]');
      try {
        decodeCursor(junk, TOOL);
      } catch (error) {
        expect(isMcpDocError(error) && error.code === 'CURSOR_EXPIRED', junk).toBe(true);
      }
    });
  });
});
