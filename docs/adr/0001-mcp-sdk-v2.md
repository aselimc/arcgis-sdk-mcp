# ADR-0001: Build on the MCP TypeScript SDK v2

Status: accepted (2026-10-13)

## Context

The server needs tools with input and output schemas, resources, prompts, a stdio
transport and a stateless HTTP transport. The MCP TypeScript SDK was split into
`@modelcontextprotocol/server`, `/client` and `/node` in its 2.x line, which is young, while
many hosts still open a session with the 2025 handshake.

## Decision

Use `@modelcontextprotocol/server` 2.x (`McpServer`, `registerTool`,
`registerResource`, `registerPrompt`, `serveStdio`) and `@modelcontextprotocol/node` for the
HTTP handler with its loopback Host and Origin validation. Schemas are written with zod 4,
imported as `zod/v4`. One server factory serves both protocol eras.

## Consequences

- Protocol tests run both eras in memory, and a `tools/list` snapshot guards the surface.
- The dependency is pinned with a caret range and a lockfile; an SDK upgrade is a reviewed change.
- Sessions, sampling, roots, elicitation and subscriptions are not used, which keeps the
  HTTP mode stateless.
