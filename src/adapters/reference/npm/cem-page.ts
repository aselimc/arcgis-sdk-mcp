/**
 * The published page of a component, around its API reference.
 *
 * A component page on the documentation site (`/calcite-design-system/components/shell/`)
 * has two halves: guidance written for people (Overview, Usage, Best practices, ...) and,
 * below a heading "API reference", the properties, slots and events. The manifest is the
 * better source of the second half (it is exact, versioned and needs no HTML clean-up), but
 * it has nothing of the first. A read of the page URL therefore takes the guidance from the
 * HTML page and the API reference from the manifest, so that no part of the page is out of
 * reach and nothing is said twice.
 *
 * Everything here is pure; `cem.ts` fetches the page.
 */
import { estimateTokens } from '../../../core/budget.js';
import type { DocPage, DocSection } from '../../../core/types.js';

/** The heading that opens the generated half of a component page. */
const API_REFERENCE = /^api reference$/i;

/** The first line of a section, when it is its own level-1 heading. */
const TITLE_LINE = /^\s*#\s[^\n]*\n?/;

/** A unique id for a moved section: its own, or the first free `<id>-<n>`. */
function freeId(id: string, used: Set<string>): string {
  let free = id;
  for (let n = 2; used.has(free); n++) free = `${id}-${n}`;
  used.add(free);
  return free;
}

/**
 * The manifest rendering of a component with the guidance of its published page added: the
 * page's introduction joins the lead, and the sections above "API reference" follow it, in
 * page order and with their levels. Section ids stay unique (a clash gets a counter) and
 * every moved section keeps its parent, the page's own lead being replaced by the
 * manifest's.
 *
 * `manifest` is returned unchanged when it is a slice (a selector matched part of it), when
 * the page has no heading "API reference" (then guidance and reference cannot be told apart,
 * and adding the page would repeat the reference), and when the page has no guidance.
 * The page's `Source:` line is added to the manifest's, since part of the text is now the
 * page's.
 */
export function withPageGuidance(manifest: DocPage, page: DocPage): DocPage {
  const [lead, ...reference] = manifest.sections;
  const [pageLead, ...pageRest] = page.sections;
  if (lead === undefined || pageLead === undefined || lead.level !== 1) return manifest;
  const end = pageRest.findIndex((section) => API_REFERENCE.test(section.title.trim()));
  if (end === -1) return manifest;

  const guidance = pageRest.slice(0, end);
  const intro = pageLead.markdown.replace(TITLE_LINE, '').trim();
  if (guidance.length === 0 && intro === '') return manifest;

  const used = new Set(manifest.sections.map((section) => section.id));
  const renamed = new Map<string, string>([[pageLead.id, lead.id]]);
  const moved = guidance.map((section): DocSection => {
    const id = freeId(section.id, used);
    renamed.set(section.id, id);
    const parent =
      section.parent === undefined ? lead.id : (renamed.get(section.parent) ?? lead.id);
    return { ...section, id, parent };
  });
  const markdown = intro === '' ? lead.markdown : `${lead.markdown.trimEnd()}\n\n${intro}`;
  return {
    ...manifest,
    sections: [{ ...lead, markdown, tokens: estimateTokens(markdown) }, ...moved, ...reference],
    attribution: [manifest.attribution, page.attribution].filter((line) => line !== '').join(' '),
  };
}
