/**
 * From HTML to `DocPage`: picks the family profile, falls back to the generic extractor when
 * a profile no longer fits the page, applies `detail`, and attaches provenance and
 * diagnostics.
 */
import { load } from 'cheerio';
import { estimateTokens } from '../core/budget.js';
import type { RenderMeta, RenderOptions, RendererInputs } from '../core/ports.js';
import { pageProvenance } from '../core/provenance.js';
import type { DocPage, DocSection, HtmlFamily, MemberEntry } from '../core/types.js';
import { slugify } from '../core/url.js';
import { resolveFamily } from './detect-family.js';
import { measureMarkdown } from './diagnostics.js';
import { squash } from './dom.js';
import { PROFILES } from './families/registry.js';
import { MAX_OPEN_TAGS, openTagDepth, shapeProblem } from './limits.js';
import { runProfile, type ProfileResult } from './pipeline.js';
import { fence, type Converted } from './turndown.js';

/** A profile that yields less than this from a page larger than {@link DRIFT_MIN_HTML} has drifted. */
const DRIFT_MIN_CHARS = 200;
const DRIFT_MIN_HTML = 20_000;

const charsOf = (sections: readonly DocSection[]): number =>
  sections.reduce((sum, section) => sum + section.markdown.length, 0);

/** `detail: 'signature'` for one member: heading, declaration and the one-line summary. */
function signatureSection(member: MemberEntry, signature: string, language: string): DocSection {
  const markdown = [`### ${member.name}`, fence(signature, language), member.summary ?? '']
    .filter((block) => block !== '')
    .join('\n\n');
  return {
    id: member.id,
    level: 3,
    title: member.name,
    markdown,
    tokens: estimateTokens(markdown),
  };
}

/** Why the family profile's result cannot be used, or `undefined` when it can. */
function driftReason(
  family: HtmlFamily,
  result: ProfileResult | undefined,
  htmlLength: number,
): string | undefined {
  if (result === undefined) return `the page has no ${family} content root`;
  const chars = charsOf(result.sections);
  if (!result.sliced && chars < DRIFT_MIN_CHARS && htmlLength > DRIFT_MIN_HTML) {
    return `the ${family} profile produced ${chars} characters from ${htmlLength} bytes of HTML`;
  }
  return undefined;
}

/**
 * The page returned for a document that is not converted (see `limits.ts`): its title, one
 * sentence saying why, and the link. `degraded.level` is `link-only`.
 */
function linkOnlyPage(
  title: string,
  problem: string,
  meta: RenderMeta,
  family: HtmlFamily,
  started: number,
): DocPage {
  const reason = `The page was not converted: ${problem}.`;
  const markdown = `# ${title}\n\n${reason} Open it in a browser: ${meta.url}`;
  return {
    ...pageProvenance(meta),
    title,
    sections: [{ id: slugify(title), level: 1, title, markdown, tokens: estimateTokens(markdown) }],
    degraded: { level: 'link-only', reason },
    diagnostics: {
      family,
      renderer: 'html',
      fences: 0,
      fencesWithLanguage: 0,
      tablesByStrategy: {},
      unknownIslands: [],
      leftoverHtmlTags: 0,
      redirectHops: meta.res?.aliasChain.length ?? 0,
      ms: Math.round(performance.now() - started),
    },
    notices: [],
  };
}

/** What a reader has to know about the code blocks the page shows collapsed. */
function collapsedNotice(count: number, url: string): string {
  const blocks = count === 1 ? '1 code block is' : `${count} code blocks are`;
  return `${blocks} collapsed on the source page and cut off here: only the first lines are in its HTML. Each ends with a line that says so; the full text is at ${url}.`;
}

/** Converts one HTML document. `convert` is the Turndown converter of this extractor. */
export function extractPage(
  convert: (html: string) => Converted,
  input: RendererInputs['html'],
  meta: RenderMeta,
  opts: RenderOptions = {},
): DocPage {
  const started = performance.now();
  const { html } = input;
  const hinted = input.familyHint ?? 'generic';
  if (openTagDepth(html) > MAX_OPEN_TAGS) {
    const title = squash(/<title[^>]*>([^<]{1,300})/i.exec(html)?.[1] ?? '') || meta.url;
    const problem = `its markup opens more than ${MAX_OPEN_TAGS} elements inside each other`;
    return linkOnlyPage(title, problem, meta, hinted, started);
  }
  const $ = load(html);
  const problem = shapeProblem($);
  if (problem !== undefined) {
    const title = squash($('title').first().text()) || meta.url;
    return linkOnlyPage(title, problem, meta, hinted, started);
  }
  const detected = resolveFamily($, html, input.familyHint);
  let family = detected;
  let degraded: DocPage['degraded'];
  let result: ProfileResult | undefined;

  if (family === 'generic') {
    // A caller that asks for the generic profile (a fragment taken out of structured data)
    // made a choice; only a page whose family could not be told is a lower rung.
    if (input.familyHint !== 'generic') {
      degraded = {
        level: 'generic-extractor',
        reason: 'No known page family matched; converted with the generic extractor.',
      };
    }
  } else {
    result = runProfile($, PROFILES[family], meta, opts, convert);
    const reason = driftReason(family, result, html.length);
    if (reason !== undefined) {
      degraded = {
        level: 'generic-extractor',
        reason: `Page layout drift: ${reason}; converted with the generic extractor.`,
      };
      family = 'generic';
      result = undefined;
    }
  }
  // A profile that failed has taken the parsed document apart: the fallback parses again.
  result ??= runProfile(
    detected === 'generic' ? $ : load(html),
    PROFILES.generic,
    meta,
    opts,
    convert,
  ) ?? {
    title: '',
    sections: [],
    sliced: false,
    counters: { tables: {}, unknownIslands: new Set<string>(), collapsedCode: 0 },
  };

  const signature = opts.detail === 'signature' ? result.selected?.signature : undefined;
  const sections =
    result.selected === undefined || signature === undefined
      ? result.sections
      : [signatureSection(result.selected, signature, PROFILES[family].defaultLanguage)];

  const metrics = measureMarkdown(sections.map((section) => section.markdown).join('\n\n'));
  return {
    ...pageProvenance(meta),
    title: result.title,
    ...(result.header === undefined ? {} : { header: result.header }),
    sections,
    ...(result.members === undefined ? {} : { members: result.members }),
    ...(result.files === undefined ? {} : { files: result.files }),
    ...(degraded === undefined ? {} : { degraded }),
    diagnostics: {
      family,
      renderer: 'html',
      fences: metrics.fences,
      fencesWithLanguage: metrics.fencesWithLanguage,
      tablesByStrategy: { ...result.counters.tables },
      unknownIslands: [...result.counters.unknownIslands].sort(),
      leftoverHtmlTags: metrics.leftoverHtmlTags,
      redirectHops: meta.res?.aliasChain.length ?? 0,
      ms: Math.round(performance.now() - started),
    },
    notices:
      result.counters.collapsedCode === 0
        ? []
        : [collapsedNotice(result.counters.collapsedCode, meta.url)],
  };
}
