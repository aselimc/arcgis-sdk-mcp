/**
 * `npm-cem`: web components documented by the Custom Elements Manifest that Esri's component
 * packages ship (`dist/docs/api.json`, schema 2.1.0 with Esri extensions; `js-web.md`
 * section 2.2). One component is one page; its properties, methods and events are members.
 */
import { defaultSymbolRead } from '../../../core/adapter-helpers.js';
import { formatCall } from '../../../core/budget.js';
import type { McpDocError } from '../../../core/errors.js';
import { BREADCRUMB_SEPARATOR, TOOLS } from '../../../core/names.js';
import type { BoundSource, Ctx, ReadTarget, SourceAdapter } from '../../../core/ports.js';
import type { CatalogRecord, DocPage } from '../../../core/types.js';
import { loadPackageJson, packageMeta } from './package-file.js';
import { resolvePackageVersion, versionNotice } from './resolve-version.js';
import {
  baseRecord,
  docTemplate,
  fillTemplate,
  isRecord,
  matchTemplate,
  notFound,
  probeDeclared,
  records,
  renderOptionsOf,
  selectorOf,
  shapeError,
  str,
  summaryOf,
  tolerate,
  type Json,
} from './shared.js';

type Src = BoundSource<'npm-cem'>;

/** One custom element of a manifest. */
interface Component {
  tag: string;
  declaration: Json;
}

/** `@arcgis/map-components` to `map-components`: the `{pkg}` segment of a documentation URL. */
function shortPackage(name: string): string {
  return name.replace(/^@[^/]+\//, '');
}

/** `calcite-button` to `button`: the `{tagShort}` segment of a documentation URL. */
function shortTag(tag: string): string {
  return tag.replace(/^[^-]+-/, '');
}

function hasTag(entry: Json, name: string): boolean {
  return records(entry.docsTags).some((tag) => tag.name === name);
}

function isDeprecated(entry: Json): boolean {
  return (entry.deprecated !== undefined && entry.deprecated !== false) || hasTag(entry, 'deprecated');
}

/**
 * The custom elements a manifest declares.
 *
 * @throws McpDocError `UPSTREAM_UNAVAILABLE` (not retryable) when the file has no `modules`
 *   array, which is what a format change looks like; a manifest without components is `[]`.
 */
function componentsOf(manifest: unknown, url: string): Component[] {
  if (!isRecord(manifest) || !Array.isArray(manifest.modules)) {
    throw shapeError(url, 'a Custom Elements Manifest');
  }
  return records(manifest.modules)
    .flatMap((module) => records(module.declarations))
    .flatMap((declaration) => {
      const tag = str(declaration.tagName);
      return tag === undefined || declaration.customElement !== true ? [] : [{ tag, declaration }];
    });
}

/** The documentation page of a component. */
function pageUrl(template: string, packageName: string, tag: string): string {
  return fillTemplate(template, { pkg: shortPackage(packageName), tag, tagShort: shortTag(tag) });
}

/**
 * The records of one component: the component itself, then its public properties, methods
 * and events. A member's anchor is the id the `cem` renderer gives its section (events carry
 * the `event-` prefix of the published pages). Methods every component gets from the
 * runtime (marked as inherited from `this`) are left out: they would add one identical
 * record per component.
 */
function componentRecords(
  src: Src,
  template: string,
  packageName: string,
  { tag, declaration }: Component,
): CatalogRecord[] {
  const ref = pageUrl(template, packageName, tag);
  const locator = { package: packageName, tag };
  const described = (entry: Json): Partial<CatalogRecord> => {
    const description = summaryOf(entry.description);
    return {
      ...(description === undefined ? {} : { description }),
      ...(isDeprecated(entry) ? { deprecated: true } : {}),
    };
  };
  const className = str(declaration.name);
  const component: CatalogRecord = {
    ...baseRecord(src, ref, tag),
    symbol: tag,
    qualified: tag,
    symbolKind: 'component',
    breadcrumb: packageName,
    keywords: className === undefined ? [packageName] : [className, packageName],
    locator,
    ...described(declaration),
  };
  const member = (entry: Json, kind: string, anchor: (name: string) => string): CatalogRecord[] => {
    const name = str(entry.name);
    if (name === undefined) return [];
    return [
      {
        ...baseRecord(src, `${ref}#${anchor(name)}`, name),
        symbol: name,
        qualified: `${tag}.${name}`,
        symbolKind: kind,
        parent: tag,
        breadcrumb: [packageName, tag].join(BREADCRUMB_SEPARATOR),
        locator,
        ...described(entry),
      },
    ];
  };
  const own = records(declaration.members).filter(
    (entry) =>
      entry.privacy !== 'private' &&
      entry.privacy !== 'protected' &&
      !(isRecord(entry.inheritedFrom) && entry.inheritedFrom.name === 'this'),
  );
  return [
    component,
    ...own.flatMap((entry) =>
      entry.kind === 'field'
        ? member(entry, 'property', (name) => name)
        : entry.kind === 'method'
          ? member(entry, 'method', (name) => name)
          : [],
    ),
    ...records(declaration.events).flatMap((entry) =>
      member(entry, 'event', (name) => `event-${name}`),
    ),
  ];
}

async function packageRecords(ctx: Ctx, src: Src, packageName: string): Promise<CatalogRecord[]> {
  const { config } = src.source;
  const pkg = await resolvePackageVersion(ctx, src, packageName);
  const file = await loadPackageJson(ctx, src, pkg, config.file);
  const template = docTemplate(src, config.docUrl);
  return (
    componentsOf(file.data, file.url)
      // Components tagged `@internal` have no documentation page.
      .filter((component) => !hasTag(component.declaration, 'internal'))
      .flatMap((component) => componentRecords(src, template, packageName, component))
  );
}

/**
 * Lists the components of every configured package. Packages are independent, so one that
 * cannot be read costs its own records only; the failure is rethrown when no package could
 * be read at all.
 */
async function enumerate(ctx: Ctx, src: Src): Promise<CatalogRecord[]> {
  const failures: McpDocError[] = [];
  const perPackage = await Promise.all(
    src.source.config.packages.map(async (packageName) => {
      try {
        return await packageRecords(ctx, src, packageName);
      } catch (error) {
        failures.push(tolerate(ctx, src, error, `The component manifest of ${packageName}`));
        return undefined;
      }
    }),
  );
  const [firstFailure] = failures;
  if (firstFailure !== undefined && perPackage.every((list) => list === undefined)) {
    throw firstFailure;
  }
  const byRef = new Map<string, CatalogRecord>();
  for (const record of perPackage.flatMap((list) => list ?? [])) {
    if (!byRef.has(record.ref)) byRef.set(record.ref, record);
  }
  return [...byRef.values()];
}

/** What a read names: a tag (possibly in its short form) and the packages it may be in. */
interface Address {
  packages: string[];
  matches: (tag: string) => boolean;
  wanted: string;
}

function addressOf(src: Src, target: ReadTarget): Address | undefined {
  const { config } = src.source;
  const locator = target.record?.locator;
  if (locator?.tag !== undefined) {
    const { tag } = locator;
    return {
      packages: locator.package === undefined ? config.packages : [locator.package],
      matches: (candidate) => candidate === tag,
      wanted: tag,
    };
  }
  const values = matchTemplate(docTemplate(src, config.docUrl), target.url.href);
  const wanted = values?.tag ?? values?.tagShort;
  if (values === undefined || wanted === undefined) return undefined;
  const packages =
    values.pkg === undefined
      ? config.packages
      : config.packages.filter((name) => shortPackage(name) === values.pkg);
  return {
    packages,
    matches:
      values.tag === undefined
        ? (candidate) => candidate === wanted || shortTag(candidate) === wanted
        : (candidate) => candidate === wanted,
    wanted,
  };
}

async function read(ctx: Ctx, src: Src, target: ReadTarget): Promise<DocPage> {
  const { config } = src.source;
  const template = docTemplate(src, config.docUrl);
  const address = addressOf(src, target);
  for (const packageName of address?.packages ?? []) {
    const pkg = await resolvePackageVersion(ctx, src, packageName);
    const file = await loadPackageJson(ctx, src, pkg, config.file);
    const component = componentsOf(file.data, file.url).find(({ tag }) => address?.matches(tag));
    if (component === undefined) continue;
    const member = selectorOf(target)?.member;
    const page = ctx.render.render(
      'cem',
      {
        manifest: file.data,
        tag: component.tag,
        packageName,
        ...(member === undefined ? {} : { member }),
      },
      packageMeta(
        src,
        pkg,
        file,
        `${pageUrl(template, packageName, component.tag)}${target.url.hash}`,
      ),
      renderOptionsOf(target),
    );
    const notice = versionNotice(pkg);
    return notice === undefined ? page : { ...page, notices: [...page.notices, notice] };
  }
  const wanted = address?.wanted ?? target.url.href;
  throw notFound(
    target.url.href,
    `No component "${wanted}" in ${config.packages.join(', ')}`,
    address === undefined
      ? `Component pages of this source have URLs of the form ${template}`
      : 'The Custom Elements Manifest declares no element with that tag',
    formatCall(TOOLS.search, { query: wanted, product: src.product.id }),
  );
}

/**
 * The `npm-cem` adapter. `enumerate` costs one version lookup and one manifest per package;
 * `read` the same for the one package that holds the component.
 */
export const npmCemAdapter: SourceAdapter<'npm-cem'> = {
  type: 'npm-cem',
  // Two requests per package (version, manifest), with room for eight packages.
  maxEnumerateRequests: 16,
  enumerate,
  /** A component page of one of the configured packages; the registry's prefix match is wider. */
  owns(url, src) {
    return addressOf(src, { url })?.packages.length !== 0 && addressOf(src, { url }) !== undefined;
  },
  read,
  symbol: defaultSymbolRead({ read }),
  probe: probeDeclared,
};
