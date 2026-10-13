/**
 * The document service: routes a ref to its reader, walks the content ladder of design
 * section 6.6 when the upstream fails, resolves the requested section, applies the view and
 * the token budget, and issues the cursor that continues a truncated read.
 */
import { formatCall, joinSections } from '../../core/budget.js';
import { decodeCursor, encodeCursor } from '../../core/cursor.js';
import { isMcpDocError, McpDocError } from '../../core/errors.js';
import { shortHash } from '../../core/hash.js';
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
import { splitRef } from '../../core/url.js';
import type { IndexInternals } from '../index/types.js';
import { displaySections } from './display.js';
import { createPageReader } from './reader.js';
import { routeRef } from './router.js';
import { isPseudoSection, resolveSection } from './section-resolve.js';
import { renderView } from './view.js';

/** Outline ids listed by `SECTION_NOT_FOUND`. */
const MAX_SECTION_CANDIDATES = 30;

/** Notice added when a tutorial is read with focused code. */
const FOCUSED_CODE_NOTICE =
  'Code blocks show only the lines each step adds; read with view "full" for complete listings.';

/** Creates the document service. */
export function createDocService(
  ctx: Ctx,
  adapters: AdapterRegistry,
  index: IndexInternals,
): DocService {
  const reader = createPageReader(ctx, adapters, index);

  /** Reads a page, records it in the body index, and labels stale content. */
  const load = async (
    ref: string,
    call: CallOptions,
    options: { select?: SectionSelector | undefined; focusedCode?: boolean },
  ): Promise<DocPage> => {
    const route = routeRef(ctx, adapters, ref, call.budget);
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
      why: 'The name matched no section id, heading, member or pseudo-section',
      candidates: sections.map((section) => section.id).slice(0, MAX_SECTION_CANDIDATES),
      next: formatCall(TOOLS.read, { ref, view: 'outline' }),
    });

  return {
    page: (ref, call, select) => load(ref, call, { select }),

    async read(req: ReadRequest, call: CallOptions): Promise<ReadResponse> {
      const { fragment } = splitRef(req.ref);
      const explicit = req.section?.trim() === '' ? undefined : req.section?.trim();
      const wanted = explicit ?? fragment;
      // A pseudo-section is assembled here; anything else lets the adapter slice a heavy page.
      const select =
        wanted === undefined || isPseudoSection(wanted)
          ? undefined
          : { section: wanted, member: wanted };
      const page = await load(req.ref, call, { select, focusedCode: req.view !== 'full' });

      const all = displaySections(page, 'all');
      // The ref a follow-up call passes together with a `section`. The fragment of an HTML
      // page is an anchor inside it and gives way to that section. In structured sources a
      // fragment can address the document itself (an operation of an API description, a
      // member of a documentation file): unless it names a part of the page that was read,
      // it stays, or the follow-up would read another document.
      const anchor = fragment === undefined ? undefined : resolveSection(page, all, fragment);
      const inPage =
        page.diagnostics.family !== 'structured' ||
        (anchor !== undefined && anchor.id !== all[0]?.id);
      const followUpRef = inPage ? req.ref.replace(/#.*$/, '') : req.ref;
      let shown: DocSection[] =
        req.view === 'auto' && req.cursor === undefined ? displaySections(page, 'default') : all;
      let selected: string | undefined;
      if (wanted !== undefined && page.degraded?.level !== 'link-only') {
        const resolved = resolveSection(page, all, wanted);
        if (resolved !== undefined) {
          shown = resolved.sections;
          selected = wanted;
        } else if (explicit !== undefined) {
          throw sectionNotFound(followUpRef, explicit, all);
        }
        // A fragment that names nothing (a tab or UI anchor) reads the whole page.
      }

      const continuation = {
        ref: req.ref,
        ...(explicit === undefined ? {} : { section: explicit }),
      };
      const key = shortHash(JSON.stringify([page.ref.replace(/#.*$/, ''), selected ?? '']));
      let validator = shortHash(joinSections(shown));
      let offset = 0;
      if (req.cursor !== undefined) {
        // An unselected read pages over the default view (a sample's main file) or over
        // everything; the cursor's validator tells which list it was issued for.
        const lists = selected === undefined ? [all, displaySections(page, 'default')] : [shown];
        let failure: unknown;
        let matched = false;
        for (const list of lists) {
          const expected = shortHash(joinSections(list));
          try {
            offset = decodeCursor(req.cursor, TOOLS.read, { k: key, e: expected }).o;
            shown = list;
            validator = expected;
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
      });

      const response: ReadResponse = {
        page,
        text: view.text,
        outline: outlineOf(all),
        truncated: view.truncated,
      };
      if (view.nextOffset !== undefined) {
        response.nextCursor = encodeCursor({
          v: 1,
          t: TOOLS.read,
          k: key,
          e: validator,
          o: view.nextOffset,
        });
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
