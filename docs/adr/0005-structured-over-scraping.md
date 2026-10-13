# ADR-0005: Prefer structured sources to HTML scraping

Status: accepted (2026-10-13)

## Context

Esri's sites are in motion: generators change, class names change, hashed file names rotate.
Many reference sets also exist in a structured form: Gatsby page-data with OpenAPI or TypeDoc
objects, DocC JSON, Custom Elements Manifests, Sphinx inventories, TypeScript declarations.

## Decision

Where a structured form exists, read it and render it with a dedicated renderer. Use the
HTML pipeline for prose pages and as the fallback, with a family profile per site generator
and a generic extractor as the last rung. Every source has a degradation ladder, and a
result states the rung that answered when it is not the first.

## Consequences

- More renderers to maintain, each small and tested against a fixture.
- A site redesign degrades output quality instead of breaking the product.
- One exception by design: JavaScript SDK members are read from the HTML member cards for the
  current release, because they include inherited members; the declaration scanner serves
  other versions and is the fallback.
