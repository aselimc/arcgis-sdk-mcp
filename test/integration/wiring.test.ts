import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createContainer } from '../../src/app/composition-root.js';
import { runCall } from '../../src/cli/call.js';
import { TOOLS } from '../../src/core/names.js';
import { createServer } from '../../src/mcp/server.js';
import { makeConfig } from '../support/builders.js';
import { FakeLogger } from '../support/fake-logger.js';
import { readFixture } from '../support/fixtures.js';

/**
 * Seams between packages, exercised with the real registry, adapters, extractor, renderers
 * and services. Only the transport is scripted: `fetch` answers from synthetic fixtures.
 *
 * Each case below is a defect that the unit tests of both sides of a seam passed, because
 * each side was tested against a fake of the other.
 */

type Route = { body: string; type: string };

const html = (family: string): Route => ({
  body: readFixture('synthetic', 'html', family, 'page.html'),
  type: 'text/html; charset=utf-8',
});

/** A small OpenAPI 3.1 document without operation ids, as the Site Scan API publishes. */
const HANGAR_API = {
  openapi: '3.1.0',
  info: { title: 'Hangar API', version: '9.9.9' },
  paths: {
    '/flights/{flightId}': {
      parameters: [{ name: 'flightId', in: 'path', required: true, schema: { type: 'string' } }],
      get: {
        summary: 'Get flight by ID',
        description: 'Returns one flight with its photos.',
        tags: ['Flights'],
        parameters: [{ name: 'withPhotos', in: 'query', schema: { type: 'boolean' } }],
        responses: {
          '200': {
            description: 'The flight',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Flight' } } },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Flight: {
        type: 'object',
        description: 'One flight of a drone.',
        properties: {
          altitude: { type: 'number', description: 'Metres above the take-off point.' },
          pilot: { type: 'string' },
        },
      },
      Hangar: { type: 'object', properties: { doors: { type: 'integer' } } },
    },
  },
};

const SAMPLE = 'https://developers.arcgis.com/javascript/latest/sample-code/intro-charts/';
const QT_CLASS = 'https://developers.arcgis.com/qt/cpp/api-reference/harbor-chart.html';
const SPEC = 'https://sitescan-api.arcgis.com/api/v2/apidocs.json';

const ROUTES: Record<string, Route> = {
  [SAMPLE]: html('astro-sample'),
  [QT_CLASS]: html('qdoc'),
  [SPEC]: { body: JSON.stringify(HANGAR_API), type: 'application/json' },
};

describe('package seams, with only the transport scripted', () => {
  let cacheDir: string;

  const fetchImpl: typeof fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    const route = ROUTES[url];
    return route === undefined
      ? new Response('', { status: 404 })
      : new Response(route.body, { status: 200, headers: { 'content-type': route.type } });
  };

  const call = (tool: (typeof TOOLS)[keyof typeof TOOLS], args: Record<string, unknown>) =>
    runCall(
      createServer(
        createContainer(makeConfig({ cacheDir }), { logger: new FakeLogger(), fetchImpl }),
      ),
      tool,
      args,
      '0.0.0',
    );

  beforeAll(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'arcgis-sdk-mcp-seams-'));
  });

  afterAll(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  // The samples source declares the family of its site (`astro`); that hint replaced the
  // detection of the page type, so no sample page of the JavaScript SDK had source files.
  it('reads the source of a sample page of an Astro site', async () => {
    const whole = await call(TOOLS.read, { ref: SAMPLE });
    expect(whole.isError).toBe(false);
    expect(whole.text.split('\n')[0]).toContain('| sample |');

    const source = await call(TOOLS.read, { ref: SAMPLE, section: 'source' });
    expect(source.isError).toBe(false);
    expect(source.text).toContain('## Source: ');
    expect(source.text).toMatch(/```(?:html|js|javascript|ts|tsx)\n/);
  });

  // The Qt reference is QDoc output inside the Astro shell of the guide source.
  it('converts a Qt reference page with the QDoc profile', async () => {
    const page = await call(TOOLS.read, { ref: QT_CLASS });
    expect(page.isError).toBe(false);
    expect(page.text).toContain('```cpp\nclass Harbor::Chart\n```');
    expect(page.text).toContain(
      '- [`Chart(QObject *parent = nullptr)`](https://developers.arcgis.com/qt/cpp/api-reference/harbor-chart.html#Chart)',
    );
    // The breadcrumb item QDoc emits outside any list is not content.
    expect(page.text).not.toMatch(/^- Chart$/m);
  });

  // The OpenAPI adapter passed a raw operation and a map of schemas in the renderer's
  // page-data inputs, which read both as empty.
  it('renders an operation of an OpenAPI document with its parameters and responses', async () => {
    const operation = await call(TOOLS.read, { ref: `${SPEC}#get-flight-by-id` });
    expect(operation.isError).toBe(false);
    expect(operation.text).toContain('# GET /flights/{flightId}');
    expect(operation.text).toContain('Returns one flight with its photos.');
    expect(operation.text).toContain('`flightId`');
    expect(operation.text).toContain('`withPhotos`');
    expect(operation.text).toContain('The flight');
  });

  it('renders one schema of an OpenAPI document with its properties', async () => {
    const schema = await call(TOOLS.read, { ref: `${SPEC}#/components/schemas/Flight` });
    expect(schema.isError).toBe(false);
    expect(schema.text).toContain('One flight of a drone.');
    expect(schema.text).toContain('`altitude`');
    expect(schema.text).toContain('Metres above the take-off point.');
    expect(schema.text).not.toContain('`doors`');
  });
});
