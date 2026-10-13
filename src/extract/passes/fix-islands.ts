import { escapeHtml, squash } from '../dom.js';
import type { Pass } from '../types.js';

/** `component-url="/_astro/MoreInfoReact.Dk3f9.js"` names the component. */
const COMPONENT_NAME = /_astro\/([A-Za-z0-9_]+)\./;
/** Interactive chrome with no documentation content. */
const CHROME = /^(?:DemoApp|TableOfContents|Feedback)/;

/**
 * `astro-island` elements, by component: `MoreInfo*` keeps its slot as a "More info" block
 * quote, `CodePenLink*` inside prose becomes its text, page chrome is removed. Removing
 * every island blindly drops explanations and leaves sentences with a hole. Components no
 * rule knows are removed and reported in the diagnostics.
 */
export const fixIslands: Pass = ($, env) => {
  // Innermost first, so that a kept slot never contains an unprocessed island.
  for (const el of $('astro-island').get().reverse()) {
    const island = $(el);
    const name = COMPONENT_NAME.exec(island.attr('component-url') ?? '')?.[1] ?? 'unknown';
    if (name.startsWith('MoreInfo')) {
      const slot = island.find('astro-slot').first().html() ?? '';
      island.replaceWith(`<blockquote><p><strong>More info:</strong></p>${slot}</blockquote>`);
    } else if (name.startsWith('CodePenLink')) {
      if (island.closest('ul.list-none').length > 0) island.remove();
      else island.replaceWith(escapeHtml(squash(island.text())));
    } else {
      if (!CHROME.test(name)) env.counters.unknownIslands.add(name);
      island.remove();
    }
  }
};
