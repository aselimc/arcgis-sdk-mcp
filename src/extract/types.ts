/**
 * Shapes shared by the passes, the family profiles and the pipeline. Nothing here is part of
 * the package's public surface: other packages see only `HtmlExtractor` from `src/core`.
 */
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import type { HtmlFamily, MemberEntry, SourceFile } from '../core/types.js';

/** Counters filled while a document is cleaned; they end up in `DocPage.diagnostics`. */
export interface PassCounters {
  /** Tables rewritten, keyed by strategy: `gfm`, `key-value`, `definition`, `records`. */
  tables: Record<string, number>;
  /** Component names of `astro-island` elements no rule knows. */
  unknownIslands: Set<string>;
  /** Code blocks the page shows collapsed, of which its HTML holds only the first lines. */
  collapsedCode: number;
}

/** What a pass may know about the document besides its DOM. */
export interface PassEnv {
  /** Page URL without fragment; relative links resolve against it. */
  url: string;
  /** The page title, as the pipeline will write it in the opening heading. */
  title: string;
  /** Astro tutorials: keep only the lines each step shows expanded. */
  focusedCode: boolean;
  /** Fence language for code blocks that do not name one. Empty for none. */
  defaultLanguage: string;
  /** API pages: keep the introduction and the member index, drop the member bodies. */
  overview: boolean;
  counters: PassCounters;
}

/**
 * One cleaning step. It mutates the working document in place and returns nothing; the
 * working document holds only the content being converted, so a pass selects from `$`
 * without worrying about page chrome.
 */
export type Pass = ($: CheerioAPI, env: PassEnv) => void;

/** A heading of the page as seen before cleaning. */
export interface OutlineNode {
  /** Final section id: the heading's own `id`, else a slug of its text; unique on the page. */
  id: string;
  title: string;
  level: number;
  el: Element;
  /** A second id the section answers to. */
  alias?: string;
}

/** Everything a profile needs to look at the original (uncleaned) page. */
export interface PageView {
  $: CheerioAPI;
  /** The content root chosen by the profile. */
  root: Cheerio<Element>;
  /** The page title, whitespace collapsed. */
  title: string;
  /** Page URL without fragment. */
  url: string;
}

/**
 * The rules of one page family. `root`, `title`, `outline`, `members`, `header`, `files` and
 * `sliceMember` read the original page; `prepare` and `clean` run on the working document,
 * before and after the shared passes.
 */
export interface FamilyProfile {
  readonly id: HtmlFamily;
  /** Fence language for code blocks without one (`kotlin` on Dokka pages, ...). */
  readonly defaultLanguage: string;
  /** The element holding the content. Empty when the page is not of this family after all. */
  root($: CheerioAPI): Cheerio<Element>;
  /** The page title as the family marks it up; empty to fall back to `<title>`. */
  title($: CheerioAPI): string;
  /** Stamps section ids on the headings (see `outline.ts`) and returns them in document order. */
  outline(page: PageView): OutlineNode[];
  /**
   * The nodes of one member, or `undefined` when members are not documented on the page.
   * Sections are cut by `sliceByHeading` for every family.
   */
  sliceMember?(page: PageView, id: string): AnyNode[] | undefined;
  /** Every member documented or listed on an API page. */
  members?(page: PageView): MemberEntry[];
  /** Detaches and returns the metadata block that is shown before the body. */
  header?(page: PageView): AnyNode[];
  /** Detaches the sample source and returns it as files, main file first. */
  files?(page: PageView): SourceFile[];
  /** Turns family markup into the generic shapes the shared passes understand. */
  prepare?: Pass;
  /** Family rules that need the shared passes to have run. */
  clean?: Pass;
  /** True when `detail` other than `full` should drop the member bodies of a whole-page read. */
  readonly overviewDropsMembers?: boolean;
}
