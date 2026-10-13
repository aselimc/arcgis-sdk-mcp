# Configuration

The server is configured through environment variables, set in the MCP host's server entry
(the `env` object of `.mcp.json`) or in the shell. None is required.

## Variables

| Variable | Default | Meaning |
|---|---|---|
| `ARCGIS_DOCS_SOURCES` | `standard` | Source policy; see below |
| `ARCGIS_DOCS_OFFLINE` | off | `1` answers from the cache only. A document that is not cached fails with `OFFLINE_MISS` |
| `ARCGIS_DOCS_CACHE_DIR` | per-user cache directory | Where responses and indexes are stored. `arcgis-sdk-mcp cache info` prints the path in use |
| `ARCGIS_DOCS_CACHE_MAX_MB` | `500` | Size cap. The least recently read entries are removed first |
| `ARCGIS_DOCS_PROJECT_DIR` | working directory | The project in which SDK versions are detected |
| `ARCGIS_DOCS_MAX_TOKENS` | `6000` | Default size of a `read` result when the call does not pass `max_tokens` |
| `ARCGIS_DOCS_LOG_LEVEL` | `warn` | `debug`, `info`, `warn`, `error` or `silent`. Logs are JSON lines on stderr; stdout carries only the MCP protocol |
| `GITHUB_TOKEN` | none | A GitHub token. No scopes are needed for public repositories. Raises the API quota from 60 to 5,000 requests per hour |

An invalid value stops the server at start-up with a message that names the variable and what
it accepts.

## Source policy

`ARCGIS_DOCS_SOURCES` takes a preset name, any number of `+capability` / `-capability`
items, or both, separated by commas and applied left to right.

```
ARCGIS_DOCS_SOURCES=strict                 GitHub, registries and the local project only
ARCGIS_DOCS_SOURCES=strict,+website        the above plus page fetches
ARCGIS_DOCS_SOURCES=-package-cdn           standard without jsDelivr
ARCGIS_DOCS_SOURCES=standard,+site-search  standard plus Esri's site search
```

| Capability | `strict` | `standard` | What it allows |
|---|---|---|---|
| `github` | on | on | `api.github.com` and `raw.githubusercontent.com`, for repositories of Esri, R-ArcGIS and koopjs |
| `registries` | on | on | Version metadata from npm, PyPI, NuGet and pub.dev |
| `local-packages` | on | on | Reading Esri packages in the project's `node_modules` (stdio mode only) |
| `workspace` | on | on | Reading names and versions from the project's package manifests (stdio mode only) |
| `website` | off | on | Pages on Esri's documentation hosts and published OpenAPI documents |
| `site-index` | off | on | Sitemaps, navigation files, and the search and symbol index files the sites publish |
| `package-cdn` | off | on | Single files of listed Esri npm packages at a pinned version from jsDelivr |
| `site-search` | off | off | Esri's site search service; adds full-text hits to `arcgis_docs_search` |
| `lifecycle-api` | off | off | Esri's product life-cycle service; adds life-cycle dates to `arcgis_docs_get_versions` |

When a tool needs a capability that is off it either degrades (for example, without
`site-index` a source is listed from its sitemap with titles derived from the URLs) or
answers `SOURCE_DISABLED`, naming the value that would enable it. The list of tools never
changes with the configuration.

[source-policy.md](source-policy.md) explains why the defaults are what they are.

## Project detection

In stdio mode the server looks for Esri SDKs in the project directory: `package.json`,
`requirements*.txt`, `pyproject.toml`, `environment.yml`, `*.csproj`,
`Directory.Packages.props`, `pubspec.yaml`, Gradle files, `libs.versions.toml` and
`Package.resolved`. It reads package names and versions only, scans at most 200 files two
levels deep, and makes no request. A version range is reported by its lower bound.

The detected products decide the default scope of a search and which product a bare symbol
name refers to. Set `ARCGIS_DOCS_PROJECT_DIR` when the host starts the server outside the
project, or switch detection off with `ARCGIS_DOCS_SOURCES=-workspace`.

## Cache

Responses are cached on disk with the validators the host sent, and revalidated with
conditional requests. Typical lifetimes: pages and index files 24 hours; version facts 6
hours; files at a pinned package version or Git tag one year. When an upstream fails, a
cached copy younger than 30 days is served and the result is labelled `stale`.

```sh
arcgis-sdk-mcp cache info
arcgis-sdk-mcp cache clear            # or: cache clear http | derived
arcgis-sdk-mcp warm js-maps-sdk arcpy # builds the search indexes ahead of the first call
```

## Proxies

The server uses Node's built-in `fetch`, which does not read `HTTPS_PROXY` by default. On a
Node version that supports it, set `NODE_USE_ENV_PROXY=1` together with `HTTPS_PROXY`.
`arcgis-sdk-mcp doctor` reports the proxy variables it sees and whether the upstream hosts
are reachable.

## HTTP mode

```sh
arcgis-sdk-mcp --http [--port 3333] [--host 127.0.0.1]
```

The endpoint is `/mcp`; `/healthz` answers a liveness check. The server is stateless and
validates `Host` and `Origin` for loopback use. `--host` with a non-loopback address needs
`--allow-remote`, prints a warning about Esri's terms, and has no authentication: put it
behind your own access control. `workspace` and `local-packages` are always off in HTTP mode.

## Checking a setup

```sh
arcgis-sdk-mcp doctor                      # configuration, cache, proxy, GitHub quota, source probes
arcgis-sdk-mcp doctor --product arcpy      # one product
arcgis-sdk-mcp doctor --tier all --json    # every product, machine readable
```

`doctor` exits with status 1 when the floor source of a developer product cannot be reached.
