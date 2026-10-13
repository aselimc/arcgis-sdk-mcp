/**
 * The `openapi` adapter: published OpenAPI 3.x and Swagger 2 documents (ArcGIS Hub, Site
 * Scan). A document is either served as JSON or embedded in a Swagger UI start-up script
 * (`"swaggerDoc": { ... }` inside `swagger-ui-init.js`).
 *
 * Refs: the document URL is the API overview; `<url>#<operationId>` is one operation (a slug
 * of the summary when the document has no operation ids); `<url>#/components/schemas/<Name>`
 * (`#/definitions/<Name>` in Swagger 2) is one schema.
 */
import { McpDocError, toMcpDocError } from '../../core/errors.js';
import { BREADCRUMB_SEPARATOR } from '../../core/names.js';
import type {
  BoundSource,
  Ctx,
  HttpResponse,
  RendererInputs,
  SourceAdapter,
} from '../../core/ports.js';
import type { CatalogRecord } from '../../core/types.js';
import { slugify } from '../../core/url.js';
import {
  absoluteUrl,
  assertLive,
  budgetOf,
  tolerate,
  licenseOf,
  probeSource,
  recordOf,
  renderOptionsOf,
} from '../kit/index.js';

type Json = Record<string, unknown>;
type OpenApiSource = BoundSource<'openapi'>;

const MAX_ENUMERATE_REQUESTS = 8;
const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace'] as const;
const EMBEDDED_MARKER = '"swaggerDoc"';

/** One operation of a document, with the key that addresses it in a ref. */
export interface SpecOperation {
  /** `operationId`, else a slug of the summary, else of `<method> <path>`; unique in the document. */
  key: string;
  method: string;
  path: string;
  /** The operation object, with path-level parameters merged in. */
  operation: Json;
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function malformed(url: string, why: string): McpDocError {
  return new McpDocError('UPSTREAM_UNAVAILABLE', `${url} is not a readable OpenAPI document`, {
    why,
    url,
    host: new URL(url).host,
    retryable: false,
  });
}

/**
 * Cuts the OpenAPI document out of a Swagger UI start-up script: the object literal after
 * `"swaggerDoc":`, found with a brace scan that skips string contents. The script is never
 * evaluated.
 *
 * @returns the parsed document, or `undefined` when the marker or a balanced JSON object is missing.
 */
export function extractEmbeddedSpec(script: string): unknown {
  const marker = script.indexOf(EMBEDDED_MARKER);
  const start = marker < 0 ? -1 : script.indexOf('{', marker + EMBEDDED_MARKER.length);
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  for (let i = start; i < script.length; i++) {
    const char = script[i];
    if (inString) {
      if (char === '\\') i += 1;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) {
      try {
        return JSON.parse(script.slice(start, i + 1)) as unknown;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** The operations of a document in path order, each with a unique ref key. */
export function listOperations(spec: Json): SpecOperation[] {
  const operations: SpecOperation[] = [];
  const taken = new Set<string>();
  for (const [path, item] of Object.entries(isObject(spec.paths) ? spec.paths : {})) {
    if (!isObject(item)) continue;
    const shared = Array.isArray(item.parameters) ? (item.parameters as unknown[]) : [];
    for (const method of METHODS) {
      const operation = item[method];
      if (!isObject(operation)) continue;
      const own = Array.isArray(operation.parameters) ? (operation.parameters as unknown[]) : [];
      const base =
        str(operation.operationId) ?? slugify(str(operation.summary) ?? `${method} ${path}`);
      // Two operations may share a summary; the method, then a counter, keeps keys apart.
      let key = taken.has(base) ? `${base}-${method}` : base;
      for (let n = 2; taken.has(key); n++) key = `${base}-${method}-${n}`;
      taken.add(key);
      operations.push({
        key,
        method,
        path,
        operation:
          shared.length === 0 ? operation : { ...operation, parameters: [...shared, ...own] },
      });
    }
  }
  return operations;
}

/** Named schemas with the JSON-pointer prefix of their container: OpenAPI 3 components or Swagger 2 definitions. */
function schemasOf(spec: Json): { pointer: string; schemas: Json } {
  const components = isObject(spec.components) ? spec.components.schemas : undefined;
  if (isObject(components)) return { pointer: '/components/schemas/', schemas: components };
  return { pointer: '/definitions/', schemas: isObject(spec.definitions) ? spec.definitions : {} };
}

function firstLine(value: unknown): string | undefined {
  return str(value)?.split(/\r?\n/)[0]?.trim();
}

async function loadSpec(
  ctx: Ctx,
  src: OpenApiSource,
  entry: string | { url: string; embedded?: boolean },
): Promise<{ url: string; spec: Json; res: HttpResponse }> {
  const url = absoluteUrl(typeof entry === 'string' ? entry : entry.url, src);
  assertLive(src, url);
  const request = { url, ttl: 'spec' as const, ...budgetOf(src) };
  let spec: unknown;
  let res: HttpResponse;
  if (typeof entry !== 'string' && entry.embedded === true) {
    res = await ctx.http.get({ ...request, expect: 'text' });
    spec = extractEmbeddedSpec(res.text);
    if (spec === undefined) throw malformed(url, `The script holds no ${EMBEDDED_MARKER} object`);
  } else {
    ({ data: spec, res } = await ctx.http.getJson(request));
  }
  if (!isObject(spec) || !isObject(spec.paths)) {
    throw malformed(url, 'The document has no "paths" object');
  }
  return { url, spec, res };
}

function apiTitle(spec: Json, url: string): string {
  return str(isObject(spec.info) ? spec.info.title : undefined) ?? new URL(url).pathname;
}

function specRecords(src: OpenApiSource, url: string, spec: Json): CatalogRecord[] {
  const info = isObject(spec.info) ? spec.info : {};
  const title = apiTitle(spec, url);
  const version = str(info.version);
  const about = firstLine(info.description);
  const records: CatalogRecord[] = [
    {
      ...recordOf(src, url, 'api', version === undefined ? title : `${title} ${version}`),
      ...(about === undefined ? {} : { description: about }),
    },
  ];
  for (const { key, method, path, operation } of listOperations(spec)) {
    const verb = method.toUpperCase();
    const tags = (Array.isArray(operation.tags) ? operation.tags : []).filter(
      (tag): tag is string => typeof tag === 'string',
    );
    const summary = firstLine(operation.summary) ?? firstLine(operation.description);
    records.push({
      ...recordOf(src, `${url}#${encodeURIComponent(key)}`, 'api', summary ?? `${verb} ${path}`),
      symbol: key,
      qualified: path,
      symbolKind: 'operation',
      breadcrumb: [title, ...tags.slice(0, 1)].join(BREADCRUMB_SEPARATOR),
      description: `${verb} ${path}`,
      keywords: [verb, ...tags],
      locator: { spec: url, method, path },
      ...(operation.deprecated === true ? { deprecated: true } : {}),
    });
  }
  const { pointer, schemas } = schemasOf(spec);
  for (const [name, schema] of Object.entries(schemas)) {
    const summary = firstLine(isObject(schema) ? schema.description : undefined);
    records.push({
      ...recordOf(src, `${url}#${pointer}${encodeURIComponent(name)}`, 'api', name),
      symbol: name,
      qualified: name,
      symbolKind: 'type',
      breadcrumb: [title, 'Schemas'].join(BREADCRUMB_SEPARATOR),
      ...(summary === undefined ? {} : { description: summary }),
    });
  }
  return records;
}

/**
 * What to hand the `openapi` renderer for a ref fragment: the document, and as `target` the
 * operation (`METHOD path`, which every operation has, unlike an operation id) or the schema
 * the fragment names. The renderer reads both out of the document itself, so that references
 * (`$ref`), shared parameters and responses are resolved; its `operation` and `schemas`
 * inputs are for the page data of a documentation site, which has another shape.
 */
function renderInput(spec: Json, fragment: string): RendererInputs['openapi'] {
  if (fragment.startsWith('/')) {
    const name = fragment.split('/').at(-1) ?? '';
    return schemasOf(spec).schemas[name] === undefined ? { spec } : { spec, target: name };
  }
  const wanted = fragment.toLowerCase();
  const found =
    wanted === ''
      ? undefined
      : listOperations(spec).find(
          ({ key, operation }) =>
            key.toLowerCase() === wanted || slugify(str(operation.summary) ?? '') === wanted,
        );
  if (found === undefined) return { spec };
  return { spec, target: `${found.method.toUpperCase()} ${found.path}` };
}

function decoded(hash: string): string {
  try {
    return decodeURIComponent(hash.replace(/^#/, ''));
  } catch {
    return hash.replace(/^#/, '');
  }
}

/**
 * `openapi`: one request per document for the catalogue (operations and schemas as symbols),
 * the `openapi` renderer for content. A ref whose fragment names nothing in the document is
 * rendered as the document overview, so the doc service can report the missing section.
 */
export const openapiAdapter: SourceAdapter<'openapi'> = {
  type: 'openapi',
  maxEnumerateRequests: MAX_ENUMERATE_REQUESTS,

  async enumerate(ctx, src) {
    const records = new Map<string, CatalogRecord>();
    let firstFailure: McpDocError | undefined;
    for (const entry of src.source.config.specs.slice(0, MAX_ENUMERATE_REQUESTS)) {
      try {
        const { url, spec } = await loadSpec(ctx, src, entry);
        for (const record of specRecords(src, url, spec)) {
          if (!records.has(record.ref)) records.set(record.ref, record);
        }
      } catch (error) {
        firstFailure ??= toMcpDocError(error);
        const url = typeof entry === 'string' ? entry : entry.url;
        tolerate(ctx, src, error, `OpenAPI document ${url}`);
      }
    }
    if (records.size === 0 && firstFailure !== undefined) throw firstFailure;
    return [...records.values()];
  },

  async read(ctx, src, target) {
    const wanted = target.url.href.replace(/#.*$/, '');
    const entry = src.source.config.specs.find(
      (spec) => absoluteUrl(typeof spec === 'string' ? spec : spec.url, src) === wanted,
    );
    if (entry === undefined) {
      throw new McpDocError(
        'DOC_NOT_FOUND',
        `${wanted} is not an API document of ${src.product.name}`,
        {
          why: 'An OpenAPI ref is the URL of a published document, optionally with #operationId',
          candidates: src.source.config.specs.map((spec) =>
            absoluteUrl(typeof spec === 'string' ? spec : spec.url, src),
          ),
          url: wanted,
          host: target.url.host,
        },
      );
    }
    const { spec, res } = await loadSpec(ctx, src, entry);
    const version = str(isObject(spec.info) ? spec.info.version : undefined);
    return ctx.render.render(
      'openapi',
      renderInput(spec, decoded(target.url.hash)),
      {
        url: target.url.href,
        product: src.product.id,
        source: src.source.id,
        line: src.line.id,
        kind: 'api',
        license: licenseOf(src),
        res,
        ...(version === undefined ? {} : { version }),
      },
      renderOptionsOf(target),
    );
  },

  probe: (ctx, src) =>
    probeSource(ctx, src, {
      // An embedded document is fetched as text, which the default counter cannot read.
      count(body) {
        const spec = body.includes(EMBEDDED_MARKER) ? extractEmbeddedSpec(body) : undefined;
        return isObject(spec) && isObject(spec.paths) ? Object.keys(spec.paths).length : undefined;
      },
    }),
};
