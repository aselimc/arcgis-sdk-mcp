/**
 * Real OpenAPI documents (3.x, and Swagger 2 where the two differ little) reduced to the
 * model in `openapi-model.ts`, so one renderer serves both them and Esri's page data.
 */
import { asRecord, isRecord, list, records, scalar, str, strings, type Json } from './json.js';
import {
  constraintsOf,
  type OaOperation,
  type OaProperty,
  type OaResponse,
  type OaSchema,
} from './openapi-model.js';

/** What a specification document contains. */
export interface SpecIndex {
  title?: string;
  version?: string;
  description?: string;
  operations: OaOperation[];
  schemas: OaSchema[];
}

const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace'];
/** Inline objects deeper than this are named by type only; specs can nest without end. */
const MAX_DEPTH = 4;

/** Follows a local `$ref` (`#/components/schemas/X`); other nodes are returned as they are. */
function deref(spec: Json, node: unknown, seen: ReadonlySet<string> = new Set()): Json {
  const record = asRecord(node);
  const ref = str(record.$ref);
  if (ref === undefined || !ref.startsWith('#/') || seen.has(ref)) return record;
  let target: unknown = spec;
  for (const segment of ref.slice(2).split('/')) {
    target = asRecord(target)[segment.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return deref(spec, target, new Set([...seen, ref]));
}

function refName(node: unknown): string | undefined {
  return str(asRecord(node).$ref)?.split('/').at(-1);
}

/** A schema with its `allOf` parts merged, which is how composed objects are documented. */
function flatten(spec: Json, node: unknown): Json {
  const schema = deref(spec, node);
  const parts = list(schema.allOf);
  if (parts.length === 0) return schema;
  const merged: Json = { ...schema, properties: { ...asRecord(schema.properties) } };
  const required = new Set(strings(schema.required));
  for (const part of parts) {
    const flat = flatten(spec, part);
    Object.assign(asRecord(merged.properties), asRecord(flat.properties));
    for (const name of strings(flat.required)) required.add(name);
    merged.type ??= flat.type;
    merged.description ??= flat.description;
  }
  return { ...merged, required: [...required] };
}

function displayType(spec: Json, node: unknown): string | undefined {
  const named = refName(node);
  if (named !== undefined) return named;
  const schema = deref(spec, node);
  if (schema.type === 'array' || isRecord(schema.items)) {
    return `${displayType(spec, schema.items) ?? 'any'}[]`;
  }
  const alternatives = [...list(schema.oneOf), ...list(schema.anyOf)];
  if (alternatives.length > 0) {
    return alternatives.map((option) => displayType(spec, option) ?? 'any').join(' | ');
  }
  const type = Array.isArray(schema.type) ? strings(schema.type).join(' | ') : str(schema.type);
  return type ?? (isRecord(schema.properties) ? 'object' : undefined);
}

function childProperties(spec: Json, node: unknown, depth: number): OaProperty[] {
  if (depth >= MAX_DEPTH) return [];
  const schema = flatten(spec, node);
  // The fields of an array's elements are documented under the array itself.
  const holder = isRecord(schema.items) ? flatten(spec, schema.items) : schema;
  const required = new Set(strings(holder.required));
  return Object.entries(asRecord(holder.properties)).map(([name, child]) =>
    property(spec, name, child, required.has(name), depth + 1),
  );
}

function property(
  spec: Json,
  name: string,
  node: unknown,
  required: boolean | undefined,
  depth: number,
): OaProperty {
  const schema = flatten(spec, node);
  const description = str(asRecord(node).description) ?? str(schema.description);
  const type = str(schema.type);
  const shown = displayType(spec, node);
  const fallback = scalar(schema.default);
  const example = scalar(schema.example);
  // A named schema is documented once, under its own name; only inline objects are expanded.
  const inline = refName(node) === undefined && refName(asRecord(schema.items)) === undefined;
  return {
    name,
    ...(description === undefined ? {} : { description }),
    ...(required === undefined ? {} : { required }),
    ...(type === undefined ? {} : { type }),
    ...(shown === undefined ? {} : { displayType: shown }),
    ...(fallback === undefined ? {} : { default: fallback }),
    ...(example === undefined ? {} : { example }),
    constraints: constraintsOf(schema),
    properties: inline ? childProperties(spec, node, depth) : [],
  };
}

function parameter(spec: Json, node: Json): OaProperty {
  // OpenAPI 3 nests the type under `schema`; Swagger 2 puts it on the parameter.
  const schema = isRecord(node.schema) ? node.schema : node;
  const base = property(spec, str(node.name) ?? '', schema, node.required === true, 0);
  const description = str(node.description) ?? base.description;
  const example = scalar(node.example) ?? base.example;
  return {
    ...base,
    ...(description === undefined ? {} : { description }),
    ...(example === undefined ? {} : { example }),
  };
}

interface Content {
  contentType?: string;
  schema?: unknown;
  examples: string[];
}

function asExample(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

/** The first media type of a request body or response, with its schema and examples. */
function contentOf(node: Json): Content {
  const [entry] = Object.entries(asRecord(node.content));
  if (entry === undefined) {
    // Swagger 2: the schema sits directly on the response.
    return { ...(node.schema === undefined ? {} : { schema: node.schema }), examples: [] };
  }
  const [contentType, media] = entry;
  const body = asRecord(media);
  const examples = [
    asExample(body.example),
    ...Object.values(asRecord(body.examples)).map((example) => asExample(asRecord(example).value)),
  ].filter((example) => example !== undefined);
  return { contentType, schema: body.schema, examples };
}

function response(spec: Json, status: string, node: unknown): OaResponse {
  const resolved = deref(spec, node);
  const content = contentOf(resolved);
  const description = str(resolved.description);
  const shown = content.schema === undefined ? undefined : displayType(spec, content.schema);
  return {
    status,
    ...(description === undefined ? {} : { description }),
    ...(content.contentType === undefined ? {} : { contentType: content.contentType }),
    ...(shown === undefined ? {} : { displayType: shown }),
    properties: content.schema === undefined ? [] : childProperties(spec, content.schema, 0),
    examples: content.examples,
  };
}

function baseUrl(spec: Json): string | undefined {
  const server = str(asRecord(list(spec.servers)[0]).url);
  if (server !== undefined) return server.replace(/\/$/, '');
  const host = str(spec.host);
  if (host === undefined) return undefined;
  return `${strings(spec.schemes)[0] ?? 'https'}://${host}${(str(spec.basePath) ?? '').replace(/\/$/, '')}`;
}

function operation(spec: Json, path: string, method: string, shared: Json[], node: Json): OaOperation {
  const parameters = [...shared, ...records(node.parameters)].map((item) => deref(spec, item));
  const located = (where: string): OaProperty[] =>
    parameters.filter((item) => item.in === where).map((item) => parameter(spec, item));
  const body = contentOf(deref(spec, node.requestBody));
  const legacyBody = parameters.find((item) => item.in === 'body');
  const bodySchema = body.schema ?? legacyBody?.schema;
  const base = baseUrl(spec);
  const operationId = str(node.operationId);
  const summary = str(node.summary);
  const description = str(node.description);
  return {
    method: method.toUpperCase(),
    path,
    ...(operationId === undefined ? {} : { operationId }),
    ...(base === undefined ? {} : { endpoint: `${base}${path}` }),
    ...(summary === undefined ? {} : { summary }),
    ...(description === undefined ? {} : { description }),
    ...(node.deprecated === true ? { deprecated: true } : {}),
    pathParameters: located('path'),
    queryParameters: located('query'),
    headerParameters: located('header'),
    bodyParameters: [
      ...located('formData'),
      ...(bodySchema === undefined ? [] : childProperties(spec, bodySchema, 0)),
    ],
    examples: [],
    responses: Object.entries(asRecord(node.responses)).map(([status, item]) =>
      response(spec, status, item),
    ),
  };
}

/** Reads every operation and named schema of an OpenAPI document. */
export function readSpec(spec: Json): SpecIndex {
  const info = asRecord(spec.info);
  const operations = Object.entries(asRecord(spec.paths)).flatMap(([path, item]) => {
    const pathItem = deref(spec, item);
    const shared = records(pathItem.parameters);
    return METHODS.flatMap((method) =>
      isRecord(pathItem[method]) ? [operation(spec, path, method, shared, pathItem[method])] : [],
    );
  });
  const named = { ...asRecord(spec.definitions), ...asRecord(asRecord(spec.components).schemas) };
  const schemas = Object.entries(named).map(([name, node]): OaSchema => {
    const schema = flatten(spec, node);
    const type = displayType(spec, schema);
    const description = str(schema.description);
    const example = asExample(schema.example);
    return {
      name,
      ...(type === undefined ? {} : { type }),
      ...(description === undefined ? {} : { description }),
      ...(example === undefined ? {} : { example }),
      constraints: constraintsOf(schema),
      properties: childProperties(spec, schema, 0),
    };
  });
  const title = str(info.title);
  const version = scalar(info.version);
  const description = str(info.description);
  return {
    ...(title === undefined ? {} : { title }),
    ...(version === undefined ? {} : { version }),
    ...(description === undefined ? {} : { description }),
    operations,
    schemas,
  };
}
