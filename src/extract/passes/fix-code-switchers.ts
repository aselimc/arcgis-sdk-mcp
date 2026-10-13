import type { Cheerio } from 'cheerio';
import type { Element } from 'domhandler';
import { squash, tagged } from '../dom.js';
import type { Pass } from '../types.js';

/**
 * The strip above a code block that selects one of its variants (`GET` / `POST`, one file of
 * several). The class is shared with ARIA tab strips, which the tab pass handles: only a
 * strip with a dropdown is meant here.
 */
const SWITCHER = '.code-switcher';
const DROPDOWN = 'calcite-dropdown';
/** A variant of an Astro switcher; all of them are in the page, all but one hidden. */
const VARIANT = '[data-codeblock]';

/** The label of the variant the page shows: the dropdown's trigger, else its first item. */
function shownLabel(switcher: Cheerio<Element>, labels: readonly string[]): string {
  const trigger = squash(switcher.find('[slot=trigger]').first().text());
  return trigger === '' ? (labels[0] ?? '') : trigger;
}

/**
 * Code switchers: a dropdown that swaps the code block under it.
 *
 * - When every variant is in the page (Astro: one `[data-codeblock]` per item, labelled by
 *   the code pass), the strip is only interface and goes.
 * - When the page holds the selected variant alone (Gatsby renders the others on demand),
 *   the strip becomes the label of that block and names the variants that are missing, so
 *   that a reader knows the SQL or POST form exists although it is not shown.
 *
 * Left alone, the dropdown loses its button to the bulk removal and prints its items run
 * together (`GETPOST`, `PythonSQL`). Must run before the code passes replace the variants.
 */
export const fixCodeSwitchers: Pass = ($) => {
  $(SWITCHER).each((_, el) => {
    const switcher = $(el);
    if (switcher.find(DROPDOWN).length === 0) return;
    const labels = switcher
      .find('calcite-dropdown-item')
      .map((__, item) => squash($(item).attr('data-label') ?? $(item).text()))
      .get()
      .filter((label) => label !== '');
    if (switcher.siblings(VARIANT).length >= Math.max(1, labels.length)) {
      switcher.remove();
      return;
    }
    const shown = shownLabel(switcher, labels);
    if (shown === '') {
      switcher.remove();
      return;
    }
    const others = labels.filter((label) => label !== shown);
    const note =
      others.length === 0
        ? ''
        : ` ${tagged('em', `(the page also offers ${others.join(', ')}; only ${shown} is in its HTML)`)}`;
    switcher.replaceWith(`<p>${tagged('strong', shown)}${note}</p>`);
  });
};
