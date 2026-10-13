/**
 * Body decoding and the `expect` checks of the gateway (design section 6.2). A 200 answer is
 * not proof of a document: catch-all hosts answer any path with an HTML shell, and some
 * serve their "not found" page with status 200.
 */
import { TextDecoder } from 'node:util';
import type { HttpRequest } from '../core/ports.js';
import type { HostPolicy } from '../core/types.js';

/** An HTML document, possibly behind an XML declaration or comments. */
const HTML_DOCUMENT =
  /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!doctype\s+html|<html[\s>])/i;

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

/** True when the text is an HTML document rather than data, source code or a fragment. */
export function isHtmlDocument(text: string): boolean {
  return HTML_DOCUMENT.test(text.slice(0, SNIFF_BYTES));
}

/** Why a body does not have the expected shape; `undefined` when it does. */
export function shapeMismatch(
  expect: HttpRequest['expect'],
  contentType: string,
  bytes: Buffer,
  host: HostPolicy,
  path: string,
): string | undefined {
  if (bytes.byteLength === 0) return 'The response body was empty';
  // Enough of the body to see how it starts; latin1 keeps every byte of a binary file.
  const head = withoutBom(bytes).subarray(0, SNIFF_BYTES).toString('latin1');
  const start = head.trimStart();

  if (expect === 'html') {
    if (NOT_MARKUP.test(contentType.trim())) return `Expected a page, got ${contentType}`;
    return start.startsWith('<') ? undefined : 'Expected a page, got a body that is not markup';
  }

  if (isHtmlDocument(head)) {
    const catchAll = host.catchAllPrefixes?.find((prefix) => path.startsWith(prefix));
    return catchAll === undefined
      ? `Expected ${expect}, got an HTML page`
      : `Expected ${expect}, got the HTML page that ${host.host} serves for any path under ${catchAll}`;
  }
  if (expect === 'json' && !(start.startsWith('{') || start.startsWith('['))) {
    return 'Expected JSON, got a body that does not start with { or [';
  }
  if (expect === 'xml' && !start.startsWith('<')) {
    return 'Expected XML, got a body that does not start with <';
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
