/**
 * OpenAPI operations and schemas to pages. The input is either the operation or schema list
 * of Esri's Gatsby page data (`openApiOperationPage`, `openApiSchemasPage`) or a whole
 * specification document with an optional target.
 */
import type { RenderMeta, RenderOptions, RendererInputs } from '../core/ports.js';
import type { DocPage, MemberEntry } from '../core/types.js';
import { slugify } from '../core/url.js';
import { asRecord, isRecord, list, records, str } from './json.js';
import { blocks, bullets, fence, firstSentence, inlineCode, table } from './md.js';
import {
  pageDataOperation,
  pageDataSchema,
  type OaOperation,
  type OaProperty,
  type OaResponse,
  type OaSchema,
} from './openapi-model.js';
import { readSpec, type SpecIndex } from './openapi-spec.js';
import { buildSections, finishPage, invalidInput, type Block } from './page.js';

/** Turns the `%%[Name](/path)%%` link syntax of page data into Markdown links. */
type Linker = (text: string) => string;

/**
 * Page data writes links to type pages as `%%[Name](/path)%%`, relative to the Gatsby site
 * (`/rest`), and arrays as `[%%[Name](/path)%%]`. Both become ordinary Markdown.
 */
function linker(meta: RenderMeta, sitePrefix: string | undefined): Linker {
  let origin = '';
  try {
    origin = new URL(meta.url).origin;
  } catch {
    // A non-URL ref (never the case for page data) leaves site-relative links relative.
  }
  const prefix = (sitePrefix ?? '').replace(/^\/?/, '/').replace(/\/$/, '');
  const link = (name: string, path: string): string =>
    `[${name}](${/^https?:/.test(path) ? path : `${origin}${prefix}${path}`})`;
  return (text) =>
    text
      .replace(
        /\[%%\[([^\]]+)\]\(([^)]+)\)%%\]/g,
        (_w, name: string, path: string) => `${link(name, path)}[]`,
      )
      .replace(/%%\[([^\]]+)\]\(([^)]+)\)%%/g, (_w, name: string, path: string) => link(name, path))
      .replace(/%%/g, '');
}

function typeCell(property: OaProperty, links: Linker): string {
  const shown = property.displayType ?? property.type;
  if (shown === undefined) return '';
  if (shown.includes('%%')) {
    const linked = links(shown);
    return property.type === undefined || property.type === 'object' || property.type === 'array'
      ? linked
      : `${linked} (${property.type})`;
  }
  // Page data writes an array of a primitive as `[string]`.
  return inlineCode(shown.replace(/^\[(.+)\]$/, '$1[]'));
}

function descriptionCell(property: OaProperty, links: Linker): string {
  const facts = [
    property.default === undefined ? undefined : `Default ${inlineCode(property.default)}.`,
    property.constraints.length === 0
      ? undefined
      : `Constraints: ${property.constraints.join('; ')}.`,
    property.example === undefined ? undefined : `Example: ${inlineCode(property.example)}.`,
  ].filter((fact) => fact !== undefined);
  return [links((property.description ?? '').trim()), ...facts]
    .filter((part) => part !== '')
    .join(' ');
}

/** Rows of a property table; nested properties follow their parent under a dotted name. */
function rows(properties: readonly OaProperty[], links: Linker, parent = ''): string[][] {
  return properties.flatMap((property) => {
    const array = property.type === 'array' || /^\[.*\]$|\[\]$/.test(property.displayType ?? '');
    const name = `${parent}${property.name}`;
    return [
      [
        inlineCode(name),
        typeCell(property, links),
        property.required === true ? 'yes' : property.required === false ? 'no' : '',
        descriptionCell(property, links),
      ],
      ...rows(property.properties, links, `${name}${array ? '[]' : ''}.`),
    ];
  });
}

function propertyTable(label: string, properties: readonly OaProperty[], links: Linker): string {
  return table([label, 'Type', 'Required', 'Description'], rows(properties, links));
}

function jsonExample(example: string): string {
  return fence(example, /^\s*[{[]/.test(example) ? 'json' : '');
}

const EXAMPLE_LANGUAGES: Record<string, string> = {
  curl: 'bash',
  shell: 'bash',
  node: 'javascript',
};

function responseBlock(response: OaResponse, links: Linker): Block {
  const title = [response.status, response.phrase].filter((part) => part !== undefined).join(' ');
  const type =
    response.displayType?.includes('%%') === true ? links(response.displayType) : undefined;
  return {
    id: `response-${slugify(response.status)}`,
    level: 3,
    title,
    body: blocks(
      links(response.description ?? ''),
      [response.contentType === undefined ? undefined : inlineCode(response.contentType), type]
        .filter((part) => part !== undefined)
        .join(' · '),
      propertyTable('Property', response.properties, links),
      ...response.examples.map(jsonExample),
    ),
  };
}

function operationTitle(operation: OaOperation): string {
  return `${operation.method} ${operation.path}`;
}

function operationPage(operation: OaOperation, links: Linker): { header: string; blocks: Block[] } {
  const parameters = (title: string, properties: readonly OaProperty[]): Block[] =>
    properties.length === 0
      ? []
      : [{ level: 2, title, body: propertyTable('Name', properties, links) }];
  return {
    header: blocks(
      operation.endpoint === undefined
        ? undefined
        : fence(`${operation.method} ${operation.endpoint}`, 'http'),
      operation.operationId === undefined
        ? undefined
        : `**Operation ID:** ${inlineCode(operation.operationId)}`,
    ),
    blocks: [
      {
        level: 1,
        title: operationTitle(operation),
        heading: operationTitle(operation),
        body: blocks(
          operation.deprecated === true ? '> **Deprecated**' : undefined,
          links(operation.summary ?? ''),
          links(operation.description ?? ''),
        ),
      },
      ...parameters('Path parameters', operation.pathParameters),
      ...parameters('Query parameters', operation.queryParameters),
      ...parameters('Header parameters', operation.headerParameters),
      ...parameters('Request body', operation.bodyParameters),
      ...(operation.examples.length === 0
        ? []
        : [
            {
              level: 2,
              title: 'Examples',
              body: blocks(
                ...operation.examples.map((example) =>
                  fence(example.content, EXAMPLE_LANGUAGES[example.language] ?? example.language),
                ),
              ),
            },
          ]),
      ...(operation.responses.length === 0 ? [] : [{ level: 2, title: 'Responses', body: '' }]),
      ...operation.responses.map((response) => responseBlock(response, links)),
    ],
  };
}

/** The anchor of a type on the published pages is its lower-cased name. */
function schemaId(schema: OaSchema): string {
  return schema.name.toLowerCase();
}

function schemaBlock(schema: OaSchema, links: Linker, level: number): Block {
  return {
    id: schemaId(schema),
    level,
    title: schema.name,
    body: blocks(
      schema.type === undefined ? undefined : `Type: ${inlineCode(schema.type)}`,
      links(schema.description ?? ''),
      schema.constraints.length === 0
        ? undefined
        : `Constraints: ${schema.constraints.join('; ')}.`,
      propertyTable('Property', schema.properties, links),
      schema.example === undefined ? undefined : jsonExample(schema.example),
    ),
  };
}

function schemaEntries(schemas: readonly OaSchema[]): MemberEntry[] {
  return schemas.map((schema) => {
    const summary = firstSentence(schema.description);
    return {
      id: schemaId(schema),
      name: schema.name,
      kind: 'type',
      ...(summary === '' ? {} : { summary }),
    };
  });
}

function operationId(operation: OaOperation): string {
  return operation.operationId ?? slugify(operationTitle(operation));
}

function findOperation(
  operations: readonly OaOperation[],
  target: string,
): OaOperation | undefined {
  const wanted = target.trim().toLowerCase();
  return operations.find(
    (operation) =>
      operation.operationId?.toLowerCase() === wanted ||
      operationTitle(operation).toLowerCase() === wanted,
  );
}

function findSchema(schemas: readonly OaSchema[], target: string): OaSchema | undefined {
  const wanted = target.trim().toLowerCase();
  return schemas.find((schema) => schema.name.toLowerCase() === wanted);
}

function renderOperation(
  operation: OaOperation,
  meta: RenderMeta,
  links: Linker,
  opts?: RenderOptions,
): DocPage {
  const page = operationPage(operation, links);
  return finishPage(
    'openapi',
    meta,
    { title: operationTitle(operation), header: page.header, sections: buildSections(page.blocks) },
    opts,
  );
}

function renderSchemas(
  title: string,
  schemas: readonly OaSchema[],
  target: string | undefined,
  meta: RenderMeta,
  links: Linker,
  opts?: RenderOptions,
): DocPage {
  const one = target === undefined ? undefined : findSchema(schemas, target);
  const sectionBlocks: Block[] =
    one === undefined
      ? [{ level: 1, title, body: '' }, ...schemas.map((schema) => schemaBlock(schema, links, 2))]
      : [schemaBlock(one, links, 2)];
  return finishPage(
    'openapi',
    meta,
    { title, sections: buildSections(sectionBlocks), members: schemaEntries(schemas) },
    opts,
  );
}

function renderOverview(
  index: SpecIndex,
  meta: RenderMeta,
  links: Linker,
  opts?: RenderOptions,
): DocPage {
  const title = index.title ?? 'API specification';
  const operations = index.operations.map((operation) => {
    const summary = operation.summary ?? firstSentence(operation.description);
    return `${inlineCode(operationTitle(operation))}${operation.operationId === undefined ? '' : ` (${inlineCode(operation.operationId)})`}${summary === '' ? '' : `: ${summary}`}`;
  });
  const sectionBlocks: Block[] = [
    {
      level: 1,
      title,
      body: blocks(
        index.version === undefined ? undefined : `Version ${index.version}`,
        links(index.description ?? ''),
      ),
    },
    ...(operations.length === 0
      ? []
      : [{ level: 2, title: 'Operations', body: bullets(operations) }]),
    ...(index.schemas.length === 0
      ? []
      : [
          {
            level: 2,
            title: 'Schemas',
            body: bullets(index.schemas.map((schema) => inlineCode(schema.name))),
          },
        ]),
  ];
  const members: MemberEntry[] = [
    ...index.operations.map((operation): MemberEntry => {
      const summary = operation.summary ?? firstSentence(operation.description);
      return {
        id: operationId(operation),
        name: operationTitle(operation),
        kind: 'operation',
        ...(summary === '' ? {} : { summary }),
      };
    }),
    ...schemaEntries(index.schemas),
  ];
  return finishPage(
    'openapi',
    meta,
    { title, sections: buildSections(sectionBlocks), members },
    opts,
  );
}

/**
 * Renders OpenAPI content.
 *
 * - `operation`: one operation of page data, as a page titled `METHOD path`.
 * - `schemas`: the schema list of page data (an array, or the object holding it); `target`
 *   names one schema, whose section id is the lower-cased name used as anchor on the site.
 * - `spec`: a specification document. `target` is an `operationId`, `METHOD path` or a
 *   schema name; without it the page is an index of operations and schemas.
 *
 * A target that matches nothing gives the whole page, as for any selector.
 *
 * @throws McpDocError `DOC_NOT_FOUND` when none of the three inputs is usable.
 */
export function renderOpenapi(
  input: RendererInputs['openapi'],
  meta: RenderMeta,
  opts?: RenderOptions,
): DocPage {
  const links = linker(meta, input.sitePrefix);
  if (isRecord(input.operation)) {
    return renderOperation(pageDataOperation(input.operation), meta, links, opts);
  }
  if (input.schemas !== undefined && input.schemas !== null) {
    const holder = asRecord(input.schemas);
    const schemas = records(Array.isArray(input.schemas) ? list(input.schemas) : holder.schemas);
    return renderSchemas(
      str(holder.title) ?? 'Types',
      schemas.map(pageDataSchema),
      input.target,
      meta,
      links,
      opts,
    );
  }
  if (isRecord(input.spec)) {
    const index = readSpec(input.spec);
    const operation =
      input.target === undefined ? undefined : findOperation(index.operations, input.target);
    if (operation !== undefined) return renderOperation(operation, meta, links, opts);
    const schema = input.target === undefined ? undefined : findSchema(index.schemas, input.target);
    if (schema !== undefined) {
      return renderSchemas(
        index.title ?? 'Schemas',
        index.schemas,
        input.target,
        meta,
        links,
        opts,
      );
    }
    return renderOverview(index, meta, links, opts);
  }
  throw invalidInput('openapi', meta, 'the input holds no operation, schema list or specification');
}
