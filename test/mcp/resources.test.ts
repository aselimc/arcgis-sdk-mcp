import { ProtocolError } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BRIEF_URI_TEMPLATE, briefUri } from '../../src/mcp/resources/brief.js';
import { CATALOG_URI } from '../../src/mcp/resources/catalog.js';
import { PRODUCT_URI_TEMPLATE } from '../../src/mcp/resources/product.js';
import { collectStatus, STATUS_URI } from '../../src/mcp/resources/status.js';
import { PRODUCTS } from './support/catalogue.js';
import { type Connection, connectLegacy, type Harness, makeHarness } from './support/harness.js';

describe('resources', () => {
  let harness: Harness;
  let connection: Connection;

  const read = async (uri: string): Promise<{ uri: string; mimeType?: string; text: string }> => {
    const { contents } = await connection.client.readResource({ uri });
    const [first] = contents;
    if (first === undefined || !('text' in first)) throw new Error('expected text contents');
    return first as { uri: string; mimeType?: string; text: string };
  };

  beforeAll(async () => {
    harness = makeHarness({
      workspace: [
        {
          product: 'js-maps-sdk',
          package: '@arcgis/core',
          version: '4.31.0',
          file: 'package.json',
        },
      ],
    });
    connection = await connectLegacy(harness);
  });
  afterAll(() => connection.close());

  it('lists the two fixed resources and one entry per brief, but no product', async () => {
    const { resources } = await connection.client.listResources();
    expect(resources.map((resource) => resource.uri)).toEqual([
      CATALOG_URI,
      STATUS_URI,
      'arcgis-docs://brief/ai/overview',
    ]);
    expect(resources.at(-1)).toMatchObject({
      name: 'brief:ai/overview',
      title: 'AI overview (test)',
      mimeType: 'text/markdown',
    });
    for (const resource of resources) {
      expect(resource.title).toBeTruthy();
      expect(resource.description).toBeTruthy();
    }
  });

  it('lists the product and brief templates', async () => {
    const { resourceTemplates } = await connection.client.listResourceTemplates();
    expect(resourceTemplates.map((template) => template.uriTemplate)).toEqual([
      PRODUCT_URI_TEMPLATE,
      BRIEF_URI_TEMPLATE,
    ]);
    expect(PRODUCT_URI_TEMPLATE).toBe('arcgis-docs://product/{id}');
    expect(BRIEF_URI_TEMPLATE).toBe('arcgis-docs://brief/{+slug}');
  });

  it('serves the whole catalog as JSON, retired products included', async () => {
    const contents = await read(CATALOG_URI);
    expect(contents.mimeType).toBe('application/json');
    const catalog = JSON.parse(contents.text) as { total: number; products: Array<{ id: string }> };
    expect(catalog.total).toBe(PRODUCTS.length);
    expect(catalog.products.map((product) => product.id)).toEqual(PRODUCTS.map(({ id }) => id));
    expect(catalog.products[2]).toMatchObject({ status: 'retired', successor: 'widgets-sdk' });
  });

  it('serves a product profile as Markdown, by id or alias', async () => {
    const byId = await read('arcgis-docs://product/js-maps-sdk');
    expect(byId.mimeType).toBe('text/markdown');
    expect(byId.text).toMatch(/^# Maps SDK for JavaScript \(test\)\n/);
    expect(byId.text).toContain('## Documentation sources');
    const byAlias = await read(`arcgis-docs://product/${encodeURIComponent('@arcgis/core')}`);
    expect(byAlias.text).toBe(byId.text);
  });

  it('answers an unknown product with resource-not-found and the nearest ids', async () => {
    const failure = await connection.client
      .readResource({ uri: 'arcgis-docs://product/js-maps-sdx' })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProtocolError);
    expect((failure as ProtocolError).message).toContain('Unknown product "js-maps-sdx"');
    expect((failure as ProtocolError).message).toContain('Nearest ids: js-maps-sdk');
  });

  it('does not hide an unexpected failure of the profile behind not-found', async () => {
    const profile = harness.services.catalog.profile.bind(harness.services.catalog);
    harness.services.catalog.profile = () => {
      throw new Error('index corrupted');
    };
    const failure = await connection.client
      .readResource({ uri: 'arcgis-docs://product/js-maps-sdk' })
      .catch((error: unknown) => error);
    expect((failure as Error).message).not.toContain('Unknown product');
    harness.services.catalog.profile = profile;
  });

  it('completes product ids and brief slugs from the registry', async () => {
    const complete = async (uri: string, name: string, value: string): Promise<string[]> =>
      (
        await connection.client.complete({
          ref: { type: 'ref/resource', uri },
          argument: { name, value },
        })
      ).completion.values;
    expect(await complete(PRODUCT_URI_TEMPLATE, 'id', 'JS')).toEqual(['js-maps-sdk']);
    expect(await complete(PRODUCT_URI_TEMPLATE, 'id', '')).toEqual(PRODUCTS.map(({ id }) => id));
    expect(await complete(BRIEF_URI_TEMPLATE, 'slug', 'AI/')).toEqual(['ai/overview']);
  });

  it('serves a brief with its verification date and sources', async () => {
    const contents = await read(briefUri('ai/overview'));
    expect(contents.mimeType).toBe('text/markdown');
    expect(contents.text).toBe(
      [
        '# AI overview',
        '',
        'Invented brief text.',
        '',
        'Verified on 2026-10-01. Sources:',
        '- https://developers.arcgis.com/javascript/latest/ai/',
      ].join('\n'),
    );
  });

  it('answers an unknown brief with resource-not-found', async () => {
    const failure = await connection.client
      .readResource({ uri: briefUri('ai/no-such-brief') })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProtocolError);
    expect((failure as ProtocolError).message).toContain('Unknown brief "ai/no-such-brief"');
  });

  it('reports policy, cache, workspace, hosts and sources in the status', async () => {
    const contents = await read(STATUS_URI);
    expect(contents.mimeType).toBe('application/json');
    expect(JSON.parse(contents.text)).toMatchObject({
      server: { name: 'arcgis-sdk-docs', version: '0.0.0-test', mode: 'stdio' },
      asOf: '2026-10-13T12:00:00.000Z',
      policy: { offline: false },
      cache: { maxMb: 500 },
      workspace: { projectDir: '/project', sdks: [{ product: 'js-maps-sdk', version: '4.31.0' }] },
      github: { authenticated: false },
      hosts: [],
      sources: [{ product: 'js-maps-sdk', source: 'guide', state: 'ok', records: 118 }],
    });
  });

  it('leaves local paths and the project out of the status in HTTP mode', async () => {
    const http = makeHarness({
      config: { mode: 'http', projectDir: '/home/someone/project' },
      workspace: [
        { product: 'js-maps-sdk', package: '@arcgis/core', version: '4.31.0', file: 'p.json' },
      ],
    });
    const { dir } = await http.ctx.cache.info();
    const served = await connectLegacy(http);
    try {
      const { contents } = await served.client.readResource({ uri: STATUS_URI });
      const text = (contents[0] as { text: string }).text;
      expect(dir.length).toBeGreaterThan(0);
      expect(text).not.toContain(dir);
      expect(text).not.toContain('/home/someone/project');
      expect(text).not.toContain(process.cwd());
      expect(text).not.toContain(JSON.stringify(process.cwd()).slice(1, -1));
      const status = JSON.parse(text) as Record<string, unknown>;
      expect(Object.keys(status)).toEqual(['server', 'asOf', 'policy', 'cache', 'github', 'hosts', 'sources']);
      expect(status.server).toMatchObject({ mode: 'http' });
      expect(status.cache).toEqual({ bytes: expect.any(Number), entries: expect.any(Number), maxMb: 500 });
    } finally {
      await served.close();
    }
  });

  it('collects the status without issuing a request', async () => {
    const status = await collectStatus(harness);
    expect(Object.keys(status)).toEqual([
      'server',
      'asOf',
      'policy',
      'cache',
      'workspace',
      'github',
      'hosts',
      'sources',
    ]);
    expect(harness.ctx.http.count()).toBe(0);
  });
});
