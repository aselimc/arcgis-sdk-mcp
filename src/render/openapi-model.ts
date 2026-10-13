/**
 * The one shape both OpenAPI inputs are reduced to before rendering: the pre-digested
 * operation and schema objects of Esri's Gatsby page data, and real OpenAPI documents
 * (`openapi-spec.ts`).
 */
import { asRecord, list, records, scalar, str, type Json } from './json.js';

/** A parameter, a request-body field or a property of a schema. */
export interface OaProperty {
  name: string;
  description?: string;
  required?: boolean;
  /** JSON type (`string`, `array`, ...). */
  type?: string;
  /** Type as shown to readers; may carry the `%%[Name](/path)%%` link syntax. */
  displayType?: string;
  default?: string;
  example?: string;
  /** `min 1`, `max 20`, `one of ...`, `pattern ...`. */
  constraints: string[];
  properties: OaProperty[];
}

/** One response of an operation. */
export interface OaResponse {
  status: string;
  phrase?: string;
  description?: string;
  contentType?: string;
  displayType?: string;
  properties: OaProperty[];
  examples: string[];
}

/** One code example of an operation. */
export interface OaExample {
  language: string;
  content: string;
}

/** One operation (a method on a path). */
export interface OaOperation {
  operationId?: string;
  method: string;
  path: string;
  /** Full URL of the endpoint when the source states it. */
  endpoint?: string;
  summary?: string;
  description?: string;
  deprecated?: boolean;
  pathParameters: OaProperty[];
  queryParameters: OaProperty[];
  headerParameters: OaProperty[];
  bodyParameters: OaProperty[];
  examples: OaExample[];
  responses: OaResponse[];
}

/** One named schema (a "type" on the published pages). */
export interface OaSchema {
  name: string;
  type?: string;
  description?: string;
  example?: string;
  constraints: string[];
  properties: OaProperty[];
}

/** The constraint phrases of a parameter or property, from JSON Schema keywords. */
export function constraintsOf(node: Json): string[] {
  const phrase = (label: string, key: string): string | undefined => {
    const value = scalar(node[key]);
    return value === undefined ? undefined : `${label} ${value}`;
  };
  const allowed = [
    ...list(node.enum),
    // Page data lists enumerations as [{ title, values }].
    ...records(node.enums).flatMap((entry) => list(entry.values)),
  ].map((value) => `\`${scalar(value) ?? 'null'}\``);
  return [
    phrase('min', 'minimum'),
    phrase('max', 'maximum'),
    phrase('min length', 'minLength'),
    phrase('max length', 'maxLength'),
    phrase('min items', 'minItems'),
    phrase('max items', 'maxItems'),
    phrase('format', 'format'),
    str(node.pattern) === undefined ? undefined : `pattern \`${str(node.pattern) ?? ''}\``,
    allowed.length === 0 ? undefined : `one of ${[...new Set(allowed)].join(', ')}`,
  ].filter((part) => part !== undefined);
}

/** A value as it would be written in a request: strings bare, everything else as JSON. */
function exampleText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.map((item) => scalar(item) ?? '').join(',');
  return scalar(value);
}

/** Reads a page-data parameter or property (recursively for nested `properties`). */
export function pageDataProperty(node: Json): OaProperty {
  const description = str(node.description) ?? str(node.shortDescription);
  const fallback = scalar(node.default);
  const example = exampleText(node.example);
  const type = str(node.type);
  const displayType = str(node.displayType);
  return {
    name: str(node.name) ?? '',
    ...(description === undefined ? {} : { description }),
    ...(typeof node.required === 'boolean' ? { required: node.required } : {}),
    ...(type === undefined ? {} : { type }),
    ...(displayType === undefined ? {} : { displayType }),
    ...(fallback === undefined ? {} : { default: fallback }),
    ...(example === undefined ? {} : { example }),
    constraints: constraintsOf(node),
    properties: records(node.properties).map(pageDataProperty),
  };
}

function pageDataResponse(node: Json): OaResponse {
  const meaning = asRecord(node.meaning);
  const phrase = str(meaning.phrase);
  const description = str(node.description);
  const contentType = str(node.contentType);
  const displayType = str(node.displayType);
  return {
    status: scalar(node.status) ?? scalar(meaning.code) ?? 'default',
    ...(phrase === undefined ? {} : { phrase }),
    ...(description === undefined ? {} : { description }),
    ...(contentType === undefined ? {} : { contentType }),
    ...(displayType === undefined ? {} : { displayType }),
    properties: records(node.properties).map(pageDataProperty),
    examples: list(node.examples).flatMap((example) => {
      const content = typeof example === 'string' ? example : str(asRecord(example).content);
      return content === undefined ? [] : [content];
    }),
  };
}

/** Reads `openApiOperationPage.operation` of Gatsby page data. */
export function pageDataOperation(node: Json): OaOperation {
  const operationId = str(node.operationId);
  const endpoint = str(node.endpoint);
  const summary = str(node.summary);
  const description = str(node.description);
  return {
    method: (str(node.method) ?? 'get').toUpperCase(),
    path: str(node.path) ?? '',
    ...(operationId === undefined ? {} : { operationId }),
    ...(endpoint === undefined ? {} : { endpoint }),
    ...(summary === undefined ? {} : { summary }),
    ...(description === undefined ? {} : { description }),
    ...(node.deprecated === true ? { deprecated: true } : {}),
    pathParameters: records(node.pathParameters).map(pageDataProperty),
    queryParameters: records(node.queryParameters).map(pageDataProperty),
    headerParameters: records(node.headerParameters).map(pageDataProperty),
    bodyParameters: records(node.bodyParameters).map(pageDataProperty),
    examples: records(node.examples).flatMap((example) => {
      const content = str(example.content);
      return content === undefined ? [] : [{ language: str(example.language) ?? '', content }];
    }),
    responses: records(node.responses).map(pageDataResponse),
  };
}

/** Reads one entry of `openApiSchemasPage.schemas` of Gatsby page data. */
export function pageDataSchema(node: Json): OaSchema {
  const type = str(node.type);
  const description = str(node.description);
  const example = typeof node.example === 'string' ? node.example : undefined;
  return {
    name: str(node.name) ?? '',
    ...(type === undefined ? {} : { type }),
    ...(description === undefined ? {} : { description }),
    ...(example === undefined || example.trim() === '' ? {} : { example }),
    constraints: constraintsOf(node),
    properties: records(node.properties).map(pageDataProperty),
  };
}
