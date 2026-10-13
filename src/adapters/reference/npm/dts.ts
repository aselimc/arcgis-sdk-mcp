/**
 * `npm-dts`: the TypeScript declaration files of an npm package as an API reference.
 *
 * Declarations exist for every version ever published, so this source answers when the
 * project uses another release than the one the website documents, and when the website
 * cannot be read (design decision 7). One module is one `.d.ts` file; the catalogue is the
 * file list of the package, and a read fetches exactly one file at a pinned version.
 */
import { defaultSymbolRead } from '../../../core/adapter-helpers.js';
import { formatCall } from '../../../core/budget.js';
import { BREADCRUMB_SEPARATOR, TOOLS } from '../../../core/names.js';
import type { BoundSource, Ctx, ReadTarget, SourceAdapter } from '../../../core/ports.js';
import type { CatalogRecord, DocPage } from '../../../core/types.js';
import { listPackageFiles } from './jsdelivr.js';
import { listLocalFiles } from './local-packages.js';
import { loadPackageText, packageMeta } from './package-file.js';
import { resolvePackageVersion, withVersionNotice } from './resolve-version.js';
import {
  baseRecord,
  docTemplate,
  fillTemplate,
  matchTemplate,
  notFound,
  probeDeclared,
  renderOptionsOf,
  selectorOf,
} from './shared.js';

type Src = BoundSource<'npm-dts'>;

const DECLARATION_SUFFIX = '.d.ts';

/**
 * Declaration files that are not part of a package's public reference: dependencies bundled
 * with it, build output shared between modules, and the component helper typings of
 * `@arcgis/core`, which have no documentation page (`js-web.md` section 2.1).
 */
const NOT_PUBLIC = /(?:^|\/)(?:node_modules|chunks|assets)\/|^applications\/Components\//;

/** A module path as it may appear in a package: no parent segments, no odd characters. */
const SAFE_MODULE_PATH = /^(?!.*(?:^|\/)\.\.?(?:\/|$))[\w@.+-]+(?:\/[\w@.+-]+)*$/;

/** `layers/FeatureLayer.d.ts` to `layers/FeatureLayer`. */
function moduleOf(file: string): string {
  return file.slice(0, -DECLARATION_SUFFIX.length);
}

function moduleRecord(src: Src, template: string, file: string): CatalogRecord {
  const module = moduleOf(file);
  const segments = module.split('/');
  const name = segments.at(-1) ?? module;
  const packageName = src.source.config.package;
  return {
    ...baseRecord(src, fillTemplate(template, { path: module }), name),
    symbol: name,
    qualified: `${packageName}/${module}`,
    // The file list does not say what a module exports. Esri's packages name a module after
    // the class it exports by default, so a capitalised name is taken for a class.
    symbolKind: /^[A-Z]/.test(name) ? 'class' : 'module',
    ...(segments.length > 1
      ? { breadcrumb: segments.slice(0, -1).join(BREADCRUMB_SEPARATOR) }
      : {}),
    keywords: [packageName],
    locator: { path: file },
  };
}

async function enumerate(ctx: Ctx, src: Src): Promise<CatalogRecord[]> {
  const { config } = src.source;
  const pkg = await resolvePackageVersion(ctx, src, config.package);
  const installed =
    pkg.local === undefined ? [] : await listLocalFiles(pkg.local, DECLARATION_SUFFIX);
  const files =
    installed.length > 0
      ? installed
      : (await listPackageFiles(ctx, src, pkg.name, pkg.version)).map((file) => file.path);
  const template = docTemplate(src, config.docUrl);
  const byRef = new Map<string, CatalogRecord>();
  for (const file of [...files].sort()) {
    if (!file.endsWith(DECLARATION_SUFFIX) || NOT_PUBLIC.test(file)) continue;
    const record = moduleRecord(src, template, file);
    if (!byRef.has(record.ref)) byRef.set(record.ref, record);
  }
  return [...byRef.values()];
}

/** The declaration file a read names: by the record that led here, else by the shape of the URL. */
function fileOf(src: Src, target: ReadTarget, template: string): string | undefined {
  const located = target.record?.locator?.path;
  const file =
    located ?? addSuffix(matchTemplate(template, target.url.href)?.path?.replace(/\/+$/, ''));
  return file !== undefined && SAFE_MODULE_PATH.test(file) ? file : undefined;
}

function addSuffix(module: string | undefined): string | undefined {
  return module === undefined || module === '' ? undefined : `${module}${DECLARATION_SUFFIX}`;
}

async function read(ctx: Ctx, src: Src, target: ReadTarget): Promise<DocPage> {
  const { config } = src.source;
  const template = docTemplate(src, config.docUrl);
  const file = fileOf(src, target, template);
  if (file === undefined) {
    throw notFound(
      target.url.href,
      `${target.url.href} is not a module of ${config.package}`,
      `Modules of this source have URLs of the form ${template}`,
      { next: formatCall(TOOLS.search, { query: config.package, product: src.product.id }) },
    );
  }
  const pkg = await resolvePackageVersion(ctx, src, config.package);
  const loaded = await loadPackageText(ctx, src, pkg, file);
  const member = selectorOf(target)?.member;
  const page = ctx.render.render(
    'dts',
    {
      source: loaded.text,
      modulePath: file,
      packageName: pkg.name,
      ...(member === undefined ? {} : { member }),
    },
    packageMeta(
      src,
      pkg,
      loaded,
      `${fillTemplate(template, { path: moduleOf(file) })}${target.url.hash}`,
    ),
    renderOptionsOf(target),
  );
  // The ref is the page of the current release; the text is the one of the version read.
  return withVersionNotice(page, pkg, ' The linked page documents the current release.');
}

/**
 * The `npm-dts` adapter. `enumerate` costs one version lookup and one file listing (nothing
 * when the package is installed); `read` one version lookup and one file. It owns no URL:
 * the pages its records point to belong to the site source, and the typings are reached by
 * record or as a declared fallback.
 */
export const npmDtsAdapter: SourceAdapter<'npm-dts'> = {
  type: 'npm-dts',
  maxEnumerateRequests: 3,
  enumerate,
  read,
  symbol: defaultSymbolRead({ read }),
  probe: probeDeclared,
};
