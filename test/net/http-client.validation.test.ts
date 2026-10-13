import { describe, expect, it } from 'vitest';
import type { HttpRequest } from '../../src/core/ports.js';
import { DAY } from '../support/fake-clock.js';
import { PAGE, body, hostRow, makeRig, mcpError, page } from './harness.js';

const HOST = 'developers.arcgis.com';
const HOSTS = [
  hostRow(HOST, { softNotFoundBytes: 5419, catchAllPrefixes: ['/dashboards/', '/search/'] }),
  hostRow('doc.esri.com', { bom: true, revalidate: 'last-modified' }),
];
const at = (path: string) => `https://${HOST}${path}`;

describe('gateway: expect validation', () => {
  it('treats the HTML shell of a catch-all prefix as a miss and remembers it', async () => {
    const rig = makeRig({ hosts: HOSTS });
    const url = at('/dashboards/search-index.json');
    rig.origin.on(url, page(PAGE));

    const error = await mcpError(rig.http.getJson({ url }));
    expect(error.code).toBe('DOC_NOT_FOUND');
    expect(error.details?.why).toContain('serves for any path under /dashboards/');

    expect((await mcpError(rig.http.getJson({ url }))).code).toBe('DOC_NOT_FOUND');
    expect(rig.origin.calls).toHaveLength(1);
  });

  it.each<[HttpRequest['expect'], string, string]>([
    ['json', 'application/json', '  {"a":1}'],
    ['json', 'text/plain', '[1,2]'],
    ['xml', 'application/xml', '<?xml version="1.0"?><urlset></urlset>'],
    ['xml', 'text/xml', '<sitemapindex></sitemapindex>'],
    ['text', 'text/plain', '# Heading\n\nMarkdown with <b>inline</b> markup.'],
    ['text', 'application/typescript', 'export declare class Map {}'],
    ['yaml', 'text/yaml', '### YamlMime:XRefMap\nreferences: []'],
    ['html', 'text/html', '<div>fragment</div>'],
    ['html', '', PAGE],
  ])('accepts %s served as "%s"', async (expectation, contentType, text) => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(at('/file'), body(text, contentType));
    const res = await rig.http.get({ url: at('/file'), expect: expectation });
    expect(res.text).toBe(text);
    expect(res.contentType).toBe(contentType);
  });

  it.each<[HttpRequest['expect'], string, string, string]>([
    ['json', 'text/html', PAGE, 'got an HTML page'],
    ['json', 'application/json', 'Not Found', 'does not start with { or ['],
    ['xml', 'text/html', PAGE, 'got an HTML page'],
    ['xml', 'application/xml', 'oops', 'does not start with <'],
    ['xml', 'application/xhtml+xml', `<?xml version="1.0"?>${PAGE}`, 'got an HTML page'],
    ['text', 'text/html', `<!-- build 7 -->\n${PAGE}`, 'got an HTML page'],
    ['yaml', 'text/html', PAGE, 'got an HTML page'],
    ['html', 'application/json', '{"error":"nope"}', 'Expected a page'],
    ['html', 'text/html', 'Just words, no markup', 'not markup'],
    ['html', 'text/html', '', 'empty'],
    ['json', 'application/json', '', 'empty'],
  ])('rejects %s served as "%s" (%#)', async (expectation, contentType, text, why) => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(at('/file'), body(text, contentType));
    const error = await mcpError(rig.http.get({ url: at('/file'), expect: expectation }));
    expect(error.code).toBe('DOC_NOT_FOUND');
    expect(error.details?.why).toContain(why);
  });

  it('recognises the soft 404 page by its exact size', async () => {
    const rig = makeRig({ hosts: HOSTS });
    const shell = `<!doctype html><html><body>${'x'.repeat(5419 - 41)}</body></html>`;
    expect(Buffer.byteLength(shell)).toBe(5419);
    rig.origin.on(at('/gone/'), page(shell)).on(at('/there/'), page(`${shell} `));

    const error = await mcpError(rig.http.get({ url: at('/gone/'), expect: 'html' }));
    expect(error.code).toBe('DOC_NOT_FOUND');
    expect(error.details?.why).toContain('"not found" page');
    expect((await rig.http.get({ url: at('/there/'), expect: 'html' })).status).toBe(200);
  });

  it('does not serve a stale copy for a document that is gone', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(at('/file'), page(PAGE), body('{}', 'application/json'));
    await rig.http.get({ url: at('/file'), expect: 'html' });
    rig.clock.advance(2 * DAY);
    expect((await mcpError(rig.http.get({ url: at('/file'), expect: 'html' }))).code).toBe(
      'DOC_NOT_FOUND',
    );
  });
});

describe('gateway: body decoding', () => {
  const BOM = Uint8Array.from([0xef, 0xbb, 0xbf]);

  it('strips the byte-order mark from text bodies', async () => {
    const rig = makeRig({ hosts: HOSTS });
    const url = 'https://doc.esri.com/en/arcgis-pro-sdk/latest/xrefmap.yml';
    const bytes = Buffer.concat([BOM, Buffer.from('references: []')]);
    rig.origin.on(url, body(bytes, 'text/yaml'));
    const res = await rig.http.get({ url, expect: 'yaml' });
    expect(res.text).toBe('references: []');
  });

  it('sees through the byte-order mark when checking the shape', async () => {
    const rig = makeRig({ hosts: HOSTS });
    const url = 'https://doc.esri.com/en/arcgis-pro-sdk/latest/toc.json';
    rig.origin.on(url, body(Buffer.concat([BOM, Buffer.from('{"items":[]}')]), 'application/json'));
    const { data } = await rig.http.getJson({ url });
    expect(data).toEqual({ items: [] });
  });

  it('returns binary bodies as base64 without touching a byte', async () => {
    const rig = makeRig({ hosts: HOSTS });
    const url = at('/python/latest/api-reference/objects.inv');
    const bytes = Buffer.concat([
      BOM,
      Buffer.from('# Sphinx inventory version 2\n'),
      Buffer.from([0x78, 0x9c, 0x00, 0xff, 0xfe, 0x80]),
    ]);
    rig.origin.on(url, body(bytes, 'application/octet-stream'));

    const res = await rig.http.get({ url, expect: 'text', encoding: 'base64' });
    expect(Buffer.from(res.text, 'base64').equals(bytes)).toBe(true);

    // The text reading of the same URL is a different cache entry.
    const asText = await rig.http.get({ url, expect: 'text' });
    expect(asText.cache).toBe('miss');
    expect(asText.text.startsWith('# Sphinx inventory')).toBe(true);
    expect((await rig.http.get({ url, expect: 'text', encoding: 'base64' })).cache).toBe('hit');
  });

  it('rejects an HTML page where a binary file was expected', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(at('/objects.inv'), page(PAGE));
    const error = await mcpError(
      rig.http.get({ url: at('/objects.inv'), expect: 'text', encoding: 'base64' }),
    );
    expect(error.code).toBe('DOC_NOT_FOUND');
  });

  it('decodes with the declared charset and falls back to UTF-8 for an unknown one', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin
      .on(at('/latin'), body(Buffer.from('<p>café</p>', 'latin1'), 'text/html; charset=ISO-8859-1'))
      .on(at('/odd'), body('<p>café</p>', 'text/html; charset="x-not-a-charset"'));
    expect((await rig.http.get({ url: at('/latin'), expect: 'html' })).text).toBe('<p>café</p>');
    expect((await rig.http.get({ url: at('/odd'), expect: 'html' })).text).toBe('<p>café</p>');
  });
});

describe('gateway: size caps', () => {
  const big = `<html><body>${'x'.repeat(4000)}</body></html>`;

  it('refuses a body whose declared length is over the cap, without a retry', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(at('/big/'), page(big, { 'content-length': String(big.length) }));
    const error = await mcpError(
      rig.http.get({ url: at('/big/'), expect: 'html', maxBytes: 1000 }),
    );
    expect(error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(error.details).toMatchObject({ retryable: false });
    expect(error.details?.why).toContain('size cap of 1000 bytes');
    expect(rig.origin.calls).toHaveLength(1);
    // The host answered: this is not a failure of the host.
    expect(rig.http.hostStates()).toEqual([{ host: HOST, breaker: 'closed' }]);
  });

  it('stops reading a body that grows past the cap while streaming', async () => {
    const rig = makeRig({ hosts: HOSTS });
    let pulled = 0;
    const endless = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pulled += 1;
            controller.enqueue(new TextEncoder().encode('<p>chunk</p>'.repeat(50)));
          },
        }),
        { headers: { 'content-type': 'text/html' } },
      );
    rig.origin.on(at('/stream/'), endless);
    const error = await mcpError(
      rig.http.get({ url: at('/stream/'), expect: 'html', maxBytes: 2000 }),
    );
    expect(error.details?.retryable).toBe(false);
    expect(pulled).toBeLessThan(20);
  });

  it('applies the page cap to pages and the index cap to everything else', async () => {
    const rig = makeRig({
      hosts: HOSTS,
      config: {
        limits: {
          requestsPerCall: 12,
          requestsPerIndexBuild: 30,
          callDeadlineMs: 25_000,
          indexBuildDeadlineMs: 20_000,
          pageMaxBytes: 1000,
          indexMaxBytes: 100_000,
        },
      },
    });
    const index = 'entry line; '.repeat(400);
    rig.origin.on(at('/page/'), page(big)).on(at('/index.txt'), body(index, 'text/plain'));
    expect((await mcpError(rig.http.get({ url: at('/page/'), expect: 'html' }))).code).toBe(
      'UPSTREAM_UNAVAILABLE',
    );
    expect((await rig.http.get({ url: at('/index.txt'), expect: 'text' })).text).toBe(index);
  });

  it('does not answer an oversized body with a stale copy', async () => {
    const rig = makeRig({ hosts: HOSTS });
    rig.origin.on(at('/grew/'), page(PAGE), page(big));
    await rig.http.get({ url: at('/grew/'), expect: 'html', maxBytes: 1000 });
    rig.clock.advance(2 * DAY);
    const error = await mcpError(
      rig.http.get({ url: at('/grew/'), expect: 'html', maxBytes: 1000 }),
    );
    expect(error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(error.details?.retryable).toBe(false);
  });
});
