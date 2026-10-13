# arcgis-sdk-mcp

An unofficial [Model Context Protocol](https://modelcontextprotocol.io) server that gives
coding agents on-demand access to Esri's public ArcGIS developer documentation: guides, API
references, REST specifications, samples, release notes and version facts.

> **Not affiliated with Esri.** This is an independent open-source project. It ships no Esri
> documentation: pages are fetched from Esri's public sites when your agent asks for them,
> cached on your machine, and returned with a source line. See
> [Sources and terms](#sources-and-terms) before you use it.

## Why

ArcGIS APIs change with every release (JavaScript 4.x widgets became 5.x components; the
native SDKs moved from 200.x to 300.x), so what a model remembers is often out of date. This
server lets the agent check the current documentation instead of guessing:

- **Version aware.** It reports the version the documentation describes, the version a package
  manager installs, and the version found in your project, and says when they differ.
- **Small answers.** Every result is token-budgeted. A long page comes back as its opening
  section plus an outline, and one more call reads the section you need.
- **One handle.** A document reference is its URL. The agent can pass back any Esri
  documentation URL it meets in code, an error message or a search result.
- **Honest about gaps.** "Not found" is reported as "not verified", degraded answers say why,
  and every result names its source and retrieval date.

## Tools

| Tool                        | What it does                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| `arcgis_docs_list_products` | Lists products, describes one, or returns the table of contents of one documentation source |
| `arcgis_docs_get_versions`  | Current, installable and project versions, compatibility pairings, release-notes refs       |
| `arcgis_docs_search`        | Ranked hits over guides, API members, REST operations, samples and product help             |
| `arcgis_docs_read`          | One page, API reference page, sample, GitHub file or brief as clean Markdown                |
| `arcgis_docs_lookup_symbol` | Declaration and documentation of one class, method, component, REST operation or tool       |
| `arcgis_docs_find_samples`  | Runnable samples from Esri's sample pages and Apache-2.0 sample repositories                |

All six are read-only. The full argument and result schemas are in [docs/tools.md](docs/tools.md).
The server also offers four prompts (`arcgis_app_kickoff`, `arcgis_upgrade_review`,
`arcgis_agentic_app_design`, `arcgis_project_instructions`) and four resources under
`arcgis-docs://` (catalog, product profile, briefs, status).

Coverage: about 50 developer products (ArcGIS Maps SDK for JavaScript, Calcite, Arcade, REST
APIs, ArcGIS REST JS, ArcGIS API for Python, ArcPy, ArcGIS Pro SDK, the native Maps SDKs for
.NET, Kotlin, Swift, Flutter, Qt and Java, Unity and Unreal Engine, Experience Builder,
Enterprise SDK and more) plus about 110 end-user help sites, which are listed under the
category `product-help`.

## Install

Requires Node.js 22.12 or later.

```sh
npx -y arcgis-sdk-mcp --version
```

### Claude Code

```sh
claude mcp add arcgis-docs -- npx -y arcgis-sdk-mcp
```

### Any MCP host (`.mcp.json`, Claude Desktop, Cursor, VS Code)

```json
{
  "mcpServers": {
    "arcgis-docs": {
      "command": "npx",
      "args": ["-y", "arcgis-sdk-mcp"]
    }
  }
}
```

On Windows some hosts cannot start the `npx` shim directly. Use
`"command": "cmd"` with `"args": ["/c", "npx", "-y", "arcgis-sdk-mcp"]`; see
[.mcp.json.example](.mcp.json.example).

### HTTP

```sh
npx -y arcgis-sdk-mcp --http --port 3333
```

Serves MCP at `http://127.0.0.1:3333/mcp` (health check at `/healthz`). It binds to loopback
and validates the `Host` and `Origin` headers; any other `--host` needs `--allow-remote`.
Project detection and local package reads are off in HTTP mode. Operating a shared or public
instance needs Esri's permission (see below).

## Use

The server tells the agent how to use it, so there is nothing to configure in a prompt. A
typical exchange:

1. `arcgis_docs_get_versions({})` reports the Esri SDKs found in the project.
2. `arcgis_docs_lookup_symbol({"symbol":"FeatureLayer.queryFeatures"})` returns the signature,
   parameters and an example for the installed product.
3. `arcgis_docs_search({"query":"cluster points with popups","product":"js-maps-sdk"})` finds
   the guide, and `arcgis_docs_read({"ref":"<url>","section":"<id>"})` reads the part needed.
4. `arcgis_docs_find_samples({"query":"offline map download","product":"kotlin-maps-sdk"})`
   finds runnable code.

You can run any tool from a terminal, which is also the quickest way to see what an agent
would get:

```sh
npx arcgis-sdk-mcp call lookup_symbol '{"symbol":"arcpy.da.SearchCursor"}'
npx arcgis-sdk-mcp call read '{"ref":"https://developers.arcgis.com/javascript/latest/get-started/"}'
```

Other commands: `doctor` (configuration, cache, proxy and upstream checks), `cache info`,
`cache clear`, `warm <product...>` (builds search indexes ahead of time), `--help`.

## Configuration

Everything is set through environment variables; none is required.

| Variable                   | Default                  | Meaning                                                                                 |
| -------------------------- | ------------------------ | --------------------------------------------------------------------------------------- |
| `ARCGIS_DOCS_SOURCES`      | `standard`               | A preset (`strict` or `standard`) and/or `+capability` / `-capability`, comma separated |
| `ARCGIS_DOCS_OFFLINE`      | off                      | `1` answers from the cache only                                                         |
| `ARCGIS_DOCS_CACHE_DIR`    | per-user cache directory | Where responses and indexes are cached                                                  |
| `ARCGIS_DOCS_CACHE_MAX_MB` | `500`                    | Size cap of the cache                                                                   |
| `ARCGIS_DOCS_PROJECT_DIR`  | working directory        | Project in which SDK versions are detected                                              |
| `ARCGIS_DOCS_MAX_TOKENS`   | `6000`                   | Default size of a tool result                                                           |
| `ARCGIS_DOCS_LOG_LEVEL`    | `warn`                   | `debug`, `info`, `warn`, `error` or `silent`; logs go to stderr                         |
| `GITHUB_TOKEN`             | none                     | Raises the GitHub API quota from 60 to 5,000 requests per hour                          |

Details, including proxies, are in [docs/configuration.md](docs/configuration.md).

## Sources and terms

The server reads only public documentation, and only as a consequence of a tool call. Nothing
is fetched at start-up, nothing is crawled, and nothing Esri-authored is part of this
repository or the npm package.

| Capability       | `strict` | `standard` | Covers                                                                      |
| ---------------- | -------- | ---------- | --------------------------------------------------------------------------- |
| `github`         | on       | on         | Esri's public repositories through the GitHub API and raw file host         |
| `registries`     | on       | on         | Version metadata from npm, PyPI, NuGet and pub.dev                          |
| `local-packages` | on       | on         | Esri packages already installed in your project's `node_modules`            |
| `workspace`      | on       | on         | Names and versions in your project's package manifests                      |
| `website`        | off      | on         | Pages on Esri's documentation hosts, published OpenAPI documents            |
| `site-index`     | off      | on         | Sitemaps, navigation files and the sites' own search and symbol index files |
| `package-cdn`    | off      | on         | Single files of Esri npm packages at a pinned version from jsDelivr         |
| `site-search`    | off      | off        | Esri's site search service (opt-in)                                         |
| `lifecycle-api`  | off      | off        | Esri's product life-cycle service (opt-in)                                  |

What the server does to be a considerate client: one identifying User-Agent with this
repository's URL, `robots.txt` honoured (compiled rules plus a daily live check that can only
add restrictions), at most two requests per second per host, responses cached on disk with
conditional revalidation, an allow-list of hosts that is re-checked on every redirect, and a
source line with the URL on every result.

**Please read this before relying on it.** Esri's website terms restrict automated access
and the use of its content with AI tools, and can be read to cover a documentation retrieval
tool such as this one. The default preset also reads two kinds of files a cautious reading
would leave off: index files the sites publish for their own search, and files of Esri npm
packages (licensed under the Esri Master License Agreement) from a public CDN. This project
believes on-demand, attributed, per-user retrieval of public documentation is reasonable,
but that is not legal advice and it is not Esri's permission. You decide whether your use is
acceptable under [Esri's terms](https://www.esri.com/en-us/legal/overview):

- `ARCGIS_DOCS_SOURCES=strict` limits the server to GitHub, package registries and your own
  project.
- Each capability can be switched off by name, for example `ARCGIS_DOCS_SOURCES=-package-cdn`.
- Do not operate a public or paid instance without Esri's permission.

The reasoning is recorded in [docs/source-policy.md](docs/source-policy.md) and
[ADR-0002](docs/adr/0002-site-index-and-package-cdn-defaults.md).

## How it works

```
MCP host ── stdio / HTTP ──> tools ──> services ──> adapters ──> HTTP gateway ──> Esri hosts
                                          │            │              │
                                       registry    renderers     policy, cache
```

A typed registry describes every product as a list of sources; each source names an adapter
(Astro site, Gatsby site, DocC, Dokka, Sphinx, npm typings, GitHub repository and so on).
Adapters enumerate a source into a local search index and turn a page into Markdown through
structured renderers or an HTML pipeline. Every request leaves through one gateway that
applies the source policy, the cache, rate limits and a circuit breaker. See
[docs/architecture.md](docs/architecture.md).

## Development

```sh
npm ci
npm run typecheck && npm run lint && npm test
npm run build
node dist/cli/main.js doctor --product js-maps-sdk
```

Tests never touch the network. [CONTRIBUTING.md](CONTRIBUTING.md) explains the layout, the
fixture policy and how to add a product or an adapter.

## Limitations

- Search is local: it matches titles, headings, keywords, descriptions and symbol names, plus
  the text of pages already read. A phrase that occurs only in the body of an unread page is
  not found.
- Documentation sites describe the current release. For an older JavaScript SDK version the
  server reads the package's TypeScript declarations instead of pages.
- Unauthenticated GitHub access is limited to 60 requests per hour; set `GITHUB_TOKEN` when
  you use samples heavily.
- Esri's sites change. When a page layout or an index file moves, results degrade to a
  simpler source and say so; `arcgis-sdk-mcp doctor` shows what is affected.

## Licence

Apache-2.0 for this project's code; see [LICENSE](LICENSE) and [NOTICE](NOTICE). Esri, ArcGIS
and related names are trademarks of Esri. Documentation returned by the server remains the
property of Esri or its respective authors.
