import type { HtmlFamily } from '../../core/types.js';
import type { FamilyProfile } from '../types.js';
import { astroJsRef } from './astro-js-ref.js';
import { astroSample } from './astro-sample.js';
import { astro } from './astro.js';
import { dartdoc } from './dartdoc.js';
import { docfxEsri } from './docfx-esri.js';
import { docfxNet } from './docfx-net.js';
import { documentx } from './documentx.js';
import { dokka } from './dokka.js';
import { gatsbyRest } from './gatsby-rest.js';
import { gatsby } from './gatsby.js';
import { generic } from './generic.js';
import { javadocLegacy } from './javadoc-legacy.js';
import { javadoc } from './javadoc.js';
import { legacyHelp } from './legacy-help.js';
import { qdoc } from './qdoc.js';
import { supportKb } from './support-kb.js';

/** The profile of every page family. The record type makes a missing family a compile error. */
export const PROFILES: Readonly<Record<HtmlFamily, FamilyProfile>> = {
  astro,
  'astro-js-ref': astroJsRef,
  'astro-sample': astroSample,
  gatsby,
  'gatsby-rest': gatsbyRest,
  qdoc,
  dokka,
  dartdoc,
  'docfx-net': docfxNet,
  'docfx-esri': docfxEsri,
  documentx,
  javadoc,
  'javadoc-legacy': javadocLegacy,
  'legacy-help': legacyHelp,
  'support-kb': supportKb,
  generic,
};
