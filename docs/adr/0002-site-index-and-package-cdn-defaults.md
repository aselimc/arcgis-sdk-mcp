# ADR-0002: Site index files and package CDN reads are on by default

Status: accepted (2026-10-13)

## Context

Two source classes are useful enough to matter and sensitive enough to need a decision.
Index files that Esri's sites publish for their own search and navigation (search dumps,
navigation JSON, DocC and Dokka indexes, xrefmaps) are the only practical way to list a
documentation set without crawling it. Files of Esri's npm packages on a public CDN are the
only verified source for web component APIs and the only reachable source for older
JavaScript SDK versions, whose documentation host disallows automated access. Both read
structured files rather than pages, so they deserve an explicit switch.

## Decision

Both are on in the `standard` preset, as capabilities `site-index` and `package-cdn`,
with limits: index files are read for titles, URLs and symbol names only; package files are
single files at a pinned version, never archives, and files already in the project's
`node_modules` are preferred. The `strict` preset turns both off, and each can be disabled
by name.

## Consequences

- The README and docs/source-policy.md describe both capabilities and how to turn them off.
- Content from npm packages carries the Esri Master License Agreement source line.
- A request from Esri to change the default will be honoured.
