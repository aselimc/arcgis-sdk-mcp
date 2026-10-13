# ADR-0007: Build with tsc

Status: accepted (2026-10-13)

## Context

Bundlers give a single file and faster start-up. The bundler first chosen for this project
requires a newer Node.js than the lowest version the package supports (22.12).

## Decision

Compile with `tsc -p tsconfig.build.json` to ESM files under `dist`, keeping the module
structure. No bundler. TypeScript is pinned to the 5.9 line because the type-aware linter
does not support newer major versions yet.

## Consequences

- The package installs its nine runtime dependencies instead of inlining them.
- Start-up reads more files; the server defers all work until after the handshake, and the
  end-to-end test checks that start-up stays fast.
- The build is the type checker, so there is one tool to keep working.
