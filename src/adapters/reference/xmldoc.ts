/**
 * The `xmldoc` adapter: C# XML documentation files kept in a GitHub repository (the ArcGIS
 * Pro SDK ships its API documentation this way). A file is both index and content: its
 * `<member name="T:Ns.Type">` ids are the symbols, and a read cuts the wanted type out of a
 * file of several megabytes before the `xmldoc` renderer sees it. A symbol's ref is the
 * file's github.com URL with the documentation id as fragment.
 */
import { formatCall } from '../../core/budget.js';
import { McpDocError, toMcpDocError } from '../../core/errors.js';
import { TOOLS } from '../../core/names.js';
import type {
  BoundSource,
  Ctx,
  GithubCallOptions,
  ReadTarget,
  SourceAdapter,
} from '../../core/ports.js';
import type { CatalogRecord, DocPage } from '../../core/types.js';
import { parseGithubUrl } from '../../core/url.js';
import { oneLine, renderMeta, renderOptionsOf, symbolRecord, tolerate } from '../kit/index.js';

/** Files read by one enumeration; the Pro SDK has 16. */
const MAX_FILES = 20;

const KINDS: Readonly<Record<string, string>> = {
  T: 'type',
  M: 'method',
  P: 'property',
  F: 'field',
  E: 'event',
};

const ENTITIES: Readonly<Record<string, string>> = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&amp;': '&',
};

function decodeXml(text: string): string {
  return text.replace(/&(?:lt|gt|quot|apos|amp);/g, (entity) => ENTITIES[entity] ?? entity);
}

/** Every `<member>` element of a documentation file with its id, in file order. */
function* memberBlocks(xml: string): Generator<{ id: string; block: string }> {
  const open = /<member\s+name="([^"]*)"\s*(\/?)>/g;
  for (let match = open.exec(xml); match !== null; match = open.exec(xml)) {
    const id = decodeXml(match[1] ?? '');
    if (match[2] === '/') {
      yield { id, block: match[0] };
      continue;
    }
    const close = xml.indexOf('</member>', open.lastIndex);
    const end = close < 0 ? xml.length : close + '</member>'.length;
    yield { id, block: xml.slice(match.index, end) };
    open.lastIndex = end;
  }
}

/** `M:Ns.Type.Method(System.String)~Ns.Result` gives `Ns.Type.Method`. */
function idPath(id: string): string {
  return id.slice(2).replace(/\(.*$/s, '').replace(/~.*$/, '');
}

/** The type a documentation id belongs to: itself for `T:`, the declaring type otherwise. */
function typeOf(id: string): string {
  const path = idPath(id);
  return id.startsWith('T:') ? path : path.slice(0, Math.max(0, path.lastIndexOf('.')));
}

/** `Dictionary`2` gives `Dictionary`; generic method arity (two backticks) goes the same way. */
function withoutArity(name: string): string {
  return name.replace(/`+\d+/g, '');
}

/**
 * The parameter list of an id as C# spells it, for a record title:
 * ``Func{``0},System.Int32`` gives `Func<T>, Int32`. Namespaces go, braces become angle
 * brackets and a generic parameter reference becomes `T` (`T1`, `T2`, ... when the list
 * refers to more than the first).
 */
function parameterList(id: string): string | undefined {
  const raw = /\((.*)\)/s.exec(id)?.[1];
  if (raw === undefined) return undefined;
  const several = /`+[1-9]/.test(raw);
  return raw
    .replace(/(?:[A-Za-z_]\w*\.)+/g, '')
    .replace(/`+(\d+)/g, (_marker, index: string) => (several ? `T${Number(index) + 1}` : 'T'))
    .replace(/\{/g, '<')
    .replace(/\}/g, '>')
    .replace(/,/g, ', ');
}

/** The first lines of a `<summary>`, with `cref` links reduced to the name they point at. */
function summaryOf(block: string): string | undefined {
  const summary = /<summary>([\s\S]*?)<\/summary>/.exec(block)?.[1];
  if (summary === undefined) return undefined;
  const text = summary
    .replace(/<see(?:also)?\s+cref="[A-Z!]:([^"(]*)[^"]*"\s*\/>/g, (_whole, target: string) =>
      withoutArity(target.split('.').at(-1) ?? target),
    )
    .replace(/<[^>]+>/g, ' ');
  return oneLine(decodeXml(text), 200);
}

/**
 * The compiler documents whatever carries a comment, public or not. Two things are certainly
 * not API: the namespace of generated XAML helpers, and a member whose name starts with an
 * underscore. (An `Internal` namespace is not a reliable sign: some are documented API.)
 */
const NOT_API = /^XamlGeneratedNamespace(?:\.|$)|\._[^.]*$/;

/**
 * Share of its search score a record keeps when it is documented but not what a caller is
 * looking for (the index floors the effect of a boost at one half). Such records stay in the
 * catalogue, because an `Internal` namespace is not a reliable sign and some of them are
 * what an add-in has to use; they only rank behind the public twin that carries the same
 * name and text, and a tie between the two can be broken in favour of the other.
 */
const SUPPORT_BOOST = 0.1;

/** `ArcGIS.Desktop.Internal.Editing.MapTool`: a type or member of an `Internal` namespace. */
const INTERNAL_NAMESPACE = /(?:^|\.)Internal\./;

/**
 * Comments the tools write, not people: the class of a `.resx` file with one property per
 * localised string, and the code-behind of a XAML file. Their text matches every search for
 * the words of a label ("insert", "button", "ribbon") without documenting anything.
 */
const GENERATED_COMMENT =
  /^(?:A strongly-typed resource class\b|Looks up a localized (?:string|resource)\b|Returns the cached ResourceManager instance\b|Overrides the current thread's CurrentUICulture\b|Interaction logic for \S+\.xaml\b|InitializeComponent\b)/i;

/** What a comment says of an entry that is public only for the product's own assemblies. */
const NOT_FOR_CALLERS =
  /\bnot (?:intended )?for public use\b|\b(?:for )?internal use only\b|\bis an internal (?:object|class|type)\b/i;

/**
 * The name of a class generated from a `.resx` file (`TableRes`, `EditingRes`,
 * `Properties.Resources`). Not every one carries the tool-written comment: the Pro SDK
 * documents some of their string properties by hand ("Second line for the ribbon tooltip
 * for the time filter table button"), which then matches a search for the words of a label
 * just as well. The name is the sign that holds.
 */
const RESOURCE_TYPE = /(?:Res|Resources)$/;

/**
 * The boost of a record, when it should rank behind the API a caller is meant to use.
 *
 * @param owner the simple name of the type the entry is, or is a member of.
 */
function boostOf(path: string, owner: string, summary: string | undefined): number | undefined {
  const support =
    INTERNAL_NAMESPACE.test(path) ||
    RESOURCE_TYPE.test(owner) ||
    (summary !== undefined && (GENERATED_COMMENT.test(summary) || NOT_FOR_CALLERS.test(summary)));
  return support ? SUPPORT_BOOST : undefined;
}

/** A member of the published API: not marked `<exclude/>` and not private by convention. */
function published(id: string, block: string): boolean {
  return !NOT_API.test(idPath(id)) && !/<exclude\s*\/?>/.test(block);
}

/**
 * Catalogue records of one documentation file: types, and their methods, properties,
 * fields and events as members. Members marked `<exclude/>` are hidden from the published
 * reference and are dropped, as are generated helpers and underscore-named members; static
 * constructors and malformed ids are skipped. Entries of `Internal` namespaces, of resource
 * classes and entries with a tool-written comment are kept with a low `boost`
 * ({@link SUPPORT_BOOST}).
 *
 * @param fileUrl the github.com blob URL of the file; a record's ref is this URL plus the id.
 */
export function xmldocRecords(src: BoundSource, fileUrl: string, xml: string): CatalogRecord[] {
  const kept = [...memberBlocks(xml)].filter(
    ({ id, block }) => /^[TMPFE]:./.test(id) && published(id, block),
  );
  const types = new Set(kept.filter(({ id }) => id.startsWith('T:')).map(({ id }) => idPath(id)));
  const records = new Map<string, CatalogRecord>();
  for (const { id, block } of kept) {
    const prefix = id.charAt(0);
    const path = idPath(id);
    const container = path.slice(0, Math.max(0, path.lastIndexOf('.')));
    const last = path.slice(path.lastIndexOf('.') + 1);
    if (last === '#cctor' || last === '') continue;
    const target = new URL(fileUrl);
    target.hash = id;
    if (records.has(target.href)) continue;

    const isType = prefix === 'T';
    const owned = container !== '' && (!isType || types.has(container));
    const parent = owned ? withoutArity(container) : undefined;
    const ownerName = parent?.split('.').at(-1) ?? '';
    const constructor = last === '#ctor';
    const symbol = constructor ? ownerName : withoutArity(last.slice(last.lastIndexOf('#') + 1));
    const parameters = parameterList(id);
    const description = summaryOf(block);
    records.set(
      target.href,
      symbolRecord(
        src,
        target.href,
        `${owned ? `${ownerName}.` : ''}${symbol}${parameters === undefined ? '' : `(${parameters})`}`,
        {
          symbol,
          qualified: owned ? `${parent ?? ''}.${symbol}` : withoutArity(path),
          symbolKind: constructor
            ? 'constructor'
            : last.startsWith('op_')
              ? 'operator'
              : KINDS[prefix],
          parent,
          breadcrumb: [parent ?? container],
          description,
          boost: boostOf(
            path,
            isType ? withoutArity(last) : withoutArity(container.split('.').at(-1) ?? ''),
            description,
          ),
          locator: { memberId: id },
        },
      ),
    );
  }
  return [...records.values()];
}

/**
 * A documentation file reduced to one type: the type's own entry, its published members and
 * those of its nested types. The renderer needs exactly these to render the type or one
 * member of it. The requested member itself is always kept.
 */
export function sliceType(xml: string, memberId: string): string {
  const type = typeOf(memberId);
  const blocks: string[] = [];
  for (const { id, block } of memberBlocks(xml)) {
    const path = idPath(id);
    if (path !== type && !path.startsWith(`${type}.`)) continue;
    if (id === memberId || published(id, block)) blocks.push(block);
  }
  const assembly = /<assembly>\s*<name>([^<]*)<\/name>/.exec(xml)?.[1]?.trim() ?? '';
  return [
    '<?xml version="1.0"?>',
    '<doc>',
    `<assembly><name>${assembly}</name></assembly>`,
    '<members>',
    ...blocks,
    '</members>',
    '</doc>',
  ].join('\n');
}

/** A release tag or commit never moves, so its files can be cached for good. */
function callOptions(src: BoundSource, ref?: string): GithubCallOptions {
  const pinned = ref !== undefined && /^(?:[0-9a-f]{40}|v?\d+\.\d+[\w.+-]*)$/.test(ref);
  return {
    ...(src.budget === undefined ? {} : { budget: src.budget }),
    ...(pinned ? { ttl: 'immutable' as const } : {}),
  };
}

async function resolveRef(ctx: Ctx, src: BoundSource<'xmldoc'>): Promise<string> {
  const { repo, ref } = src.source.config;
  return ref ?? (await ctx.github.repoMeta(repo, callOptions(src))).defaultBranch;
}

function directoryOf(src: BoundSource<'xmldoc'>): string {
  return src.source.config.dir.replace(/^\/+|\/+$/g, '');
}

/** The repository file a URL names, when it is a documentation file of this source. */
function fileOf(src: BoundSource<'xmldoc'>, url: URL): { ref: string; path: string } | undefined {
  const location = parseGithubUrl(url.href.replace(/#.*$/, ''));
  const { ref, path } = location ?? {};
  if (location?.repo.toLowerCase() !== src.source.config.repo.toLowerCase()) return undefined;
  if (ref === undefined || path === undefined || !/\.xml$/i.test(path)) return undefined;
  const directory = directoryOf(src);
  return directory === '' || path.startsWith(`${directory}/`) ? { ref, path } : undefined;
}

function blobUrl(repo: string, ref: string, path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `https://github.com/${repo}/blob/${encodeURIComponent(ref)}/${encoded}`;
}

async function listFiles(
  ctx: Ctx,
  src: BoundSource<'xmldoc'>,
): Promise<{ ref: string; paths: string[] }> {
  const ref = await resolveRef(ctx, src);
  const directory = directoryOf(src);
  const tree = await ctx.github.tree(src.source.config.repo, ref, callOptions(src));
  const paths = tree
    .map((file) => file.path)
    .filter(
      (path) => /\.xml$/i.test(path) && (directory === '' || path.startsWith(`${directory}/`)),
    )
    .sort();
  return { ref, paths };
}

/**
 * Reads one type or member. The member is named by the fragment of the URL (or, without
 * one, by a selector that is a documentation id); a bare file URL names nothing to render.
 */
async function read(ctx: Ctx, src: BoundSource<'xmldoc'>, target: ReadTarget): Promise<DocPage> {
  const bare = target.url.href.replace(/#.*$/, '');
  const file = fileOf(src, target.url);
  let memberId = target.select?.member ?? '';
  try {
    memberId = decodeURIComponent(target.url.hash.slice(1)) || memberId;
  } catch {
    memberId = target.url.hash.slice(1) || memberId;
  }
  if (file === undefined || !/^[TMPFE]:./.test(memberId)) {
    throw new McpDocError('DOC_NOT_FOUND', `${bare} does not name a documented member`, {
      why: 'An XML documentation file is read one type or member at a time, named by a #<documentation id> fragment such as #T:Namespace.Type',
      next: formatCall(TOOLS.search, { query: src.source.title, product: src.product.id }),
      url: bare,
      host: target.url.host,
    });
  }
  const { repo, docUrlHost } = src.source.config;
  const res = await ctx.github.raw(repo, file.ref, file.path, {
    ...callOptions(src, file.ref),
    maxBytes: ctx.config.limits.indexMaxBytes,
  });
  const ref = new URL(blobUrl(repo, file.ref, file.path));
  ref.hash = memberId;
  const page = ctx.render.render(
    'xmldoc',
    { xml: sliceType(res.text, memberId), memberId },
    renderMeta(src, target, ref.href, res),
    renderOptionsOf(target),
  );
  if (docUrlHost === undefined) return page;
  // Documentation XML carries prose only; return and property types are on the website.
  const note = `Declared types are not part of XML documentation; the rendered reference is on ${docUrlHost}.`;
  return { ...page, notices: [...page.notices, note] };
}

/**
 * `xmldoc`: the repository tree lists the documentation files (one API call, plus one for
 * the default branch when no ref is configured); each file is one raw download. Two sources
 * may share a repository, so the adapter claims only `.xml` files under its directory.
 * The canary lists that directory instead of requesting the registry's probe URL: what has
 * to exist is the documentation files, and `probe.minRecords` counts them.
 */
export const xmldocAdapter: SourceAdapter<'xmldoc'> = {
  type: 'xmldoc',
  maxEnumerateRequests: MAX_FILES + 2,

  owns: (url, src) => fileOf(src, url) !== undefined,

  async enumerate(ctx, src) {
    const { repo } = src.source.config;
    const { ref, paths } = await listFiles(ctx, src);
    if (paths.length > MAX_FILES) {
      ctx.logger.warn('The directory has more documentation files than one enumeration reads', {
        product: src.product.id,
        source: src.source.id,
        files: paths.length,
        read: MAX_FILES,
      });
    }
    const records: CatalogRecord[] = [];
    let firstFailure: McpDocError | undefined;
    for (const path of paths.slice(0, MAX_FILES)) {
      try {
        const res = await ctx.github.raw(repo, ref, path, {
          ...callOptions(src, ref),
          maxBytes: ctx.config.limits.indexMaxBytes,
        });
        records.push(...xmldocRecords(src, blobUrl(repo, ref, path), res.text));
      } catch (error) {
        firstFailure ??= toMcpDocError(error);
        tolerate(ctx, src, error, `The documentation file ${path}`);
      }
    }
    if (records.length > 0) return records;
    throw (
      firstFailure ??
      new McpDocError('UPSTREAM_UNAVAILABLE', `${repo} has no XML documentation to list`, {
        why: `No documented member was found in the .xml files under "${directoryOf(src)}" at ${ref}`,
        url: `https://github.com/${repo}/tree/${encodeURIComponent(ref)}`,
        host: 'github.com',
        retryable: false,
      })
    );
  },

  read,

  symbol: (ctx, src, record, detail) =>
    read(ctx, src, { url: new URL(record.ref), record, detail }),

  async probe(ctx, src) {
    const started = ctx.clock.now();
    try {
      const { paths } = await listFiles(ctx, src);
      const wanted = src.source.probe.minRecords ?? 1;
      return {
        ok: paths.length >= wanted,
        records: paths.length,
        ...(paths.length >= wanted
          ? {}
          : { error: `Expected at least ${wanted} documentation files, found ${paths.length}` }),
        ms: ctx.clock.now() - started,
      };
    } catch (thrown) {
      const typed = toMcpDocError(thrown);
      return { ok: false, error: `${typed.code}: ${typed.message}`, ms: ctx.clock.now() - started };
    }
  },
};
