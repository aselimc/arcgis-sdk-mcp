/**
 * `arcgis_docs_lookup_symbol`: the declaration and documentation of
 * one named API entity. Text only.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { formatCall } from '../../core/budget.js';
import { TOOLS } from '../../core/names.js';
import type { ProductResolution } from '../../core/ports.js';
import type { CatalogRecord } from '../../core/types.js';
import { pageKey } from '../../core/url.js';
import { LARGE_RESULT_META } from '../annotations.js';
import { compact } from '../compact.js';
import type { McpContainer } from '../container.js';
import { bodyBudget, textResult } from '../envelope.js';
import { pageNotes, pageStatus, pageVersion } from '../presenters/page.js';
import { maxTokensArg, productArg, versionArg } from '../schemas.js';
import { registerDocTool, type ToolDefinition, type ToolHandler } from '../tool.js';

const DESCRIPTION =
  'Looks up one named API entity and returns its declaration and documentation from the product\'s reference source: classes, interfaces, methods, properties, events and web components (JavaScript, .NET, Kotlin, Swift, Flutter, Qt, Java, Unity, Unreal, Python, ArcPy, Pro SDK), REST operations, Arcade functions, geoprocessing tools and their parameters, and web map / CIM spec objects. `symbol` may be simple or qualified and may include a member ("FeatureLayer.queryFeatures", "arcgis.gis.GIS.content", "arcgis-map.goTo", "arcpy.analysis.Buffer", "applyEdits"). `detail: "signature"` returns the declaration and one line; "summary" (default) adds description, parameters, returns, since/deprecated and one example, or for a type its member index; "full" returns everything within `max_tokens`. If the name is ambiguous the candidates are listed; if it is not found the nearest names are listed. Not for concepts or how-to questions: use arcgis_docs_search.';

const Input = z.object({
  symbol: z
    .string()
    .min(1)
    .max(200)
    // "." or "-" names nothing, and no follow-up search could be built from it either.
    .refine((name) => /[\p{L}\p{N}]/u.test(name), {
      error: 'Expected the name of a symbol: it has no letter or digit',
    })
    .describe(
      'Name of a class, member, component, REST operation, function, tool or spec object. Qualified names and "Type.member" are accepted.',
    ),
  product: productArg(
    'Product id, name or package. Optional when the symbol is qualified or one Esri SDK is detected in the project.',
  ),
  detail: z
    .enum(['signature', 'summary', 'full'])
    .default('summary')
    .describe('How much to return.'),
  version: versionArg(
    'Version to read where versioned reference sources exist (any npm version for JavaScript; "v200" for native SDKs).',
  ),
  max_tokens: maxTokensArg(300, 3000),
});

/** Name, texts and schema of `arcgis_docs_lookup_symbol`. */
export const lookupSymbolTool = {
  name: TOOLS.lookupSymbol,
  title: 'Look up an ArcGIS API symbol',
  description: DESCRIPTION,
  inputSchema: Input,
  meta: LARGE_RESULT_META,
} satisfies ToolDefinition<typeof Input>;

function displayName(record: CatalogRecord): string {
  return record.qualified ?? record.symbol ?? record.title;
}

/** How many other candidates are listed. */
const MAX_ALTERNATES = 3;

/**
 * Where a ref points, for comparison: its page and its fragment without regard to case.
 */
function placeKey(ref: string): string {
  const hash = ref.indexOf('#');
  const fragment = hash === -1 ? '' : ref.slice(hash + 1).toLowerCase();
  return `${pageKey(ref)}#${fragment}`;
}

/**
 * True when `candidate` is the answer under another name. Two sources of one product (the
 * website reference and the package manifest) index the same entity under different
 * qualified names but document it at the same place. An anchor identifies one entity; a
 * page without one can hold several, so there the simple names have to agree as well.
 */
function sameEntity(answer: CatalogRecord, candidate: CatalogRecord): boolean {
  if (placeKey(candidate.ref) !== placeKey(answer.ref)) return false;
  return (
    answer.ref.includes('#') ||
    (candidate.symbol ?? candidate.title) === (answer.symbol ?? answer.title)
  );
}

/** What the caller's request fixed, which every follow-up lookup has to repeat. */
interface LookupScope {
  /** True when `product` had the form `product/source`: the source is part of the request. */
  scoped: boolean;
  /** The `version` argument, when one was given. */
  version: string | undefined;
}

/**
 * The other candidates as copyable lookup arguments with their refs.
 *
 * A candidate that is the answer under another name is left out. A candidate with the name
 * of the answer itself (another declaration of that name: an overload on a page of its own,
 * the same function for another type of argument) cannot be asked for by name again, so it
 * is listed as the ref to read. The others repeat the scope of the request: without the
 * version a follow-up would silently answer from the current release, and without the
 * source it could find a namesake in another one.
 */
function alternates(
  answer: CatalogRecord,
  records: readonly CatalogRecord[],
  scope: LookupScope,
): string {
  const others = records.filter((record) => !sameEntity(answer, record));
  if (others.length === 0) return '';
  const lines = others.slice(0, MAX_ALTERNATES).map((record) => {
    const kind = record.symbolKind === undefined ? '' : ` (${record.symbolKind})`;
    const namesake =
      record.product === answer.product && displayName(record) === displayName(answer);
    if (namesake) {
      return `- another ${displayName(record)}${kind}: ${formatCall(TOOLS.read, { ref: record.ref })}`;
    }
    const call = JSON.stringify({
      symbol: displayName(record),
      product: scope.scoped ? `${record.product}/${record.source}` : record.product,
      ...(scope.version === undefined ? {} : { version: scope.version }),
    });
    return `- ${call}${kind}: ${record.ref}`;
  });
  return ['Other matches:', ...lines].join('\n');
}

/**
 * The product of the answer and, whenever it was not named by its id, how it was arrived
 * at.
 */
function productEcho(resolved: ProductResolution, asked: string | undefined): string {
  const { product, resolvedFrom } = resolved;
  const name = `${product.name} (${product.id})`;
  if (asked === product.id) return name;
  // Without a `product` argument the scope is the project's one SDK or the symbol itself.
  return asked === undefined && resolvedFrom === 'project'
    ? `${name}, detected in the project`
    : `${name}, resolved from "${resolvedFrom}"`;
}

const handle: ToolHandler<typeof Input> = async (args, call, container) => {
  const response = await container.services.symbols.lookup(
    compact({
      symbol: args.symbol,
      product: args.product,
      detail: args.detail,
      version: args.version,
      maxTokens: bodyBudget(args.max_tokens),
    }),
    call,
  );
  const { record, page, resolvedProduct } = response;
  const version = await pageVersion(page, container);
  const kind = record.symbolKind === undefined ? '' : ` (${record.symbolKind})`;
  const scope = { scoped: resolvedProduct.source !== undefined, version: args.version };
  return textResult({
    status: pageStatus(
      `${displayName(record)}${kind}`,
      page,
      productEcho(resolvedProduct, args.product),
      version,
    ),
    notes: pageNotes(page),
    body: [response.text.trim(), alternates(record, response.alternates, scope)]
      .filter((block) => block.length > 0)
      .join('\n\n'),
    next: response.next,
    attribution: { kind: 'page', line: page.attribution },
  });
};

/** Registers `arcgis_docs_lookup_symbol`. */
export function registerLookupSymbol(server: McpServer, container: McpContainer): void {
  registerDocTool(server, container, lookupSymbolTool, handle);
}
