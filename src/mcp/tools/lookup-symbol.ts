/**
 * `arcgis_docs_lookup_symbol` (design section 3.6): the declaration and documentation of
 * one named API entity. Text only.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { TOOLS } from '../../core/names.js';
import type { CatalogRecord } from '../../core/types.js';
import { LARGE_RESULT_META } from '../annotations.js';
import { compact } from '../compact.js';
import type { McpContainer } from '../container.js';
import { textResult } from '../envelope.js';
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

/** The other candidates as copyable `{symbol, product}` pairs with their refs. */
function alternates(records: readonly CatalogRecord[]): string {
  if (records.length === 0) return '';
  return [
    'Other matches:',
    ...records
      .slice(0, 3)
      .map(
        (record) =>
          `- ${JSON.stringify({ symbol: displayName(record), product: record.product })}${record.symbolKind === undefined ? '' : ` (${record.symbolKind})`}: ${record.ref}`,
      ),
  ].join('\n');
}

const handle: ToolHandler<typeof Input> = async (args, call, container) => {
  const response = await container.services.symbols.lookup(
    compact({
      symbol: args.symbol,
      product: args.product,
      detail: args.detail,
      version: args.version,
      maxTokens: args.max_tokens,
    }),
    call,
  );
  const { record, page, resolvedProduct } = response;
  const { product } = resolvedProduct;
  const version = await pageVersion(page, container);
  const kind = record.symbolKind === undefined ? '' : ` (${record.symbolKind})`;
  // Echo the resolution whenever the product was not named by its id (design section 3.1).
  const echo =
    args.product === product.id
      ? `${product.name} (${product.id})`
      : `${product.name} (${product.id}), resolved from "${resolvedProduct.resolvedFrom}"`;
  return textResult({
    status: pageStatus(`${displayName(record)}${kind}`, page, echo, version),
    notes: pageNotes(page),
    body: [response.text.trim(), alternates(response.alternates)]
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
