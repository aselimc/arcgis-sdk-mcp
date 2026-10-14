/**
 * Body decoding and the `expect` checks of the gateway. A 200 answer is
 * not proof of a document: catch-all hosts answer any path with an HTML shell, and some
 * serve their "not found" page with status 200.
 */
import { TextDecoder } from 'node:util';
import type { HttpRequest } from '../core/ports.js';
import type { Capability, HostPolicy } from '../core/types.js';

/** How an HTML document starts once declarations and comments are out of the way. */
const HTML_START = /^(?:<!doctype\s+html|<html[\s>])/i;

/** Content types that can never be a page, whatever the body starts with. */
const NOT_MARKUP = /^(?:application\/(?:json|octet-stream|pdf|zip)|image\/|audio\/|video\/)/i;

/** Bytes inspected when sniffing a binary body. */
const SNIFF_BYTES = 1024;

/** The bytes after a UTF-8 byte-order mark, if there is one. */
function withoutBom(bytes: Buffer): Buffer {
  return bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
}

function charsetOf(contentType: string): string | undefined {
  return /charset\s*=\s*"?([^\s;"]+)/i.exec(contentType)?.[1];
}

/**
 * Turns the received bytes into `HttpResponse.text`.
 *
 * - `utf8`: decoded with the charset of the `Content-Type` header (UTF-8 when absent or
 *   unknown) and without the byte-order mark some hosts put on every body;
 * - `base64`: the bytes as they are, for binary files such as `objects.inv`.
 */
export function decodeBody(
  bytes: Buffer,
  contentType: string,
  encoding: HttpRequest['encoding'],
): string {
  if (encoding === 'base64') return bytes.toString('base64');
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charsetOf(contentType) ?? 'utf-8');
  } catch {
    decoder = new TextDecoder('utf-8');
  }
  // Removed by hand: TextDecoder only drops the mark of its own encoding, and these hosts
  // put a UTF-8 mark on bodies whatever charset they declare.
  return decoder.decode(withoutBom(bytes));
}

/**
 * Capabilities whose hosts serve stored files byte for byte and answer a missing one with a
 * real 404. A file read as text from such a host may well be an HTML document (a template
 * such as `index.ejs` or `_Layout.cshtml`); on a documentation site the same body would be
 * the page the site serves in place of a missing file.
 */
const FILE_HOSTS: ReadonlySet<Capability> = new Set<Capability>(['github', 'package-cdn']);

/**
 * True when the text is an HTML document rather than data, source code or a fragment: after
 * an optional XML declaration and any number of comments it starts with a doctype or `<html`.
 *
 * A hand-written scan, not one regular expression: a pattern with a lazy comment body inside
 * a repetition tries every way of pairing `<!--` with a later `-->` before it gives up, which
 * is exponential in the number of leading comments. This runs on every fetched body, so it
 * must be linear whatever the body contains.
 */
export function isHtmlDocument(text: string): boolean {
  let rest = text.slice(0, SNIFF_BYTES).trimStart();
  if (rest.startsWith('<?xml')) {
    const end = rest.indexOf('?>');
    if (end < 0) return false;
    rest = rest.slice(end + 2).trimStart();
  }
  while (rest.startsWith('<!--')) {
    const end = rest.indexOf('-->', 4);
    // A comment that runs past the sniffed bytes hides what follows: not provably a page.
    if (end < 0) return false;
    rest = rest.slice(end + 3).trimStart();
  }
  return HTML_START.test(rest);
}

/** A body that does not have the shape the caller asked for. */
export interface ShapeMismatch {
  /** One sentence for `details.why`, without a trailing period. */
  why: string;
  /**
   * True when this is how the host is known to answer for a document it does not have (the
   * page of a catch-all prefix): as good as a 404. False for a body that is merely
   * unexpected, which can just as well be a maintenance page or an interstitial in front of
   * a document that still exists.
   */
  missing: boolean;
}

/** Why a body does not have the expected shape; `undefined` when it does. */
export function shapeMismatch(
  expect: HttpRequest['expect'],
  contentType: string,
  bytes: Buffer,
  host: HostPolicy,
  path: string,
): ShapeMismatch | undefined {
  const unexpected = (why: string): ShapeMismatch => ({ why, missing: false });
  if (bytes.byteLength === 0) return unexpected('The response body was empty');
  // Enough of the body to see how it starts; latin1 keeps every byte of a binary file.
  const head = withoutBom(bytes).subarray(0, SNIFF_BYTES).toString('latin1');
  const start = head.trimStart();

  if (expect === 'html') {
    if (NOT_MARKUP.test(contentType.trim())) {
      return unexpected(`Expected a page, got ${contentType}`);
    }
    return start.startsWith('<')
      ? undefined
      : unexpected('Expected a page, got a body that is not markup');
  }

  const storedFile =
    expect === 'text' && host.capability !== null && FILE_HOSTS.has(host.capability);
  if (!storedFile && isHtmlDocument(head)) {
    const catchAll = host.catchAllPrefixes?.find((prefix) => path.startsWith(prefix));
    return catchAll === undefined
      ? unexpected(`Expected ${expect}, got an HTML page`)
      : {
          why: `Expected ${expect}, got the HTML page that ${host.host} serves for any path under ${catchAll}`,
          missing: true,
        };
  }
  if (expect === 'json' && !(start.startsWith('{') || start.startsWith('['))) {
    return unexpected('Expected JSON, got a body that does not start with { or [');
  }
  if (expect === 'xml' && !start.startsWith('<')) {
    return unexpected('Expected XML, got a body that does not start with <');
  }
  return undefined;
}

/** True when a 200 answer has exactly the size of the host's "not found" page. */
export function isSoftNotFound(host: HostPolicy, byteLength: number): boolean {
  return host.softNotFoundBytes !== undefined && byteLength === host.softNotFoundBytes;
}

/** The `Accept` header that matches an expectation. */
export function acceptHeader(expect: HttpRequest['expect']): string {
  switch (expect) {
    case 'html':
      return 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1';
    case 'json':
      return 'application/json,*/*;q=0.1';
    case 'xml':
      return 'application/xml,text/xml;q=0.9,*/*;q=0.1';
    case 'yaml':
    case 'text':
      return '*/*';
  }
}
