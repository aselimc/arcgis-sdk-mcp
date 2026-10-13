# ADR-0004: Six tools, and a reference is a URL

Status: accepted (2026-10-13)

## Context

Tool selection errors grow with the number of tools, and invented identifier schemes are a
second thing for a model to get wrong. Agents already meet Esri documentation URLs in code
comments, error messages and search results.

## Decision

Expose six read-only tools named `arcgis_docs_*`. A document reference is an https URL on
an allow-listed host (optionally with a fragment), or `brief:<slug>`. GitHub files use the
`github.com/<owner>/<repo>/blob/<ref>/<path>` form. `read` and `lookup_symbol` return text
only; the other four also return `structuredContent`. Workflow guidance lives in the server
instructions, not in tool descriptions. Health reporting is a resource and the `doctor`
command, not a tool.

## Consequences

- A URL from any source can be passed to `read`; one that no adapter owns is read by the
  generic extractor when its host is allow-listed.
- Document bodies are never duplicated into `structuredContent`.
- Release notes are documents: `get_versions` returns their URLs and `read` opens them.
