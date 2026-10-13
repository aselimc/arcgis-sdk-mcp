import { describe, expect, it } from 'vitest';
import { renderOpenapi } from '../../src/render/openapi.js';
import { makeMeta, pageText, sectionIds } from './helpers.js';

const meta = makeMeta({
  url: 'https://survey-api.example.com/api/v2/apidocs.json',
  kind: 'spec',
  license: 'unlicensed',
});

/** A specification whose shapes are those of a real upload API; every name is invented. */
const spec = {
  openapi: '3.0.1',
  info: { title: 'Survey flights', version: '2' },
  paths: {
    '/flights/{flightId}/media': {
      post: {
        operationId: 'add-photo',
        summary: 'Add photo',
        description: 'Uploads one photo of a flight.',
        parameters: [{ name: 'flightId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          description:
            'There are 3 supported request body formats:\n\n  * A multipart upload.\n  * An image sent directly.\n  * A JSON body with a URL.',
          required: true,
          content: {
            'image/jpeg': { schema: { type: 'string', format: 'binary' } },
            'image/tiff': { schema: { type: 'string', format: 'binary' } },
            'multipart/form-data': {},
            'application/json': {
              schema: { $ref: '#/components/schemas/UploadUrlRequest' },
              examples: {
                'Upload from URL': { value: { url: 'https://example.com/a.jpg', name: 'a.jpg' } },
              },
            },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/flights': {
      get: {
        operationId: 'list-flights',
        summary: 'List flights',
        description: 'List flights',
        responses: {
          '200': {
            description: 'List of flights',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Flight' } },
              },
            },
          },
        },
      },
      put: {
        operationId: 'replace-raw',
        requestBody: { content: { 'application/octet-stream': { schema: { format: 'binary' } } } },
        responses: {},
      },
    },
  },
  components: {
    schemas: {
      UploadUrlRequest: {
        type: 'object',
        required: ['url'],
        properties: { url: { type: 'string', description: 'Where the photo is.' }, name: { type: 'string' } },
      },
      Flight: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Flight ID' },
          mode: { enum: ['manual', 'grid'], description: 'How it was flown.' },
          size: { description: 'Free-form.' },
          vehicle: { type: 'string', deprecated: true, description: 'Use `aircraft`.' },
        },
      },
    },
  },
};

// Regression: `contentOf` took the first media type only. An upload operation whose first
// media type is a binary string had no request-body section at all, and no operation showed
// the description, the media types or the examples of its body.
describe('renderOpenapi: request body of a specification', () => {
  const text = pageText(renderOpenapi({ spec, target: 'add-photo' }, meta));

  it('describes a body whose first media type has no fields', () => {
    expect(text).toContain(
      [
        '## Request body',
        '',
        'There are 3 supported request body formats:',
        '',
        '  * A multipart upload.',
        '  * An image sent directly.',
        '  * A JSON body with a URL.',
        '',
        '`image/jpeg` · `image/tiff` · `multipart/form-data` · `application/json` · `UploadUrlRequest` · required',
        '',
        '| Name | Type | Required | Description |',
        '| --- | --- | --- | --- |',
        '| `url` | `string` | yes | Where the photo is. |',
        '| `name` | `string` | no |  |',
      ].join('\n'),
    );
  });

  it('shows the examples of the body as fences', () => {
    expect(text).toContain(
      '**Example**\n\n```json\n{\n  "url": "https://example.com/a.jpg",\n  "name": "a.jpg"\n}\n```',
    );
  });

  it('keeps the section when no field can be listed', () => {
    const page = renderOpenapi({ spec, target: 'replace-raw' }, meta);
    expect(sectionIds(page)).toContain('request-body');
    expect(pageText(page)).toContain('## Request body\n\n`application/octet-stream`');
  });

  it('has no section for an operation without a body', () => {
    expect(sectionIds(renderOpenapi({ spec, target: 'list-flights' }, meta))).not.toContain(
      'request-body',
    );
  });
});

describe('renderOpenapi: responses of a specification', () => {
  const text = pageText(renderOpenapi({ spec, target: 'list-flights' }, meta));

  // Regression: an array of `Flight` read as one object, and the schema name was never shown.
  it('names the schema of a response and says when it is an array', () => {
    expect(text).toContain(
      '### 200\n\nList of flights\n\n`application/json` · `Flight[]`\n\nThe body is an array; the table describes one item.\n\n| Property |',
    );
  });

  it('gives a property without a type a type, and marks a deprecated one', () => {
    expect(text).toContain('| `mode` | `string` | no | How it was flown. Constraints: one of `manual`, `grid`. |');
    expect(text).toContain('| `size` | `any` | no | Free-form. |');
    expect(text).toContain('| `vehicle` | `string` | no | Use `aircraft`. **Deprecated.** |');
  });

  it('prints a summary that equals the description once', () => {
    expect(text.match(/List flights/g)).toHaveLength(1);
    expect(pageText(renderOpenapi({ spec, target: 'add-photo' }, meta))).toContain(
      'Add photo\n\nUploads one photo of a flight.',
    );
  });
});
