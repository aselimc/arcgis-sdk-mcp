# ADR-0006: Fixtures are synthetic, open source, or uncommitted

Status: accepted (2026-10-13)

## Context

Parsers need realistic inputs, and the most realistic inputs are Esri's pages, which this
project may not redistribute.

## Decision

Three tiers. Synthetic fixtures reproduce the structure of a response with invented products
and this project's own prose, and are committed. Files from Esri's Apache-2.0 repositories
are committed unmodified under `test/fixtures/oss` with source URL, commit and licence.
Real responses are recorded by `scripts/record-fixtures.ts` into `test/fixtures/recorded`,
which is git-ignored; the live suite checks invariants on them rather than exact output.

## Consequences

- Synthetic fixtures can drift from real markup. The live suite is the ground truth, and a
  live failure is fixed together with the synthetic fixture.
- The list of recorded URLs is committed; the bodies never are.
