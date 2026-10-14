/**
 * Detects the meta-refresh stub pages Esri's sites answer with HTTP 200 for moved content.
 * Four shapes exist: a bare `<meta>` after the doctype, a bare self-closing `<meta>` with a
 * quoted `URL='...'`, a full document with an empty body, and a document with a byte order
 * mark and no body. A real page that happens to carry a refresh meta is not a stub.
 */
import { decodeEntities } from '../core/entities.js';

/** The refresh tag sits at the top of a stub; real pages are not searched beyond this. */
const HEAD_BYTES = 4096;
/** A document shorter than this cannot hold a page. */
const STUB_MAX_BYTES = 2048;
/** A longer document with less visible text than this has no content either. */
const STUB_MAX_TEXT = 200;

const REFRESH_TAG = /<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/i;
const CONTENT_ATTR = /content\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
/** `0; url=/x/`, `0;URL='/x/'`, `0,/x/`: delay, optional separator, optional `url=`, target. */
const REFRESH_VALUE = /^\s*\d+(?:\.\d+)?\s*[;,]?\s*(?:url\s*=\s*)?(.*)$/i;

/** Elements whose content is not text of the page, with the end tag that closes them. */
const RAW_TEXT: ReadonlyArray<[open: string, close: string]> = [
  ['<script', '</script'],
  ['<style', '</style'],
  ['<!--', '-->'],
];

/**
 * True when the document shows at least `enough` characters of text. Markup, scripts, styles
 * and comments do not count, nor does whitespace.
 *
 * A single pass with `indexOf`: this runs in the HTTP gateway on every HTML body that opens
 * with a refresh tag, and a regular expression with a lazy `<script ... </script>` branch
 * rescans the rest of the document from every unclosed `<script`, which is quadratic.
 */
function hasVisibleText(html: string, enough: number): boolean {
  // ASCII only, so that every index means the same in both strings.
  const lower = html.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());
  let seen = 0;
  let at = 0;
  while (at < html.length) {
    const tag = html.indexOf('<', at);
    const end = tag === -1 ? html.length : tag;
    for (let index = at; index < end; index += 1) {
      if (html.charCodeAt(index) > 32) seen += 1;
      if (seen >= enough) return true;
    }
    if (tag === -1) break;
    const raw = RAW_TEXT.find(([open]) => lower.startsWith(open, tag));
    // An element that is never closed swallows the rest of the document, as in a browser.
    const close = raw === undefined ? tag : lower.indexOf(raw[1], tag + raw[0].length);
    if (close === -1) break;
    const after = html.indexOf('>', close);
    if (after === -1) break;
    at = after + 1;
  }
  return false;
}

/**
 * The absolute target of a meta-refresh stub, or `undefined` when `html` is a real page, a
 * plain timed reload without a URL, or has no refresh tag.
 *
 * Call it only for a 200 response with an HTML content type, with the response URL as
 * `baseUrl`; the caller follows the target (stubs chain) and enforces a hop limit.
 */
export function detectMetaRefresh(html: string, baseUrl: string): string | undefined {
  const tag = REFRESH_TAG.exec(html.slice(0, HEAD_BYTES));
  if (tag === null) return undefined;
  const content = CONTENT_ATTR.exec(tag[0]);
  if (content === null) return undefined;
  const value = decodeEntities(content[1] ?? content[2] ?? content[3] ?? '');
  const target = (REFRESH_VALUE.exec(value)?.[1] ?? '')
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
    .trim();
  if (target === '') return undefined;

  if (html.length >= STUB_MAX_BYTES && hasVisibleText(html, STUB_MAX_TEXT)) return undefined;
  return URL.parse(target, baseUrl)?.href;
}
