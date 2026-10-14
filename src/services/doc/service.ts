/**
 * The document service: routes a ref to its reader, walks the content ladder of design
 * section 6.6 when the upstream fails, resolves the requested section, applies the view and
 * the token budget, and issues the cursor that continues a truncated read.
 */
import { formatCall } from '../../core/budget.js';
import { decodeCursor } from '../../core/cursor.js';
import { isMcpDocError, McpDocError } from '../../core/errors.js';
import { TOOLS } from '../../core/names.js';
import type {
  AdapterRegistry,
  CallOptions,
  Ctx,
  DocService,
  ReadRequest,
  ReadResponse,
  SectionSelector,
} from '../../core/ports.js';
import { outlineOf } from '../../core/sections.js';
import type { DocPage, DocSection } from '../../core/types.js';
import { parseGithubUrl } from '../../core/url.js';
import type { IndexInternals } from '../index/types.js';
import { SOURCE_SECTION_ID } from './display.js';
import { chunkFences, pagedSections, readCursor, readKey, readValidator } from './paging.js';
import { createPageReader } from './reader.js';
import { normalizeRef, routeRef, type Route } from './router.js';
import { isPseudoSection, resolveSection } from './section-resolve.js';
import { sourceFilesSection } from './source-files.js';
import { renderView } from './view.js';

/** Outline ids listed by `SECTION_NOT_FOUND`. */
const MAX_SECTION_CANDIDATES = 30;

/** Notice added when a tutorial is read with focused code. */
const FOCUSED_CODE_NOTICE =
  'Code blocks show only the lines each step adds; read with view "full" for complete listings.';

/** The description file of a folder in a repository. */
const README = /\/readme\.(?:md|markdown|mdx)$/i;

/** A ref that is a branch by its spelling: no digits, so neither a release tag nor a commit. */
const BRANCH_NAME = /^[A-Za-z][A-Za-z/_-]*$/;

/**
 * The version to state for a sample that was read from a branch. The page would otherwise be
 * labelled with the version the product's documentation describes, which a moving branch
 * may be ahead of.
 */
function branchVersion(page: DocPage): string | undefined {
  if (page.kind !== 'sample' || page.version !== undefined) return undefined;
  const ref = parseGithubUrl(page.url)?.ref;
  return ref !== undefined && BRANCH_NAME.test(ref) ? `${ref} (branch, not a release)` : undefined;
}

/** Creates the document service. */
export function createDocService(
  ctx: Ctx,
  adapters: AdapterRegistry,
  index: IndexInternals,
): DocService {
  const reader = createPageReader(ctx, adapters, index);

  /** Reads a page, records it in the body index, and labels stale content. */
  const load = async (
    route: Route,
    call: CallOptions,
    options: { select?: SectionSelector | undefined; focusedCode?: boolean },
  ): Promise<DocPage> => {
    const focused =
      options.focusedCode === true &&
      route.kind === 'owned' &&
      route.source.adapter === 'astro' &&
      route.url.pathname.includes('/tutorials/');
    let page = await reader.read(route, call, {
      ...(options.select === undefined ? {} : { select: options.select }),
      ...(focused ? { focusedCode: true } : {}),
    });
    if (page.cache === 'stale' && page.degraded === undefined) {
      page = {
        ...page,
        degraded: {
          level: 'stale',
          reason: 'served from an expired cached copy after an upstream failure',
        },
      };
    }
    if (focused && !page.notices.includes(FOCUSED_CODE_NOTICE)) {
      page = { ...page, notices: [...page.notices, FOCUSED_CODE_NOTICE] };
    }
    const version = branchVersion(page);
    if (version !== undefined) page = { ...page, version };
    index.addBody(page);
    await index.flush();
    return page;
  };

  const sectionNotFound = (
    ref: string,
    wanted: string,
    sections: readonly DocSection[],
  ): McpDocError =>
    new McpDocError('SECTION_NOT_FOUND', `No section "${wanted}" in this document`, {
      why:
        wanted.toLowerCase() === 'source'
          ? 'This page holds no code: it has no source files, no code section and no code blocks'
          : 'The name matched no section id, heading, member or pseudo-section',
      candidates: sections.map((section) => section.id).slice(0, MAX_SECTION_CANDIDATES),
      next: formatCall(TOOLS.read, { ref, view: 'outline' }),
    });

  return {
    page: (ref, call, select) =>
      load(routeRef(ctx, adapters, normalizeRef(ref), call.budget), call, { select }),

    async read(req: ReadRequest, call: CallOptions): Promise<ReadResponse> {
      const ref = normalizeRef(req.ref);
      const route = routeRef(ctx, adapters, ref, call.budget);
      const { fragment } = route;
      const explicit = req.section?.trim() === '' ? undefined : req.section?.trim();
      const wanted = explicit ?? fragment;
      // A pseudo-section is assembled here; anything else lets the adapter slice a heavy page.
      const select =
        wanted === undefined || isPseudoSection(wanted)
          ? undefined
          : { section: wanted, member: wanted };
      const page = await load(route, call, { select, focusedCode: req.view !== 'full' });

      const all = pagedSections(page, 'all');
      // The ref a follow-up call passes together with a `section`. The fragment of an HTML
      // page is an anchor inside it and gives way to that section. In structured sources a
      // fragment can address the document itself (an operation of an API description, a
      // member of a documentation file): unless it names a part of the page that was read,
      // it stays, or the follow-up would read another document.
      const anchor = fragment === undefined ? undefined : resolveSection(page, all, fragment);
      const inPage =
        page.diagnostics.family !== 'structured' ||
        (anchor !== undefined && anchor.id !== all[0]?.id);
      const followUpRef = inPage ? ref.replace(/#.*$/, '') : ref;
      let shown: DocSection[] =
        req.view === 'auto' && req.cursor === undefined ? pagedSections(page, 'default') : all;
      let selected: string | undefined;
      if (wanted !== undefined && page.degraded?.level !== 'link-only') {
        const source = explicit?.toLowerCase() === 'source';
        // "source" next to a fragment is the code of that part: one snippet of a snippets file.
        const within =
          source && anchor !== undefined && anchor.id !== all[0]?.id && !page.files?.length
            ? anchor.sections
            : all;
        const resolved = resolveSection(page, within, wanted);
        // A README describes a sample; the code is in the files next to it. Those are listed
        // when the README has no code at all, and after the commands it quotes (`npx serve`)
        // when the only code it has is the code blocks scattered through its text.
        const scattered =
          resolved?.id === SOURCE_SECTION_ID && !page.files?.length && within === all;
        const listed =
          source && (resolved === undefined || (scattered && README.test(page.url)))
            ? await sourceFilesSection(ctx, page, call)
            : undefined;
        if (resolved !== undefined || listed !== undefined) {
          shown = [
            ...chunkFences(resolved?.sections ?? []),
            ...(listed === undefined ? [] : [listed]),
          ];
          selected = wanted;
        } else if (explicit !== undefined) {
          throw sectionNotFound(followUpRef, explicit, all);
        }
        // A fragment that names nothing (a tab or UI anchor) reads the whole page.
      }

      const continuation = {
        ref,
        ...(explicit === undefined ? {} : { section: explicit }),
      };
      let offset = 0;
      if (req.cursor !== undefined) {
        // An unselected read pages over the default view (a sample's main file) or over
        // everything; the cursor's validator tells which list it was issued for.
        const lists = selected === undefined ? [all, pagedSections(page, 'default')] : [shown];
        let failure: unknown;
        let matched = false;
        for (const list of lists) {
          try {
            offset = decodeCursor(req.cursor, TOOLS.read, {
              k: readKey(page.ref, selected),
              e: readValidator(list),
            }).o;
            shown = list;
            matched = true;
            break;
          } catch (error) {
            failure ??= error;
          }
        }
        if (!matched) {
          if (!isMcpDocError(failure)) throw failure;
          throw new McpDocError(failure.code, failure.message, {
            ...failure.details,
            next: formatCall(TOOLS.read, { ...continuation, view: req.view }),
          });
        }
      }

      const view = renderView({
        page,
        shown,
        view: req.cursor === undefined ? req.view : 'full',
        maxTokens: req.maxTokens,
        offset,
        selected: selected !== undefined,
        ...(req.callerMaxTokens === undefined ? {} : { outlineTokens: req.callerMaxTokens }),
      });

      const response: ReadResponse = {
        page,
        text: view.text,
        outline: outlineOf(all),
        truncated: view.truncated,
      };
      if (view.nextOffset !== undefined) {
        response.nextCursor = readCursor(page.ref, selected, shown, view.nextOffset);
        response.next = formatCall(TOOLS.read, {
          ...continuation,
          view: 'full',
          ...(req.callerMaxTokens === undefined ? {} : { max_tokens: req.callerMaxTokens }),
          cursor: response.nextCursor,
        });
      } else if (view.suggest !== undefined) {
        response.next = formatCall(TOOLS.read, { ref: followUpRef, section: view.suggest });
      }
      return response;
    },
  };
}
