/**
 * The adapter kit: the building blocks every adapter is made of, whichever package it is in.
 * `adapters/site` and `adapters/reference` may not import each other, so what both need
 * lives here, defined once. The kit imports `src/core` only and performs no I/O of its own.
 */
export { gaveUpOurselves, skipOptional, tolerate, unusableIndex } from './failures.js';
export { isIndexCanary, probeSource, type ProbeOptions } from './probe.js';
export { recordOf, symbolRecord, type RecordExtras } from './records.js';
export {
  readHtmlPage,
  renderMeta,
  renderOptionsOf,
  symbolTarget,
  type HtmlPageOptions,
} from './render.js';
export {
  absoluteUrl,
  assertLive,
  budgetOf,
  indexRequest,
  licenseOf,
  siteIndexEnabled,
} from './source.js';
export { escapeRegExp, fragmentOf, oneLine, plainInline, safeDecode, summaryOf } from './text.js';
