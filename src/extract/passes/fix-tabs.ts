import type { Element } from 'domhandler';
import { tagged } from '../dom.js';
import type { Pass } from '../types.js';

/**
 * ARIA tabs: every panel is shown under its tab label and the tab strip is dropped. Only the
 * selected panel is visible in the page, so without this pass the other variants (ESM / CDN
 * imports, request examples per language) are lost. Must run before buttons are removed,
 * because the labels are the tab buttons.
 */
export const fixTabs: Pass = ($) => {
  const byId = new Map<string, Element>();
  $('[id]').each((_, el) => {
    byId.set($(el).attr('id') ?? '', el);
  });
  // Some tab sets link the other way round: the panel names its tab.
  const byTab = new Map<string, Element>();
  $('[role=tabpanel][aria-labelledby]').each((_, el) => {
    byTab.set($(el).attr('aria-labelledby') ?? '', el);
  });

  $('[role=tablist]').each((_, list) => {
    $(list)
      .find('[role=tab]')
      .each((__, tab) => {
        const panel =
          byId.get($(tab).attr('aria-controls') ?? '') ?? byTab.get($(tab).attr('id') ?? '');
        if (panel === undefined) return;
        const label = ($(tab).attr('data-label') ?? $(tab).text()).trim();
        $(panel).removeAttr('hidden').removeAttr('aria-hidden');
        if (label !== '') $(panel).prepend(`<p>${tagged('strong', label)}</p>`);
      });
    $(list).remove();
  });

  $('[role=tabpanel]').each((_, panel) => {
    // Placeholder panels of filterable tab sets.
    if (/-(?:no-results|error)$/.test($(panel).attr('id') ?? '')) $(panel).remove();
    else $(panel).removeAttr('hidden');
  });
};
