import type { CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { escapeHtml, squash, tagged } from '../dom.js';
import { stampOutline } from '../outline.js';
import type { FamilyProfile, PageView, Pass } from '../types.js';
import { fragment } from './shared.js';

const ROOT = 'article#main';
/** The Python tab of a geoprocessing tool's parameter tabs. */
const PYTHON_TAB = 'section[data-tab="python"]';

/** The tool's call signature (`arcpy.analysis.Buffer(...)`), shown as the page header. */
function signature(page: PageView): AnyNode[] {
  const code = page.root.find(`${PYTHON_TAB} > p > code`).first();
  const text = squash(code.text());
  if (text === '') return [];
  code.parent().remove();
  return fragment(page.$, tagged('pre', text, 'data-md-lang="python"'));
}

/** One parameter row as a definition block, read from the row's data attributes. */
function parameterBlock($: CheerioAPI, row: Element): string {
  const first = $(row).children('td').first();
  const name = $(row).attr('data-param') ?? '';
  const label = squash(first.find('span[data-label]').text());
  const dataType = squash($(row).find('span[data-datatype]').text());
  const optional = /\(Optional\)/i.test(first.text());
  const description = $(row).find('td[data-desc]').first();
  description.find('span[data-image], img').remove();
  const facts = [
    label === '' || label === name ? '' : ` (${escapeHtml(label)})`,
    dataType === '' ? '' : ` \u2014 ${tagged('em', dataType)}`,
    optional ? ', optional' : ', required',
  ].join('');
  return `<p><strong>${tagged('code', name)}</strong>${facts}</p>${description.html() ?? ''}`;
}

const prepare: Pass = ($) => {
  $('h1').first().remove();
  $('#version-switcher-container, .affix-mobile').remove();
  // The dialog tab repeats the Python tab with UI labels; keep the Python one.
  $(PYTHON_TAB).each((_, el) => {
    const tab = $(el);
    tab.siblings('section[data-tab]').remove();
    tab.siblings('ul[role=tablist]').remove();
    tab.removeAttr('hidden').removeAttr('aria-hidden');
  });
  $('table[data-param-table]').each((_, table) => {
    const blocks = $(table)
      .find('tr[data-param]')
      .map((__, row) => parameterBlock($, row))
      .get();
    $(table).replaceWith(`<div>${blocks.join('')}</div>`);
  });
  $('[purpose="code-sample-title"]').each((_, el) => {
    $(el).replaceWith(`<p>${tagged('strong', squash($(el).text()))}</p>`);
  });
};

/**
 * doc.esri.com DocFX pages (geoprocessing tool reference, ArcPy). Sections are `h2[id]`
 * (`summary`, `usage`, `parameters`, `environments`, `licensing`). Tool parameters are read
 * from the `data-param*` attributes of the parameter table, which is steadier than its
 * visual layout, and emitted as one definition block per parameter.
 */
export const docfxEsri: FamilyProfile = {
  id: 'docfx-esri',
  defaultLanguage: 'python',
  root: ($) => $(ROOT).first(),
  title: ($) => $(ROOT).find('h1').first().text(),
  // The `h5` of an alert box is its label, not a section.
  outline: (page) => stampOutline(page, { selector: 'h1, h2, h3, h4' }),
  header: signature,
  prepare,
};
