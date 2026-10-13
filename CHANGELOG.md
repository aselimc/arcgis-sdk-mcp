# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-13

First version.

### Added

- Six read-only MCP tools: `arcgis_docs_list_products`, `arcgis_docs_get_versions`,
  `arcgis_docs_search`, `arcgis_docs_read`, `arcgis_docs_lookup_symbol` and
  `arcgis_docs_find_samples`.
- Four prompts (`arcgis_app_kickoff`, `arcgis_upgrade_review`, `arcgis_agentic_app_design`,
  `arcgis_project_instructions`) and four resources under `arcgis-docs://`.
- A product registry of about 50 developer products and 114 product-help sites, each with a
  floor source that keeps it reachable when a richer source fails.
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
- Symbol lookup follows a member to the type it is inherited from when the page of the type
  links to the declaration (Kotlin, .NET, Flutter, Java), and shows every overload of a C#
  method.
- One HTTP gateway with an allow-list, capability presets (`strict`, `standard`), robots
  rules, rate limiting, retries, a circuit breaker, a disk cache with conditional
  revalidation and stale-if-error, and offline mode.
- Ten curated briefs written by this project (`brief:<slug>`).
- CLI: stdio and HTTP serving, `doctor`, `cache`, `warm`, `call`.

[Unreleased]: https://github.com/aselimc/arcgis-sdk-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/aselimc/arcgis-sdk-mcp/releases/tag/v0.1.0
