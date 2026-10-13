import { describe, expect, it } from 'vitest';
import { isMcpDocError } from '../../src/core/errors.js';
import { renderOpenapi } from '../../src/render/openapi.js';
import { readJsonFixture } from '../support/fixtures.js';
import { expectGolden, makeMeta, pageText, sectionIds, structured } from './helpers.js';

const OPERATION_URL = 'https://developers.arcgis.com/rest/beacons/near-point-get/';
const TYPES_URL = 'https://developers.arcgis.com/rest/beacons/types/';
const SPEC_URL = 'https://github.com/example/beacons/blob/v1.2.0/openapi.json';

const operationPage = readJsonFixture<{ operation: unknown }>(
  ...structured('openapi', 'operation.json'),
);
const schemasPage = readJsonFixture<{ schemas: unknown[] }>(
  ...structured('openapi', 'schemas.json'),
);
const spec = readJsonFixture(...structured('openapi', 'spec.json'));

describe('renderOpenapi: page-data operation', () => {
  const page = renderOpenapi(
    { operation: operationPage.operation, sitePrefix: '/rest' },
    makeMeta({ url: OPERATION_URL }),
  );

  it('matches the golden file', () => {
    expectGolden(page, ...structured('openapi', 'operation.expected.md'));
  });

  it('titles the page with method and path and puts the endpoint in the header', () => {
    expect(page.title).toBe('GET /beacons/near-point');
    expect(page.header).toContain(
      '```http\nGET https://beacons-api.example.com/v1/beacons/near-point\n```',
    );
    expect(page.header).toContain('`beaconsNearPointGet`');
  });

  it('unwraps the %% link syntax against the site prefix, arrays included', () => {
    const text = pageText(page);
    expect(text).not.toContain('%%');
    expect(text).toContain(
      '[XCoord](https://developers.arcgis.com/rest/beacons/types/#xcoord) (number)',
    );
    expect(text).toContain('[KindId](https://developers.arcgis.com/rest/beacons/types/#kindid)[]');
    expect(text).toContain('| `tags` | `string[]` |');
  });

  it('keeps table rows on one line and escapes pipes', () => {
    const rows = pageText(page)
      .split('\n')
      .filter((line) => line.startsWith('| `'));
    expect(rows.find((row) => row.includes('`kindIds`'))).toContain(
      '<br>- `tower` for masonry towers',
    );
    expect(rows.find((row) => row.startsWith('| `f`'))).toContain('(a \\| b)');
  });

  it('has one section per parameter group and per response', () => {
    expect(sectionIds(page)).toEqual([
      'get-beaconsnear-point',
      'query-parameters',
      'header-parameters',
      'examples',
      'responses',
      'response-200',
      'response-400',
    ]);
    expect(page.sections.find((section) => section.id === 'response-200')?.parent).toBe(
      'responses',
    );
  });

  it('lists nested response properties under dotted names and maps curl to bash', () => {
    const text = pageText(page);
    expect(text).toContain('| `paging.nextUrl` | `string` | no |');
    expect(text).toContain('| `error.code` | `integer` | yes |');
    expect(text).toContain('```bash\ncurl ');
    expect(page.diagnostics).toMatchObject({
      family: 'structured',
      renderer: 'openapi',
      leftoverHtmlTags: 0,
    });
    expect(page.diagnostics.fences).toBe(page.diagnostics.fencesWithLanguage);
  });

  it('returns one section when asked for it', () => {
    const sliced = renderOpenapi(
      { operation: operationPage.operation, sitePrefix: 'rest' },
      makeMeta({ url: OPERATION_URL }),
      { select: { section: 'responses' } },
    );
    expect(sectionIds(sliced)).toEqual(['responses', 'response-200', 'response-400']);
    expect(sliced.title).toBe('GET /beacons/near-point');
  });
});

describe('renderOpenapi: page-data schemas', () => {
  const meta = makeMeta({ url: TYPES_URL });

  it('matches the golden file', () => {
    const page = renderOpenapi({ schemas: schemasPage, sitePrefix: '/rest' }, meta);
    expectGolden(page, ...structured('openapi', 'schemas.expected.md'));
    expect(sectionIds(page)).toEqual(['types', 'kindid', 'nearpointresult']);
    expect(page.members?.map((member) => member.name)).toEqual(['KindId', 'NearPointResult']);
  });

  it('accepts the bare schema array', () => {
    const page = renderOpenapi({ schemas: schemasPage.schemas }, meta);
    expect(page.title).toBe('Types');
    expect(page.sections).toHaveLength(3);
  });

  it('returns one schema for a target, matched without regard to case', () => {
    const page = renderOpenapi({ schemas: schemasPage, target: 'nearpointresult' }, meta);
    expect(sectionIds(page)).toEqual(['nearpointresult']);
    expect(page.members).toHaveLength(2);
    expect(page.sections[0]?.markdown).toContain('```json\n{\n  "beaconId": "b-17"');
  });

  it('returns every schema when the target is unknown', () => {
    const page = renderOpenapi({ schemas: schemasPage, target: 'Nope' }, meta);
    expect(page.sections).toHaveLength(3);
  });
});

describe('renderOpenapi: specification document', () => {
  const meta = makeMeta({ url: SPEC_URL, kind: 'spec', license: 'unlicensed' });

  it('renders an operation by operationId', () => {
    const page = renderOpenapi({ spec, target: 'getBeacon' }, meta);
    expectGolden(page, ...structured('openapi', 'spec-operation.expected.md'));
    expect(page.title).toBe('GET /beacons/{beaconId}');
    expect(page.header).toContain('GET https://beacons-api.example.com/v1/beacons/{beaconId}');
  });

  it('finds an operation by method and path and marks deprecation', () => {
    const page = renderOpenapi({ spec, target: 'put /beacons/{beaconId}' }, meta);
    expect(page.title).toBe('PUT /beacons/{beaconId}');
    const text = pageText(page);
    expect(text).toContain('> **Deprecated**');
    expect(text).toContain('## Request body');
    // Inline objects are expanded, referenced schemas are named.
    expect(text).toContain(
      '| `light.colour` | `string` | no | Constraints: one of `white`, `red`, `green`. |',
    );
    expect(text).toContain('| `position` | `Position` | no |');
    expect(text).toContain('| `keepers` | `Keeper[]` | no |');
    expect(text).not.toContain('keepers[].name');
  });

  it('renders a schema by name, with allOf merged', () => {
    const page = renderOpenapi({ spec, target: 'Keeper' }, meta);
    expect(sectionIds(page)).toEqual(['keeper']);
    expect(page.sections[0]?.markdown).toContain(
      '| `x` | `number` | yes | Constraints: format double. |',
    );
    expect(page.sections[0]?.markdown).toContain('| `name` | `string` | yes |');
  });

  it('indexes operations and schemas when there is no target', () => {
    const page = renderOpenapi({ spec }, meta);
    expectGolden(page, ...structured('openapi', 'spec-index.expected.md'));
    expect(page.title).toBe('Beacon registry');
    expect(page.members?.filter((member) => member.kind === 'operation')).toEqual([
      {
        id: 'getBeacon',
        name: 'GET /beacons/{beaconId}',
        kind: 'operation',
        summary: 'Read one beacon.',
      },
      {
        id: 'replaceBeacon',
        name: 'PUT /beacons/{beaconId}',
        kind: 'operation',
        summary: 'Replace one beacon.',
      },
    ]);
  });

  it('reads Swagger 2 documents', () => {
    const swagger = {
      swagger: '2.0',
      info: { title: 'Old beacons' },
      host: 'old.example.com',
      basePath: '/api/',
      paths: {
        '/beacons': {
          post: {
            parameters: [
              { name: 'body', in: 'body', schema: { $ref: '#/definitions/Beacon' } },
              { name: 'dryRun', in: 'query', type: 'boolean', default: false },
            ],
            responses: {
              201: { description: 'Created.', schema: { $ref: '#/definitions/Beacon' } },
            },
          },
        },
      },
      definitions: { Beacon: { type: 'object', properties: { id: { type: 'string' } } } },
    };
    const page = renderOpenapi({ spec: swagger, target: 'POST /beacons' }, meta);
    const text = pageText(page);
    expect(page.header).toContain('POST https://old.example.com/api/beacons');
    expect(text).toContain('| `dryRun` | `boolean` | no | Default `false`. |');
    expect(text).toContain('## Request body');
    expect(text).toContain('### 201');
  });

  it('survives self-referencing schemas', () => {
    const cyclic = {
      openapi: '3.1.0',
      paths: {},
      components: {
        schemas: {
          Node: {
            type: 'object',
            properties: {
              next: { $ref: '#/components/schemas/Node' },
              loop: { $ref: '#/components/schemas/Loop' },
            },
          },
          Loop: { $ref: '#/components/schemas/Loop' },
        },
      },
    };
    const page = renderOpenapi({ spec: cyclic, target: 'Node' }, meta);
    expect(page.sections[0]?.markdown).toContain('| `next` | `Node` |');
  });
});

describe('renderOpenapi: unusable input', () => {
  it('throws DOC_NOT_FOUND with the URL', () => {
    const meta = makeMeta({ url: OPERATION_URL });
    let caught: unknown;
    try {
      renderOpenapi({ operation: 'not an object' }, meta);
    } catch (error) {
      caught = error;
    }
    expect(isMcpDocError(caught)).toBe(true);
    expect(caught).toMatchObject({ code: 'DOC_NOT_FOUND', details: { url: OPERATION_URL } });
  });
});
