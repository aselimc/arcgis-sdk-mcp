# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the version is below 1.0,
a minor version may change tool arguments or results; such changes are listed under
"Changed".

## [Unreleased]

## [0.1.0] - 2026-10-13

First version.

### Added

- Six read-only MCP tools: `arcgis_docs_list_products`, `arcgis_docs_get_versions`,
  `arcgis_docs_search`, `arcgis_docs_read`, `arcgis_docs_lookup_symbol` and
  `arcgis_docs_find_samples`.
- Four prompts (`arcgis_app_kickoff`, `arcgis_upgrade_review`, `arcgis_agentic_app_design`,
  `arcgis_project_instructions`) and four resources under `arcgis-docs://` (catalog, product
  profile, briefs, status).
- A product registry of 136 entries: 53 developer products, 7 tombstones for deprecated and
  retired developer products, and 76 end-user help products. Every product has a floor
  source that keeps it reachable when a richer source fails.
- Site adapters (Astro, Gatsby, DocFX on doc.esri.com, legacy help, sitemap, static, briefs,
  OpenAPI) and reference adapters (DocC, Dokka, dartdoc, DocFX for .NET, javadoc, Sphinx, npm
  typings, Custom Elements Manifest, npm JSON, GitHub repositories, C# XML documentation,
  pkgdown).
- An HTML extraction pipeline for 16 page families and structured renderers for OpenAPI,
  TypeDoc, Custom Elements Manifest, DocC, Sphinx, C# XML documentation, TypeScript
  declarations, Arcade, Markdown, notebooks and sample bundles.
- Version oracles (npm, PyPI, NuGet, pub.dev, GitHub releases, page banners, sitemaps, and
  Esri's product life cycle service with the opt-in capability `lifecycle-api`) and detection
  of Esri SDK versions in the user's project.
- Symbol lookup follows a member to the type it is inherited from: by the link or statement
  on the page of the type (Kotlin, .NET, Flutter, Java), or up the base types that page names
  (Qt, Swift). It shows every overload of a C# method, lists a second declaration of the same
  name (the Arcade `Intersects` of geometries and of feature sets) as a ref to read, and keeps
  the member index of a type whose description alone would fill the result.
- One HTTP gateway with an allow-list, capability presets (`strict`, `standard`), robots
  rules, rate limiting, retries, a circuit breaker, a disk cache with conditional
  revalidation and stale-if-error, and offline mode.
- Ten curated briefs written by this project (`brief:<slug>`).
- CLI: stdio and HTTP serving, `doctor`, `cache`, `warm`, `call`.
- Documentation: architecture, tool reference, configuration, source policy, product
  coverage, contributor guides and seven architecture decision records.
- 25 agent evaluation tasks with a runner and a scorer (`evals/`).

### Known limitations

- Search is a local index over titles, headings, keywords, descriptions and symbol names;
  Esri's full-text site search is opt-in (`+site-search`). Natural-language queries rank less
  well than API names.
- A token budget is cut at block boundaries, so a result can stop before a large list or
  table with budget left over.
- Inherited members are followed across at most four base pages; Swift members that come
  from a protocol extension are not followed.
- A .NET lookup that names one overload returns that overload only.
- REST operation names are derived from page titles, not from path segments.
- The agent evaluations have not been run against this version.

[Unreleased]: https://github.com/aselimc/arcgis-sdk-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/aselimc/arcgis-sdk-mcp/releases/tag/v0.1.0
