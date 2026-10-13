# ADR-0003: Ship no Esri-authored content

Status: accepted (2026-10-13)

## Context

A documentation server could bundle a snapshot of the documentation for speed and offline
use. That would redistribute Esri's copyrighted content and go stale between releases.

## Decision

The repository and the npm package contain code, the product registry (ids, URLs, patterns),
and briefs written by this project. Documentation is fetched on demand and cached on the
user's machine. `scripts/check-package-contents.ts` runs before every pack and fails when
the tarball holds anything but `dist`, the README, LICENSE and NOTICE, or when a built file
contains markers of a fetched page.

## Consequences

- The first call for a product is slower than later ones; `warm` builds indexes ahead of time.
- Offline mode serves only what was cached earlier.
- Briefs state no fact an oracle can supply (such as a version number) and link every claim.
