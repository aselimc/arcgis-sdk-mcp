/**
 * The query router: which products a free-text or symbol-shaped query most likely refers to
 * (`Registry.route`). It works from the registry alone (ids, names, aliases, packages,
 * keywords, languages, summaries, source titles) and issues no request.
 *
 * Two mechanisms, in order:
 * 1. a word of the query that is shaped like a qualified name, package or custom element
 *    (`arcpy.da.SearchCursor`, `com.arcgismaps.mapping`, `calcite-button`) names its product;
 * 2. otherwise products are ranked by the query words they know, each word weighted by how
 *    rare it is across products and by the field it was found in.
 */
import { tokenize } from '../core/tokenize.js';
import type { Product } from '../core/types.js';
import { plainKey } from './resolve.js';

/** One routed product. */
export interface Route {
  product: string;
  /** 0 to 1; 1 means every query word is part of the product's own names. */
  confidence: number;
}

/** Default number of products returned (design section 3.1: "at most three"). */
const DEFAULT_ROUTES = 3;

/** A product further behind the best one than this share is not worth naming. */
const RELATIVE_CUTOFF = 0.5;

/** Below this the query says nothing usable about the product. */
const MIN_CONFIDENCE = 0.12;

/** More products than this at the top with the same confidence mean the query picks none. */
const MAX_TIED = 3;
const TIE_MARGIN = 0.001;

/**
 * A term known to more than this share of the products (`arcgis`) tells them apart no longer.
 * The floor keeps the rule from firing in a registry of a handful of products.
 */
const UBIQUITOUS_SHARE = 0.25;
const UBIQUITOUS_FLOOR = 3;

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
  return {
    product,
    weights,
    multiplier:
      STATUS_MULTIPLIER[product.status] *
      (product.tier === 'help' ? HELP_MULTIPLIER : 1) *
      (NICHE_CATEGORIES.has(product.category) ? NICHE_MULTIPLIER : 1),
  };
}

/**
 * Builds the router over a product list. Products of tier `link` are never routed to.
 *
 * @returns `route(query, n)`: at most `n` products, best first; `[]` when the query names
 *   nothing the registry knows.
 */
export function createRouter(products: readonly Product[]): (query: string, n?: number) => Route[] {
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

  function byVocabulary(query: string): Route[] {
    const wanted = [...new Set(terms(query))].filter((term) => rarity(term) > 0);
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
        };
      })
      .filter((route) => route.confidence >= MIN_CONFIDENCE)
      .sort((a, b) => b.confidence - a.confidence);
  }

  return (query, n = DEFAULT_ROUTES) => {
    if (n <= 0 || query.trim() === '') return [];
    // A shape identifies its product on its own; the other words describe what is wanted in it.
    const shaped = byShape(query);
    const ranked =
      shaped === undefined
        ? byVocabulary(query)
        : [{ product: shaped, confidence: SHAPE_CONFIDENCE }];
    const top = ranked[0];
    if (top === undefined) return [];
    // Words that many products share equally (`maps sdk`) single none of them out.
    const tied = ranked.filter((route) => route.confidence > top.confidence - TIE_MARGIN);
    if (tied.length > MAX_TIED) return [];
    let routes = ranked.filter((route) => route.confidence >= top.confidence * RELATIVE_CUTOFF);

    for (const [pattern, companion] of COMPANIONS) {
      if (!pattern.test(query) || !byId.has(companion) || top.product === companion) continue;
      const confidence = Math.max(
        routes.find((route) => route.product === companion)?.confidence ?? 0,
        top.confidence * 0.8,
      );
      routes = [
        top,
        { product: companion, confidence },
        ...routes.slice(1).filter((route) => route.product !== companion),
      ];
    }
    return routes
      .slice(0, n)
      .map((route) => ({ ...route, confidence: Math.round(route.confidence * 1000) / 1000 }));
  };
}
