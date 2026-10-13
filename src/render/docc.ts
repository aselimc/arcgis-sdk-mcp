/**
 * DocC render JSON (`/data/documentation/<module>/<path>.json`, schema 0.3) to a page:
 * declaration, parameters, discussion, topic sections, relationships and see-also lists.
 */
import type { RenderMeta, RenderOptions, RendererInputs } from '../core/ports.js';
import type { DocPage, MemberEntry } from '../core/types.js';
import {
  content,
  fragmentsText,
  inline,
  referenceLink,
  referenceUrl,
  type DoccContext,
} from './docc-content.js';
import { asRecord, isRecord, list, records, str, strings, type Json } from './json.js';
import { blocks, bullets, fence, inlineCode, oneLine } from './md.js';
import { buildSections, finishPage, invalidInput, type Block } from './page.js';

/** `https://host/swift/api-reference` from the public URL of any page below it. */
function baseUrlOf(url: string): string {
  const cut = /^(.*?)\/(?:documentation|tutorials)\//.exec(url.replace(/#.*$/, ''));
  if (cut?.[1] !== undefined) return cut[1];
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

function platforms(metadata: Json): string | undefined {
  const names = records(metadata.platforms).flatMap((platform) => {
    const name = str(platform.name);
    if (name === undefined || platform.unavailable === true) return [];
    const marks = [
      platform.beta === true ? 'beta' : undefined,
      platform.deprecated === true ? 'deprecated' : undefined,
    ].filter((mark) => mark !== undefined);
    const version = str(platform.introducedAt);
    return [
      `${name}${version === undefined ? '' : ` ${version}+`}${marks.length > 0 ? ` (${marks.join(', ')})` : ''}`,
    ];
  });
  return names.length === 0 ? undefined : names.join(', ');
}

function declarations(section: Json): string {
  return blocks(
    ...records(section.declarations).map((declaration) =>
      fence(fragmentsText(declaration.tokens), strings(declaration.languages)[0] ?? 'swift'),
    ),
  );
}

/** One line per referenced page: its declaration fragments, linked, and its abstract. */
function topicLine(identifier: string, context: DoccContext, withAbstract: boolean): string {
  const reference = asRecord(context.references[identifier]);
  const fragments = fragmentsText(reference.fragments);
  const link = referenceLink(
    identifier,
    context,
    fragments === '' ? undefined : oneLine(fragments),
  );
  const abstract = withAbstract ? inline(reference.abstract, context) : '';
  return abstract === '' ? link : `${link}: ${abstract}`;
}

/** A group of titled reference lists (`topicSections`, `seeAlsoSections`, relationships). */
function referenceGroups(
  title: string,
  sections: unknown,
  context: DoccContext,
  withAbstract: boolean,
): Block[] {
  const groups = records(sections).flatMap((section): Block[] => {
    const lines = strings(section.identifiers).map((identifier) =>
      topicLine(identifier, context, withAbstract),
    );
    if (lines.length === 0) return [];
    return [{ level: 3, title: str(section.title) ?? title, body: bullets(lines) }];
  });
  return groups.length === 0 ? [] : [{ level: 2, title, body: '' }, ...groups];
}

/** `Instance Methods` to `instance method`. */
function singular(title: string): string {
  return title.toLowerCase().replace(/ies$/, 'y').replace(/s$/, '');
}

/** The pages listed under Topics are the symbol's members; each is documented on its own page. */
function membersOf(json: Json, context: DoccContext): MemberEntry[] {
  return records(json.topicSections).flatMap((section) =>
    strings(section.identifiers).flatMap((identifier): MemberEntry[] => {
      const reference = asRecord(context.references[identifier]);
      const name = str(reference.title);
      if (name === undefined) return [];
      const signature = oneLine(fragmentsText(reference.fragments));
      const summary = oneLine(inline(reference.abstract, context));
      const url = referenceUrl(reference, context);
      return [
        {
          id: url?.split('/').at(-1) ?? name,
          name,
          kind: singular(str(section.title) ?? 'member'),
          ...(signature === '' ? {} : { signature }),
          ...(summary === '' ? {} : { summary }),
          ...(reference.deprecated === true ? { deprecated: true } : {}),
        },
      ];
    }),
  );
}

/** Sections of `primaryContentSections` other than the declaration. */
function primaryBody(json: Json, context: DoccContext, includeContent: boolean): string {
  return blocks(
    ...records(json.primaryContentSections).map((section): string | undefined => {
      switch (section.kind) {
        case 'declarations':
          return undefined;
        case 'parameters':
          return blocks(
            '## Parameters',
            bullets(
              records(section.parameters).map(
                (parameter) =>
                  `${inlineCode(str(parameter.name) ?? '')}: ${content(parameter.content, context)}`,
              ),
            ),
          );
        case 'content':
          return includeContent ? content(section.content, context) : undefined;
        default:
          context.unknown.add(`docc:section:${str(section.kind) ?? 'unknown'}`);
          return includeContent ? content(section.content, context) : undefined;
      }
    }),
  );
}

/**
 * Renders one DocC page. Each symbol is its own JSON file, so the page is the symbol; its
 * members are the pages linked under Topics and are listed, not embedded.
 *
 * Detail `signature` gives the declaration and abstract, `summary` adds parameters and the
 * topic index, `full` adds the discussion, relationships and see-also lists. Unknown node
 * types are rendered as plain text and named in `diagnostics.unknownIslands`.
 *
 * @throws McpDocError `DOC_NOT_FOUND` when the input is not DocC render JSON.
 */
export function renderDocc(
  input: RendererInputs['docc'],
  meta: RenderMeta,
  opts?: RenderOptions,
): DocPage {
  const json = input.json;
  const metadata = isRecord(json) ? asRecord(json.metadata) : {};
  const title = str(metadata.title);
  if (!isRecord(json) || title === undefined) {
    throw invalidInput('docc', meta, 'the document has no DocC metadata');
  }
  const context: DoccContext = {
    references: asRecord(json.references),
    baseUrl: baseUrlOf(meta.url),
    unknown: new Set(),
  };
  const detail = opts?.detail ?? 'full';
  const full = detail === 'full';
  const modules = records(metadata.modules).flatMap((module) => str(module.name) ?? []);
  const header = [str(metadata.roleHeading), ...modules, platforms(metadata)]
    .filter((part) => part !== undefined)
    .map((part, index) => (index === 0 ? `_${part}_` : part))
    .join(' · ');
  const declaration = blocks(
    ...records(json.primaryContentSections)
      .filter((section) => section.kind === 'declarations')
      .map(declarations),
  );
  const deprecated =
    list(json.deprecationSummary).length > 0
      ? `> **Deprecated:** ${content(json.deprecationSummary, context)}`
      : undefined;

  const sectionBlocks: Block[] = [
    {
      level: 1,
      title,
      body: blocks(
        inline(json.abstract, context),
        deprecated,
        declaration,
        detail === 'signature' ? undefined : primaryBody(json, context, full),
      ),
    },
    ...(detail === 'signature' ? [] : referenceGroups('Topics', json.topicSections, context, full)),
    ...(full ? referenceGroups('Relationships', json.relationshipsSections, context, false) : []),
    ...(full ? referenceGroups('See Also', json.seeAlsoSections, context, false) : []),
  ];
  const members = membersOf(json, context);
  const unknown = [...context.unknown];
  return finishPage(
    'docc',
    meta,
    {
      title,
      ...(header === '' ? {} : { header }),
      sections: buildSections(sectionBlocks),
      ...(members.length === 0 ? {} : { members }),
      unknown,
      ...(unknown.length === 0
        ? {}
        : {
            notices: [
              `Some DocC content types are shown as plain text: ${unknown.map((u) => u.replace(/^docc:/, '')).join(', ')}.`,
            ],
          }),
    },
    opts,
  );
}
