import { deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { isMcpDocError } from '../../src/core/errors.js';
import { FakeHttp } from './fake-http.js';

const INDEX = 'https://developers.arcgis.com/widgets/search.json';
const INVENTORY = 'https://developers.arcgis.com/widgets/api-reference/objects.inv';

async function failure(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('FakeHttp size cap', () => {
  it('rejects a body over an explicit maxBytes without offering a retry', async () => {
    const http = new FakeHttp().on(INDEX, { json: { pages: ['a', 'b', 'c'] } });
    expect((await http.get({ url: INDEX, expect: 'json', maxBytes: 1024 })).status).toBe(200);

    const error = await failure(() => http.get({ url: INDEX, expect: 'json', maxBytes: 8 }));
    expect(isMcpDocError(error) && error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(isMcpDocError(error) && error.details).toMatchObject({
      url: INDEX,
      host: 'developers.arcgis.com',
      retryable: false,
    });
  });

  it('injects the same failure with the "oversized" fault', async () => {
    const http = new FakeHttp().on(INDEX, { json: {} }).fail(INDEX, 'oversized', { times: 1 });
    const error = await failure(() => http.getJson({ url: INDEX }));
    expect(isMcpDocError(error) && error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(isMcpDocError(error) && error.details?.retryable).toBe(false);
    expect((await http.getJson({ url: INDEX })).data).toEqual({});
  });
});

describe('FakeHttp binary bodies', () => {
  it('returns a base64 recording as written and logs the requested encoding', async () => {
    // The shape of a Sphinx inventory: text header lines, then a zlib stream.
    const header = '# Sphinx inventory version 2\n# Project: widgets\n';
    const payload = deflateSync(Buffer.from('widgets.Widget py:class 1 api/#$ -\n', 'utf8'));
    const body = Buffer.concat([Buffer.from(header, 'utf8'), payload]).toString('base64');
    const http = new FakeHttp().on(INVENTORY, { body });

    const res = await http.get({ url: INVENTORY, expect: 'text', encoding: 'base64' });
    const bytes = Buffer.from(res.text, 'base64');
    expect(bytes.subarray(0, header.length).toString('utf8')).toBe(header);
    expect(inflateSync(bytes.subarray(header.length)).toString('utf8')).toContain('py:class');
    expect(http.requests[0]).toMatchObject({ url: INVENTORY, encoding: 'base64' });

    await http.get({ url: INVENTORY, expect: 'text' });
    expect(http.requests[1]).not.toHaveProperty('encoding');
  });
});
