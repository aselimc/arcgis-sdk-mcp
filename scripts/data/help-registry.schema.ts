/**
 * Shapes of the two inputs of `scripts/import-help-registry.ts`: the research file
 * (`help-registry.source.json`) and the editorial rules (`help-registry.rules.json`).
 *
 * The research file carries more fields than the import reads; the schemas name only the
 * ones the rules of design section 4.6 depend on, so a renamed or retyped field fails the
 * import with a path instead of producing a silently different registry.
 */
import * as z from 'zod/v4';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** One help book: a directory below the product base with its own table of contents. */
export const BookSchema = z.object({
  path: z.string().min(1),
  toc_script: z.string().nullish(),
  pages: z.number().nullish(),
});

/** One entry of `entries[]` in the research file. */
export const EntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  host: z.enum(['doc.esri.com', 'doc.arcgis.com', 'enterprise.arcgis.com', 'pro.arcgis.com']),
  /** Absolute; legacy hosts write the version segment as `<version>`. */
  base_url: z.string().startsWith('https://'),
  url_slug: z.string().min(1),
  search: z.object({ site: z.string(), product: z.array(z.string()) }),
  other_versions_on_host: z.array(z.string()),
  /** A list, except for pro.arcgis.com where books are grouped by version and section. */
  books: z.union([z.array(BookSchema), z.record(z.string(), z.unknown())]),
  pages_en: z.number().nullish(),
  status: z.enum(['active', 'migrated', 'retired']),
  scope: z.string().min(1),
  /** The version whose book list was verified, on hosts without a `latest` alias. */
  books_sampled_at: z.string().optional(),
  root_redirect: z.string().nullish(),
  /** HTTP status the root answered with after redirects; 403 and 404 mean it is gone. */
  root_final_status: z.number().int().optional(),
  /**
   * A page that was verified to answer and stands for a retired product whose `base_url` no
   * longer does: the one link a tombstone offers must work.
   */
  landing_url: z.string().startsWith('https://').optional(),
});

/** The research file. */
export const SourceFileSchema = z.object({
  generated: z.string().regex(ISO_DATE),
  entries: z.array(EntrySchema),
  /** Topic group -> page paths relative to the ArcGIS Online help base; `_`-keys are notes. */
  arcgis_online_developer_pages: z.record(z.string(), z.union([z.array(z.string()), z.string()])),
});

const IdMap = z.record(z.string(), z.string());

/** This project's wording and overrides for one generated product. */
export const ProductMetaSchema = z.object({
  /** Official name, where the research name carries a note in parentheses that is not part of it. */
  name: z.string().optional(),
  summary: z.string().min(20).max(160),
  keywords: z.array(z.string()).min(1),
  related: z.array(z.string()).optional(),
  pitfalls: z.array(z.string().max(200)).max(4).optional(),
  successor: z.string().optional(),
  statusNote: z.string().max(200).optional(),
});

/** One `legacy-help` source over earlier ArcGIS Pro releases (see `help-registry.pro.ts`). */
export const ProSourceRuleSchema = z.strictObject({
  title: z.string().min(1),
  /** Top-level directories of the old host the source owns as a whole. */
  sections: z.array(z.string().min(1)),
  /** The books it lists one by one, or `rest`: every book of its sections no other source lists. */
  books: z.union([z.literal('rest'), z.array(z.string().min(1))]),
  /** The book whose link list is the source's canary. */
  probeBook: z.string().min(1),
});

/** The rules file: fixed id maps of section 4.6 plus per-product wording. */
export const RulesFileSchema = z.object({
  /** Ids of the developer-tier products; reserved names and valid `related` targets. */
  developerIds: z.array(z.string()),
  /** doc.arcgis.com entry -> id of the product it becomes. */
  standalone: IdMap,
  /** doc.arcgis.com entry -> doc.esri.com product that gets it as source `saas`. */
  saasTwins: IdMap,
  /** Entry -> `product/source` of the developer product that owns its books. */
  developerBooks: IdMap,
  /** Entry -> book path -> `product/source` of the developer product that owns that book. */
  splitBooks: z.record(z.string(), IdMap),
  /** Migrated doc.arcgis.com entry -> product that gets its slug as an alias. */
  migratedAliases: IdMap,
  /** Entry -> id of the tombstone it becomes. */
  tombstones: IdMap,
  /** Retired entry -> developer tombstone that gets a help link. */
  developerTombstoneLinks: IdMap,
  /** Migrated enterprise.arcgis.com entry -> product that gets it as source `legacy`. */
  migratedLegacy: IdMap,
  /** The product that receives every `versioned-on-demand` enterprise.arcgis.com entry. */
  enterpriseProduct: z.string(),
  pro: z.object({
    product: z.string(),
    /** Versions on pro.arcgis.com that are read on demand; the others are link-only. */
    liveLines: z.array(z.string()).min(1),
    /** `product/source` -> what that source owns and lists on the old host. */
    sources: z.record(z.string(), ProSourceRuleSchema),
    /** Sections whose every book some source must list: the developer reference. */
    completeSections: z.array(z.string()),
    /** Books of the doc.esri.com entry that belong to developer products. */
    docfxExcludedBooks: z.array(z.string()),
  }),
  onlineStartHere: z.array(z.object({ group: z.string(), title: z.string() })),
  products: z.record(z.string(), ProductMetaSchema),
});

/** A validated research entry. */
export type Entry = z.infer<typeof EntrySchema>;
/** A validated help book. */
export type Book = z.infer<typeof BookSchema>;
/** The validated research file. */
export type SourceFile = z.infer<typeof SourceFileSchema>;
/** The validated rules file. */
export type RulesFile = z.infer<typeof RulesFileSchema>;
/** Wording and overrides of one generated product. */
export type ProductMeta = z.infer<typeof ProductMetaSchema>;
