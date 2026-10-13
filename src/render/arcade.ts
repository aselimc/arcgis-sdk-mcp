/**
 * ArcGIS Arcade reference data to pages. The function reference and the profile list ship as
 * JSON inside `@arcgis/coding-components` (`arcade-api.t9n.en.json`,
 * `arcade-profiles.t9n.en.json`); their descriptions and examples are Markdown already.
 */
import type { RenderMeta, RenderOptions, RendererInputs } from '../core/ports.js';
import type { DocPage, MemberEntry, SymbolDetail } from '../core/types.js';
import { isRecord, list, records, str, strings, type Json } from './json.js';
import { blocks, bullets, decodeEntities, fence, firstSentence, inlineCode, table } from './md.js';
import { buildSections, finishPage, invalidInput, selectSections, type Block } from './page.js';

interface Entry {
  id: string;
  name: string;
  kind: string;
  signature?: string;
  summary: string;
  block: Block;
}

/** The anchor of an item on the published page, taken from its `link`. */
function anchorOf(item: Json, fallback: string): string {
  return /#([^#]+)$/.exec(str(item.link) ?? '')?.[1] ?? fallback.toLowerCase();
}

/**
 * The parameter and return-value part of the editor documentation. The text before it
 * repeats the version line and the description, which the item states in fields of its own.
 */
function usage(documentation: string | undefined): string | undefined {
  if (documentation === undefined) return undefined;
  const start = documentation.search(/\*\*(?:Parameters?|Return value)\*\*/);
  return start === -1 ? undefined : decodeEntities(documentation.slice(start)).trim();
}

function itemEntry(item: Json, level: number, detail: SymbolDetail): Entry | undefined {
  const completion = isRecord(item.completion) ? item.completion : {};
  const name = str(completion.label) ?? str(item.name);
  if (name === undefined) return undefined;
  const signature = str(completion.detail);
  const description = str(item.description) ?? '';
  const facts = [
    str(item.type),
    str(item.bundle) === undefined ? undefined : `bundle ${inlineCode(str(item.bundle) ?? '')}`,
    str(item.sinceVersion) === undefined ? undefined : `since ${str(item.sinceVersion) ?? ''}`,
    item.consumesCredits === true ? 'consumes credits' : undefined,
  ].filter((fact) => fact !== undefined);
  // On a page of several functions the heading is the signature already.
  const code = signature === undefined || level > 1 ? undefined : fence(signature, 'arcade');
  const id = anchorOf(item, name);
  return {
    id,
    name,
    kind: str(item.type) ?? 'function',
    ...(signature === undefined ? {} : { signature }),
    summary: firstSentence(description),
    block: {
      id,
      level,
      // Overloads on one page share a name; the signature tells them apart.
      title: level === 1 ? name : (signature ?? name),
      body:
        detail === 'signature'
          ? blocks(code, firstSentence(description))
          : blocks(
              code,
              facts.length === 0 ? undefined : `_${facts.join(' · ')}_`,
              description,
              usage(
                str(
                  isRecord(completion.documentation) ? completion.documentation.value : undefined,
                ),
              ),
              detail === 'full' ? str(item.examples) : firstExample(str(item.examples)),
            ),
    },
  };
}

/** The examples text cut after its first code block. */
function firstExample(examples: string | undefined): string | undefined {
  if (examples === undefined) return undefined;
  const close = /^```[^\n]*\n[\s\S]*?^```[ \t]*$/m.exec(examples);
  return close === null ? examples : examples.slice(0, close.index + close[0].length);
}

function memberEntries(entries: readonly Entry[]): MemberEntry[] {
  return entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    kind: entry.kind,
    ...(entry.signature === undefined ? {} : { signature: entry.signature }),
    ...(entry.summary === '' ? {} : { summary: entry.summary }),
  }));
}

function variableLine(variable: Json): string[] {
  const nested = records(variable.properties).map(
    (property) =>
      `${inlineCode(str(property.name) ?? '')} (${str(property.type) ?? 'any'}): ${str(property.description) ?? ''}`,
  );
  return [
    inlineCode(str(variable.name) ?? ''),
    inlineCode(str(variable.type) ?? 'any'),
    blocks(str(variable.description), nested.length === 0 ? undefined : bullets(nested)).replace(
      /\n- /g,
      '<br>- ',
    ),
  ];
}

function renderProfile(profile: Json, meta: RenderMeta, opts?: RenderOptions): DocPage {
  const title = `${str(profile.name) ?? str(profile.id) ?? 'Arcade'} profile`;
  const bundles = strings(profile.bundles);
  const variables = records(profile.variables);
  const sections = buildSections([
    {
      level: 1,
      title,
      body: blocks(
        str(profile.id) === undefined
          ? undefined
          : `Profile id: ${inlineCode(str(profile.id) ?? '')}`,
        bundles.length === 0
          ? undefined
          : `**Function bundles:** ${bundles.map(inlineCode).join(', ')}`,
      ),
    },
    {
      level: 2,
      title: 'Profile variables',
      body:
        variables.length === 0
          ? 'This profile defines no profile variables.'
          : table(['Variable', 'Type', 'Description'], variables.map(variableLine)),
    },
  ]);
  const members: MemberEntry[] = variables.map((variable) => ({
    id: str(variable.name) ?? '',
    name: str(variable.name) ?? '',
    kind: 'variable',
    ...(str(variable.description) === undefined
      ? {}
      : { summary: firstSentence(str(variable.description)) }),
  }));
  return finishPage('arcade', meta, { title, sections, members }, opts);
}

/**
 * Renders Arcade reference data.
 *
 * - `profile: true`: `item` is one profile (`{ name, id, bundles, variables }`).
 * - Otherwise `item` is one function or constant, an array of overloads of one function, or
 *   a whole category (`{ id, title, items }`). Each function is a section whose id is its
 *   anchor on the published page (`count`, `array1`), so `opts.select.member` can name a
 *   function by name or anchor.
 *
 * @throws McpDocError `DOC_NOT_FOUND` when the item has none of these shapes.
 */
export function renderArcade(
  input: RendererInputs['arcade'],
  meta: RenderMeta,
  opts?: RenderOptions,
): DocPage {
  const { item } = input;
  if (input.profile === true && isRecord(item)) return renderProfile(item, meta, opts);

  const detail = opts?.detail ?? 'full';
  const category = isRecord(item) && Array.isArray(item.items) ? item : undefined;
  // A category holds single items and arrays of overloads side by side.
  const items = records(
    category === undefined ? (Array.isArray(item) ? item : [item]) : list(category.items).flat(),
  );
  const level = category === undefined && items.length === 1 ? 1 : 2;
  const entries = items.flatMap((entry) => itemEntry(entry, level, detail) ?? []);
  const [first] = entries;
  if (first === undefined) {
    throw invalidInput(
      'arcade',
      meta,
      'the item is not an Arcade function, constant, category or profile',
    );
  }
  const title = str(category?.title) ?? first.name;
  const lead: Block[] = level === 1 ? [] : [{ level: 1, title, body: '' }];
  const members = memberEntries(entries);
  const sections = buildSections([...lead, ...entries.map((entry) => entry.block)]);
  // On a category page a function is addressed case-insensitively: Arcade names are.
  const wanted = opts?.select?.member?.toLowerCase();
  const byName =
    wanted === undefined ? undefined : members.find((entry) => entry.name.toLowerCase() === wanted);
  return finishPage(
    'arcade',
    meta,
    {
      title,
      sections:
        byName === undefined ? sections : selectSections(sections, members, { member: byName.id }),
      members,
    },
    opts,
  );
}
