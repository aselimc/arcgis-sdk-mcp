/**
 * The query router: which products a free-text or symbol-shaped query most likely refers to
 * (`Registry.route`). It works from the registry alone (ids, names, aliases, packages,
 * keywords, languages, summaries, source titles) and issues no request.
 *
 * Three mechanisms, in order:
 * 1. a word of the query that is shaped like a qualified name, package or custom element
 *    (`arcpy.da.SearchCursor`, `com.arcgismaps.mapping`, `calcite-button`) names its product;
 * 2. otherwise products are ranked by the query words they know, each word weighted by how
 *    rare it is across products and by the field it was found in, with a prior for the
 *    products most questions are about;
 * 3. a query that decides nothing ("display a map", "legend", an unknown class name) is
 *    answered with a small default set, at a confidence that says it is a default.
 *
 * The third step exists because the caller without a project still needs somewhere to
 * look: an everyday GIS question used to reach no product at all, or a format
 * specification that happened to share a word with it.
 */
import { tokenize } from '../core/tokenize.js';
import type { Product } from '../core/types.js';
import { plainKey } from './resolve.js';

/** One routed product. */
export interface Route {
  product: string;
  /**
   * 0 to 1; 1 means every query word is part of the product's own names.
   * {@link DEFAULT_CONFIDENCE} marks a product of the default set: the query gave no
   * evidence for it.
   */
  confidence: number;
}

/** Options of {@link createRouter}. */
export interface RouterOptions {
  /**
   * Answer an undecided query with the default set (the default), or with `[]`. The
   * resolver of product names turns the default off: a misspelt product must not be
   * "suggested" as the JavaScript SDK.
   */
  fallback?: boolean;
}

/** Default number of products returned (design section 3.1: "at most three"). */
const DEFAULT_ROUTES = 3;

/** A product further behind the best one than this share is not worth naming. */
const RELATIVE_CUTOFF = 0.5;

/** Below this the query says nothing usable about the product. */
const MIN_CONFIDENCE = 0.12;

/**
 * A best route below this is a coincidence of one common word ("release notes" reaching a
 * product whose summary mentions them): the default set is the better answer.
 */
const WEAK_CONFIDENCE = 0.2;

/** Confidence of a product of the default set; below {@link MIN_CONFIDENCE} on purpose. */
export const DEFAULT_CONFIDENCE = 0.1;

/**
 * Where a question goes when it names no product: the web SDK, the REST APIs and the
 * cross-product developer guide between them cover maps, services and the concepts every
 * SDK shares.
 */
const DEFAULT_PRODUCTS = ['js-maps-sdk', 'rest-api', 'developer-guide'] as const;

/**
 * Where a bare class or function name goes: the leading web, Python and native references.
 * The Maps SDKs share their type names, so one native SDK stands for all of them.
 */
const DEFAULT_SYMBOL_PRODUCTS = ['js-maps-sdk', 'python-api', 'swift-maps-sdk'] as const;

/**
 * A prior, not evidence: the products most questions are about count for more on the same
 * words. Without it "create a web map" belongs to the web map specification (both words are
 * in its name) and "buffer" to the protocol buffer definitions. A product that the query
 * names outright still wins: its words weigh as identity, which no prior reaches.
 */
const PRIOR: Readonly<Record<string, number>> = {
  'js-maps-sdk': 1.5,
  'rest-api': 1.25,
  'developer-guide': 1.25,
  'python-api': 1.25,
  arcpy: 1.25,
};

/**
 * The most a prior may raise a confidence to. Callers read 0.95 and above as "the query
 * names this product"; only the words of the query can say that.
 */
const PRIOR_CEILING = 0.94;

/** More products than this at the top with the same confidence mean the query picks none. */
const MAX_TIED = 3;
const TIE_MARGIN = 0.001;

/**
 * A term known to more than this share of the products (`arcgis`) tells them apart no longer.
 * The floor keeps the rule from firing in a registry of a handful of products.
 */
const UBIQUITOUS_SHARE = 0.25;
const UBIQUITOUS_FLOOR = 3;

/** A name word known to at most this many products tells a product apart. */
const DISTINCTIVE_FREQUENCY = 3;

/** Confidence of a product named by a symbol or package shape. */
const SHAPE_CONFIDENCE = 0.95;

/**
 * How much a word counts, by where it was found. `identity` is a word that is a whole id or
 * alias on its own (`kotlin`, `arcpy`, `exb`): it names the product rather than describing it.
 */
const WEIGHT = { identity: 4, name: 3, keyword: 2, language: 1.5, text: 0.5 } as const;

/** Legacy tombstones are almost never what a query is about (design section 4.5). */
const STATUS_MULTIPLIER: Record<Product['status'], number> = {
  active: 1,
  beta: 1,
  deprecated: 0.6,
  retired: 0.2,
};

/**
 * A product that documents nothing itself and only points elsewhere (the Runtime 100.x
 * card: four migration guides) is routed like a tombstone whatever its status says. It is
 * found by name; a question is better answered by the product it points to.
 */
const isCard = (product: Product): boolean =>
  product.sources.length > 0 && product.sources.every((source) => source.adapter === 'static');

/** End-user help ranks just behind developer documentation on equal evidence. */
const HELP_MULTIPLIER = 0.85;

/**
 * Format specifications, operations tooling and the support site are narrow subjects whose
 * names are made of common words (`3d`, `tiles`, `enterprise`); an SDK that shares those
 * words is the likelier subject of a question.
 */
const NICHE_CATEGORIES: ReadonlySet<Product['category']> = new Set([
  'specs',
  'devops-oss',
  'support',
]);
const NICHE_MULTIPLIER = 0.75;

/** Words that describe the question, not its subject. Ignored in queries and in the registry text. */
const STOP_WORDS = new Set(
  (
    'a an and are as at by can do does for from how i in is it my of on or the to use using what with ' +
    'add build create display get make new set show'
  ).split(' '),
);

/**
 * Shapes of qualified names, packages and element names that identify a product. Matched
 * against each whitespace-separated word of the query; entries whose product is not in the
 * registry are ignored.
 */
const SHAPES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^arcpy(?:\.|$)/i, 'arcpy'],
  [/^com\.arcgismaps(?:\.|$)/i, 'kotlin-maps-sdk'],
  [/^com\.esri\.arcgisruntime(?:\.|$)/i, 'java-maps-sdk'],
  [/^Esri\.ArcGISRuntime(?:\.|$)/i, 'dotnet-maps-sdk'],
  [/^Esri::ArcGISRuntime/i, 'qt-maps-sdk'],
  // The Pro SDK namespaces are capitalised; the Python package is lower-case.
  [/^ArcGIS\.(?:Desktop|Core)(?:\.|$)/, 'arcgis-pro-sdk'],
  [/^arcgis\.[a-z_]+(?:\.|$)/, 'python-api'],
  [/^arcgis_maps(?:_toolkit)?(?:\W|$)/, 'flutter-maps-sdk'],
  [/^<?calcite-[a-z]/, 'calcite'],
  [/^@esri\/calcite-/, 'calcite'],
  [/^<?arcgis-[a-z]/, 'js-maps-sdk'],
  [/^(?:@arcgis\/core|esri)\/\w/, 'js-maps-sdk'],
  [/^@arcgis\/[a-z]+-components/, 'js-maps-sdk'],
  [/^@esri\/arcgis-rest-/, 'rest-js'],
  [/^jimu-[a-z]/, 'experience-builder'],
  [/^L\.esri(?:\.|$)/, 'esri-leaflet'],
  [/^geoanalytics\.[a-z]/, 'geoanalytics-engine'],
  [/^ST_[A-Za-z]/, 'geoanalytics-engine'],
  [/^arcgis(?:layers|utils|geocode|places|binding)(?:::|$)/, 'r-arcgis'],
  [/^pyprt(?:\.|$)/, 'cityengine'],
  [/^\$(?:feature|layer|map|datastore)\b/i, 'arcade'],
];

/**
 * Query terms that concern a second product as well: the AI components belong to the
 * JavaScript SDK, and the AI overview product explains how they fit together.
 */
const COMPANIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:ai[- ]components?|arcgis[- ]assistant)\b/i, 'ai-agents'],
];

/**
 * A single word written like a code identifier: `GeometryEngine`, `queryFeatures`,
 * `ST_Buffer`. Its humps are parts of a name, not words of a question, so they are not
 * looked up one by one: "TotallyMadeUpClass" is not a question about feature classes.
 */
function isIdentifier(query: string): boolean {
  const word = query.trim();
  return /^[A-Za-z_$][\w$]*$/.test(word) && /[a-z][A-Z]|[A-Za-z]_[A-Za-z]/.test(word);
}

/** Plural-insensitive form of a term; there is no other stemming. */
function stem(term: string): string {
  return term.length > 3 && term.endsWith('s') && !term.endsWith('ss') ? term.slice(0, -1) : term;
}

/** Compound words written with hyphens: `add-in`, `low-code`. */
const COMPOUND = /[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)+/gu;

/**
 * Router terms of a text: the project tokenizer, plus each hyphenated compound as one word
 * (so `add-in` meets `addin` although both of its halves are stop words), plural-folded.
 */
function terms(text: string): string[] {
  const compounds = (text.match(COMPOUND) ?? []).map((word) => word.replace(/-/g, ''));
  return [...tokenize(text), ...compounds.map((word) => word.toLowerCase())]
    .map(stem)
    .filter((term) => !STOP_WORDS.has(term));
}

interface Candidate {
  product: Product;
  /** Term to field weight (the highest of the fields the term occurs in). */
  weights: Map<string, number>;
  multiplier: number;
  /** End-user help or a niche subject: named next to another product only on evidence of its own. */
  secondary: boolean;
  /** The words of the product id, without the `arcgis` every other id starts with. */
  idTerms: readonly string[];
}

/** A vocabulary route with the query terms its product knows. */
interface Ranked extends Route {
  known: ReadonlySet<string>;
  /**
   * True when the query is about this product and not merely near it: it holds every word
   * of the product id (`field maps`), or a word of the product's names that few products
   * share (`kubernetes`, not `map`).
   */
  distinctive: boolean;
}

function candidateOf(product: Product): Candidate {
  const weights = new Map<string, number>();
  const add = (texts: readonly string[], weight: number): void => {
    for (const term of texts.flatMap(terms)) {
      if (weight > (weights.get(term) ?? 0)) weights.set(term, weight);
    }
  };
  const names = [product.id, product.name, ...product.aliases];
  add(names, WEIGHT.name);
  add(
    names.filter((name) => /^[\p{L}\p{N}]+$/u.test(name)),
    WEIGHT.identity,
  );
  add(
    product.packages.map((pkg) => pkg.name),
    WEIGHT.name,
  );
  add(product.keywords, WEIGHT.keyword);
  add(product.languages, WEIGHT.language);
  add([product.summary, ...product.sources.map((source) => source.title)], WEIGHT.text);
  const help = product.tier === 'help';
  const niche = NICHE_CATEGORIES.has(product.category);
  return {
    product,
    weights,
    multiplier:
      Math.min(STATUS_MULTIPLIER[product.status], isCard(product) ? STATUS_MULTIPLIER.retired : 1) *
      (help ? HELP_MULTIPLIER : 1) *
      (niche ? NICHE_MULTIPLIER : 1),
    secondary: help || niche,
    idTerms: terms(product.id.replace(/-/g, ' ')).filter((term) => term !== 'arcgis'),
  };
}

/**
 * Builds the router over a product list. Products of tier `link` are never routed to.
 *
 * @returns `route(query, n)`: at most `n` products, best first. A query that decides
 *   nothing gets the default set at {@link DEFAULT_CONFIDENCE}, or `[]` with
 *   `options.fallback: false`.
 */
export function createRouter(
  products: readonly Product[],
  options: RouterOptions = {},
): (query: string, n?: number) => Route[] {
  const fallback = options.fallback ?? true;
  const eligible = products.filter((product) => product.tier !== 'link').map(candidateOf);
  const byId = new Map(eligible.map((candidate) => [candidate.product.id, candidate]));

  // Rare terms identify a product; terms that most products share (`arcgis`, `sdk`) do not.
  const documentFrequency = new Map<string, number>();
  for (const candidate of eligible) {
    for (const term of candidate.weights.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }
  const rarity = (term: string): number => {
    const frequency = documentFrequency.get(term);
    const ubiquitous = Math.max(UBIQUITOUS_FLOOR, eligible.length * UBIQUITOUS_SHARE);
    if (frequency === undefined || frequency > ubiquitous) return 0;
    return Math.log(1 + eligible.length / frequency);
  };

  // Names that are themselves product names must not be read as element names
  // (`arcgis-pro` is a product, `arcgis-map` an element of the JavaScript SDK).
  // Link-tier products are in the table too, so that their names are not routed elsewhere.
  const names = new Map<string, Product>();
  for (const product of products) {
    for (const name of [product.id, ...product.aliases, ...product.packages.map((p) => p.name)]) {
      const key = plainKey(name);
      if (!names.has(key)) names.set(key, product);
    }
  }

  /** The product a word names by its shape, or by being a product, alias or package name. */
  function byShape(query: string): string | undefined {
    for (const word of query.trim().split(/\s+/)) {
      const bare = word.replace(/[<>()`'",;]+/g, '');
      // Only names that could not be ordinary words: they contain punctuation.
      const named = /[./@_-]/.test(bare) ? names.get(bare.toLowerCase()) : undefined;
      if (named !== undefined) {
        if (byId.has(named.id)) return named.id;
        continue;
      }
      const shape = SHAPES.find(([pattern, id]) => pattern.test(bare) && byId.has(id));
      if (shape !== undefined) return shape[1];
    }
    return undefined;
  }

  /** A confidence with the product's prior applied (see {@link PRIOR}). */
  const withPrior = (id: string, confidence: number): number => {
    const prior = PRIOR[id] ?? 1;
    return prior === 1 ? confidence : Math.min(confidence * prior, Math.max(confidence, PRIOR_CEILING));
  };

  /** The default set for a query that decided nothing, as far as the registry has it. */
  const defaults = (ids: readonly string[], n: number): Route[] =>
    ids
      .filter((id) => byId.has(id))
      .slice(0, n)
      .map((product) => ({ product, confidence: DEFAULT_CONFIDENCE }));

  /** Products ranked by the evidence of the query words alone, before any prior. */
  function byVocabulary(queryTerms: readonly string[]): Ranked[] {
    const asked = new Set(queryTerms);
    const wanted = [...asked].filter((term) => rarity(term) > 0);
    const total = wanted.reduce((sum, term) => sum + rarity(term) * WEIGHT.identity, 0);
    if (total === 0) return [];
    return eligible
      .map((candidate) => {
        const score = wanted.reduce(
          (sum, term) => sum + rarity(term) * (candidate.weights.get(term) ?? 0),
          0,
        );
        return {
          product: candidate.product.id,
          confidence: (score / total) * candidate.multiplier,
          known: new Set(wanted.filter((term) => candidate.weights.has(term))),
          distinctive:
            (candidate.idTerms.length > 0 && candidate.idTerms.every((term) => asked.has(term))) ||
            wanted.some(
              (term) =>
                (candidate.weights.get(term) ?? 0) >= WEIGHT.name &&
                (documentFrequency.get(term) ?? 0) <= DISTINCTIVE_FREQUENCY,
            ),
        };
      })
      .filter((route) => route.confidence >= MIN_CONFIDENCE)
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Applies the prior and puts developer documentation first. End-user help and narrow
   * subjects lead only on a word that is distinctly theirs: "download offline map area"
   * shares `map` and `area` with Field Maps, which does not make it a question about the
   * Field Maps app. Such a product then follows the best developer product.
   */
  function prioritised(evidence: readonly Ranked[]): Ranked[] {
    // On equal confidence the product with the prior goes first, then the registry order.
    const order = (a: Ranked, b: Ranked): number =>
      b.confidence - a.confidence || (PRIOR[b.product] ?? 1) - (PRIOR[a.product] ?? 1);
    const ranked = evidence
      .map((route) => ({ ...route, confidence: withPrior(route.product, route.confidence) }))
      .sort(order);
    const isSecondary = (route: Ranked): boolean => byId.get(route.product)?.secondary === true;
    const lead = ranked[0];
    const primary = ranked.find((route) => !isSecondary(route));
    if (lead === undefined || primary === undefined || !isSecondary(lead) || lead.distinctive) {
      return ranked;
    }
    const ceiling = primary.confidence * HELP_MULTIPLIER;
    return ranked
      .map((route) =>
        isSecondary(route) && !route.distinctive && route.confidence > ceiling
          ? { ...route, confidence: ceiling }
          : route,
      )
      .sort(order);
  }

  return (query, n = DEFAULT_ROUTES) => {
    if (n <= 0 || query.trim() === '') return [];
    // A shape identifies its product on its own; the other words describe what is wanted in it.
    const shaped = byShape(query);
    const identifier = shaped === undefined && isIdentifier(query);
    const undecided = (): Route[] =>
      fallback ? defaults(identifier ? DEFAULT_SYMBOL_PRODUCTS : DEFAULT_PRODUCTS, n) : [];

    let ranked: Ranked[];
    if (shaped !== undefined) {
      ranked = [
        { product: shaped, confidence: SHAPE_CONFIDENCE, known: new Set(), distinctive: true },
      ];
    } else {
      // An identifier is one name: only a product that lists it whole knows it.
      const evidence = byVocabulary(
        identifier ? [stem(query.trim().toLowerCase())] : terms(query),
      );
      const best = evidence[0];
      if (best === undefined) return undecided();
      // Words that many products share equally (`maps sdk`) single none of them out. The
      // prior must not break such a tie: it would turn "no evidence" into a confident answer.
      const tied = evidence.filter((route) => route.confidence > best.confidence - TIE_MARGIN);
      if (tied.length > MAX_TIED) return undecided();
      ranked = prioritised(evidence);
    }
    const top = ranked[0];
    if (top === undefined) return undecided();
    if (fallback && shaped === undefined && top.confidence < WEAK_CONFIDENCE) return undecided();
    // A help or niche product that knows only some of the words the best product knows has no
    // evidence of its own: one shared word (`cluster` in "cluster points with popups") would
    // otherwise add Kubernetes help to a question about a web map.
    const echoes = (route: Ranked): boolean =>
      route !== top &&
      byId.get(route.product)?.secondary === true &&
      route.known.size < top.known.size &&
      [...route.known].every((term) => top.known.has(term));
    let routes: Route[] = ranked
      .filter((route) => route.confidence >= top.confidence * RELATIVE_CUTOFF && !echoes(route))
      .map(({ product, confidence }) => ({ product, confidence }));

    for (const [pattern, companion] of COMPANIONS) {
      if (!pattern.test(query) || !byId.has(companion) || top.product === companion) continue;
      const confidence = Math.max(
        routes.find((route) => route.product === companion)?.confidence ?? 0,
        top.confidence * 0.8,
      );
      routes = [
        { product: top.product, confidence: top.confidence },
        { product: companion, confidence },
        ...routes.slice(1).filter((route) => route.product !== companion),
      ];
    }
    return routes
      .slice(0, n)
      .map((route) => ({ ...route, confidence: Math.round(route.confidence * 1000) / 1000 }));
  };
}
