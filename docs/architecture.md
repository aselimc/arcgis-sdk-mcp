# Architecture

`arcgis-sdk-mcp` is a ports-and-adapters application. A small core defines the data types and
the interfaces between packages; every other package implements one of those interfaces and
knows nothing about the others. One composition root wires them together.

## Layers

```mermaid
flowchart TD
  host["MCP host (stdio or HTTP)"] --> mcp["src/mcp: tools, resources, prompts"]
  cli["src/cli: serve, doctor, cache, warm, call"] --> mcp
  mcp --> services["src/services: catalog, index, search, doc, symbol, sample"]
  mcp --> versions["src/versions: oracles, compatibility, release notes"]
  services --> adapters["src/adapters: site/* and reference/*"]
  services --> registry["src/registry: products, sources, hosts"]
  versions --> registry
  adapters --> render["src/render + src/extract: structured renderers, HTML pipeline"]
  adapters --> gateway["src/net: HTTP gateway, GitHub client"]
  versions --> gateway
  gateway --> policy["src/policy: allow-list, capabilities, robots"]
  gateway --> cache["src/cache: disk and memory"]
  gateway --> upstream["Esri documentation hosts, GitHub, package registries"]
  workspace["src/workspace: project manifests"] --> versions
  core["src/core: types, ports, errors, budget, cursor, url"]
```

Every box depends on `src/core`; the arrows show who calls whom at run time.

| Directory | Responsibility |
|---|---|
| `src/core` | Domain types, the interfaces between packages (`ports.ts`), factory signatures, errors, token budget, cursors, URL helpers. Pure: no I/O |
| `src/registry` | The product registry as typed data: ids, aliases, sources, version lines, hosts. Resolution of free-text product names and of URLs to their owning source |
| `src/policy` | Which hosts and paths may be requested under the current capabilities; robots rules |
| `src/net` | The HTTP gateway (the only code that calls `fetch`) and the GitHub client |
| `src/cache` | Disk cache for responses and derived data, memory LRU for loaded indexes |
| `src/extract` | HTML to Markdown: family detection, slicing, clean-up passes, Turndown |
| `src/render` | Structured renderers: OpenAPI, TypeDoc, Custom Elements Manifest, DocC, Sphinx, C# XML documentation, TypeScript declarations, Arcade, Markdown, notebooks, sample bundles |
| `src/adapters` | One adapter per kind of source. `enumerate` lists a source into catalogue records, `read` returns one document, `symbol` and `sample` return one entity, `probe` is a canary |
| `src/services` | The six use cases behind the tools, plus the index service that builds and persists per-source search indexes |
| `src/versions` | Version oracles and the version report |
| `src/workspace` | Detection of Esri SDK versions in the user's project (manifests only) |
| `src/mcp` | Tool, resource and prompt registration; envelopes and error rendering |
| `src/cli` | The binary: argument parsing and the commands |
| `src/app` | The composition root |

## Import rules

ESLint (`eslint.config.mjs`, `no-restricted-imports` per directory) enforces:

1. `src/core` imports nothing outside `src/core` except `zod`.
2. Every other package imports only from `src/core` and from itself. Cross-package calls go
   through the `Ctx` object or a service interface.
3. Only `src/app/composition-root.ts` imports the concrete factories.
4. Adapters and services never call `fetch`, `fs` or `process.env`; they use `ctx.http`,
   `ctx.cache` and `ctx.config`.
5. Named exports only.

The effect is that an adapter can be written and tested against fakes
(`test/support`) without any other package existing.

## Request flow

```
tool handler  ->  service
  search:  registry.resolve | route -> index.ensure(product, sources, line) -> index.query -> rank -> presenter
  read:    splitRef -> policy.check -> registry.ownerOf(url) -> adapter.read -> view + budget -> presenter
  lookup:  resolve product -> index.ensure(symbol sources) -> exact / prefix / fuzzy -> adapter.symbol -> presenter
  samples: resolve product -> index.samples -> rank -> adapter.sample (metadata, code) -> presenter
```

A tool call owns a request budget (12 upstream requests, 25 seconds). Index builds have their
own budget and continue in the background when a call's deadline passes; the response then
says which source was not searched yet. Nothing is fetched before the MCP handshake, and
nothing is fetched except as a consequence of a tool call or a CLI command.

## The HTTP gateway

`src/net/http-client.ts` is the single choke point for outbound traffic:

```
policy.check(url)        allow-list, capability, compiled robots rules, live robots.txt (24 h, adds denials only)
 -> offline?             cache only
 -> single-flight        one request per (method, URL, body)
 -> cache                fresh entry answers
 -> budget, breaker      over budget or open breaker: stale copy or UPSTREAM_UNAVAILABLE
 -> rate limiter         token bucket and semaphore per host, global concurrency cap
 -> fetch                manual redirects; every hop is checked against the policy again
 -> validate             content type and shape; HTML where JSON was expected is a miss
 -> meta-refresh         followed like a redirect, with a loop guard
 -> store                size cap enforced while streaming
```

Failures map to a small error catalogue (`src/core/errors.ts`): `DOC_NOT_FOUND`,
`UPSTREAM_BLOCKED` (403 and 429 are never retried or worked around), `UPSTREAM_UNAVAILABLE`,
`OFFLINE_MISS` and so on. A stale cached copy younger than 30 days is served, labelled
`stale`, when the upstream fails.

## Registry model

```
Product -> sources[] -> { adapter, config, capability, probe, floor }
        -> lines[]      version lines ("latest", "v200")
        -> oracles[]    where its version facts come from
```

Every product has exactly one **floor source**: a simple source (a sitemap, a static list, a
GitHub repository) that keeps the product reachable when a richer source breaks. The registry
is data only: ids, URLs, patterns and adapter configuration. Hashed file names are never
stored; adapters discover them at run time.

## Degradation ladders

Each capability has rungs, and a result says which rung answered when it is not the first.

| Capability | Rung 1 | Rung 2 | Rung 3 | Last resort |
|---|---|---|---|---|
| Enumerate a source | native index file | sitemap or navigation of one page | previous snapshot | registry start-here links |
| Search | catalogue, symbol and body indexes | plus site search when enabled | stale snapshot | product card with entry links |
| Content | structured renderer | HTML family profile | generic extractor | stale rendering, else a link |
| Version | package registry | page banner or sitemap | static registry value with its date | "unknown" plus the release-notes ref |

A rebuilt index replaces the previous one only when it is not much smaller (the swap rule),
so a broken upstream index cannot replace a good local one.

## Search

One catalogue index per `(product, source, line)`, built on first use from the adapter's
`enumerate()` and persisted as a compressed snapshot. MiniSearch ranks over symbol, title,
qualified name, headings, keywords, description and breadcrumb. A symbol side table answers
exact-name lookups. Pages the agent has already read contribute their section text to a
per-product body index. There is no full-text crawl; see the limitations in the README.

## Output

Every text result has the same envelope: a status line (resolved product, version, kind,
cache state), the body, at most one `Next:` line with a complete follow-up call, and a
`Source:` line whose wording depends on the licence tier of the content. Text is cut only at
section, paragraph, fence or table boundaries. `read` and `lookup_symbol` return text only;
the other four tools also return `structuredContent` that conforms to their `outputSchema`.

## Decisions

The reasons behind the main choices are recorded as ADRs in [docs/adr](adr).
