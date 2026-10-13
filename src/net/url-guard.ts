/**
 * Checks the gateway applies to every URL before the source policy sees it, and again to
 * every redirect and meta-refresh target. They do not depend on the host table, so a mistake
 * in the table cannot turn the gateway into a way to reach a private address.
 */
import { refused } from './errors.js';

/** Dotted-quad IPv4. `URL` already normalises decimal, hex and octal spellings to this form. */
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** Names that resolve inside the machine or the local network. */
const LOCAL_NAME = /(?:^|\.)(?:localhost|local|internal|lan|home|intranet)$/i;

/**
 * Rejects anything but a plain public https URL.
 *
 * @throws McpDocError `HOST_NOT_ALLOWED` for another scheme, embedded credentials, an
 *   explicit port, an IP literal or a local name.
 */
export function assertFetchable(url: URL): void {
  if (url.protocol !== 'https:') {
    throw refused(url.href, `Only https URLs are fetched, not ${url.protocol}`);
  }
  if (url.username !== '' || url.password !== '') {
    throw refused(url.href, 'URLs with embedded credentials are not fetched');
  }
  // `URL` drops the default port, so anything left here is a non-standard one.
  if (url.port !== '') {
    throw refused(url.href, `Only the default https port is used, not ${url.port}`);
  }
  const name = url.hostname;
  if (IPV4.test(name) || name.startsWith('[')) {
    throw refused(url.href, 'IP addresses are not documentation hosts');
  }
  if (LOCAL_NAME.test(name) || !name.includes('.')) {
    throw refused(url.href, 'Local host names are not documentation hosts');
  }
}

/**
 * Parses the URL of a request and drops its fragment (fragments are never sent to a server).
 *
 * @throws McpDocError `HOST_NOT_ALLOWED` when the text is not a URL or fails {@link assertFetchable}.
 */
export function parseTarget(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw refused(raw, 'Not an absolute URL');
  }
  url.hash = '';
  assertFetchable(url);
  return url;
}

/**
 * Resolves a `Location` header or meta-refresh target against the URL that produced it.
 *
 * @returns `undefined` when the target is not a URL at all.
 * @throws McpDocError `HOST_NOT_ALLOWED` when it fails {@link assertFetchable}.
 */
export function resolveHop(target: string, base: URL): URL | undefined {
  let url: URL;
  try {
    url = new URL(target, base);
  } catch {
    return undefined;
  }
  url.hash = '';
  assertFetchable(url);
  return url;
}
