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
import { resolveFamily } from './detect-family.js';
import { measureMarkdown } from './diagnostics.js';
import { PROFILES } from './families/registry.js';
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

/** Converts one HTML document. `convert` is the Turndown converter of this extractor. */
export function extractPage(
  convert: (html: string) => Converted,
  input: RendererInputs['html'],
  meta: RenderMeta,
  opts: RenderOptions = {},
): DocPage {
  const started = performance.now();
  const { html } = input;
  const $ = load(html);
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
    counters: { tables: {}, unknownIslands: new Set<string>() },
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
    notices: [],
  };
}
