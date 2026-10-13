# Configuration

The server is configured through environment variables, set in the MCP host's server entry
(the `env` object of `.mcp.json` and similar files) or in the shell. None is required.

```json
{
  "mcpServers": {
    "arcgis-docs": {
      "command": "npx",
      "args": ["-y", "arcgis-sdk-mcp"],
      "env": {
        "ARCGIS_DOCS_SOURCES": "standard,-package-cdn",
        "ARCGIS_DOCS_PROJECT_DIR": "/path/to/your/project"
      }
    }
  }
}
```

## Variables

| Variable                   | Default                  | Meaning                                                                                                               |
| -------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `ARCGIS_DOCS_SOURCES`      | `standard`               | Source policy; see below                                                                                              |
| `ARCGIS_DOCS_OFFLINE`      | off                      | `1` answers from the cache only. A document that is not cached fails with `OFFLINE_MISS`                              |
| `ARCGIS_DOCS_CACHE_DIR`    | per-user cache directory | Where responses and indexes are stored. `arcgis-sdk-mcp cache info` prints the path in use                            |
| `ARCGIS_DOCS_CACHE_MAX_MB` | `500`                    | Size cap. The least recently read entries are removed first                                                           |
| `ARCGIS_DOCS_PROJECT_DIR`  | working directory        | The project in which SDK versions are detected                                                                        |
| `ARCGIS_DOCS_MAX_TOKENS`   | `6000`                   | Size of an `arcgis_docs_read` result when the call does not choose `max_tokens`. A whole number from 500 to 20000     |
| `ARCGIS_DOCS_LOG_LEVEL`    | `warn`                   | `debug`, `info`, `warn`, `error` or `silent`. Logs are JSON lines on stderr; stdout carries only the MCP protocol     |
| `GITHUB_TOKEN`             | none                     | A GitHub token. No scopes are needed for public repositories. Raises the API quota from 60 to 5,000 requests per hour |

Notes:

- `ARCGIS_DOCS_OFFLINE` accepts `1`, `true`, `yes` or `on`, and `0`, `false`, `no` or `off`.
- The default cache directory is `%LOCALAPPDATA%\arcgis-sdk-mcp\Cache` on Windows,
  `~/Library/Caches/arcgis-sdk-mcp` on macOS and `$XDG_CACHE_HOME/arcgis-sdk-mcp` (usually
  `~/.cache/arcgis-sdk-mcp`) on Linux.
- `ARCGIS_DOCS_MAX_TOKENS` applies to `arcgis_docs_read` only. The tool's schema is the same
  in every configuration, so its `max_tokens` default stays 6000 in `tools/list`; a call that
  arrives with exactly that value is treated as "not chosen" and takes the configured size.
  `arcgis_docs_lookup_symbol` (3000) and `arcgis_docs_find_samples` (4000) keep their own
  defaults.
- An invalid value stops the server at start-up with a message on stderr that names the
  variable and what it accepts, and exit status 2.
- The list of tools and their schemas never change with the configuration.

## Source policy

`ARCGIS_DOCS_SOURCES` takes a preset name, any number of `+capability` / `-capability`
items, or both, separated by commas and applied left to right.

```
ARCGIS_DOCS_SOURCES=strict                 GitHub, registries and the local project only
ARCGIS_DOCS_SOURCES=strict,+website        the above plus page fetches
ARCGIS_DOCS_SOURCES=-package-cdn           standard without jsDelivr
ARCGIS_DOCS_SOURCES=standard,+site-search  standard plus Esri's site search
```

| Capability       | `strict` | `standard` | What it allows                                                                                   |
| ---------------- | -------- | ---------- | ------------------------------------------------------------------------------------------------ |
| `github`         | on       | on         | `api.github.com` and `raw.githubusercontent.com`, for repositories of Esri, R-ArcGIS and koopjs  |
| `registries`     | on       | on         | Version metadata from npm, PyPI, NuGet and pub.dev, and the version of ArcGIS Online             |
| `local-packages` | on       | on         | Reading Esri packages in the project's `node_modules` (stdio mode only)                          |
| `workspace`      | on       | on         | Reading names and versions from the project's package manifests (stdio mode only)                |
| `website`        | off      | on         | Pages and sitemaps on Esri's documentation hosts, and published OpenAPI documents                |
| `site-index`     | off      | on         | Navigation, table-of-contents, search and symbol index files the sites publish for their own use |
| `package-cdn`    | off      | on         | Single files of listed Esri npm packages at a pinned version from jsDelivr                       |
| `site-search`    | off      | off        | Esri's site search service; adds full-text hits to `arcgis_docs_search`                          |
| `lifecycle-api`  | off      | off        | Esri's product life-cycle service; adds life-cycle dates to `arcgis_docs_get_versions`           |

When a tool needs a capability that is off it either degrades or answers `SOURCE_DISABLED`,
naming the value that would enable it. A search names the sources it could not search.

What `-site-index` leaves: guide and help sites are still listed, from their sitemaps, with
titles derived from the URLs. API references that are listed only by an index file (the
Swift, Kotlin, Flutter and .NET references, the Python API inventory) are not listed at all,
so `arcgis_docs_lookup_symbol` finds nothing for them; a page whose URL is known can still be
read.

Index files live on the documentation hosts, so `site-index` has an effect only together
with `website`: `strict,+site-index` reads nothing more than `strict`.

`arcgis-sdk-mcp doctor` prints the effective policy, and so does the resource
`arcgis-docs://status`. [source-policy.md](source-policy.md) explains why the defaults are
what they are.

## Project detection

In stdio mode the server looks for Esri SDKs in the project directory: `package.json`,
`requirements*.txt`, `pyproject.toml`, `environment.yml`, `*.csproj`,
`Directory.Packages.props`, `pubspec.yaml`, Gradle files, `libs.versions.toml` and
`Package.resolved`. It reads package names and versions only, scans at most 200 manifest
files of at most 1 MB each in the directory and two levels below it, skips `node_modules`,
`.git` and build directories, and makes no request. A version range is reported by its lower
bound.

The detected products decide the default scope of a search and which product a bare symbol
name refers to, and `arcgis_docs_get_versions` with no arguments reports them. Set
`ARCGIS_DOCS_PROJECT_DIR` when the host starts the server outside the project, or switch
detection off with `ARCGIS_DOCS_SOURCES=-workspace`.

## Cache

Responses are cached on disk with the validators the host sent, and revalidated with
conditional requests. Lifetimes: pages and index files 24 hours; version facts and GitHub
content at a branch 6 hours; repository metadata and OpenAPI documents 7 days; files at a
pinned package version or Git tag one year; a "not found" answer one hour. When an upstream
fails, a cached copy younger than 30 days is served and the result is labelled `stale`.

Search indexes built from those responses are stored as "derived" entries beside them and
rebuilt when the files they came from change, or after 7 days at the latest.

```sh
arcgis-sdk-mcp cache info             # directory, size and number of entries
arcgis-sdk-mcp cache clear            # or: cache clear http | derived
arcgis-sdk-mcp warm js-maps-sdk arcpy # builds the search indexes ahead of the first call
```

`warm` reads index files only, never page bodies. With `ARCGIS_DOCS_OFFLINE=1` the server
answers from the cache alone, which makes a warmed cache usable without a connection for the
pages that were read before.

## GitHub quota

Sample repositories, release tags and repository metadata come from the GitHub API, which
allows 60 unauthenticated requests per hour per address. File contents come from the raw
file host and do not count. When the quota is used up, the affected call answers
`RATE_LIMITED_GITHUB` with the reset time. A token without any scope raises the quota to
5,000 requests per hour; it is sent only with requests to `api.github.com`.

## Proxies

The server uses Node's built-in `fetch`, which does not read `HTTPS_PROXY` by default. On a
Node version that supports it, set `NODE_USE_ENV_PROXY=1` together with `HTTPS_PROXY` in the
environment of the MCP host. `arcgis-sdk-mcp doctor` reports the proxy variables it sees and
whether the upstream hosts are reachable.

## HTTP mode

```sh
arcgis-sdk-mcp --http [--port 3333] [--host 127.0.0.1]
```

The endpoint is `/mcp`; `/healthz` answers a liveness check with the server name and
version. The server is stateless: each request is answered with one JSON response, and there
are no sessions or subscriptions. `Host` and `Origin` are validated for loopback use, which
keeps a web page in a browser on the same machine from reaching the server.

`--host` with a non-loopback address needs `--allow-remote`, prints a warning about Esri's
terms, and has no authentication: put it behind your own access control. `workspace` and
`local-packages` are always off in HTTP mode, so project detection does not apply there.

## Checking a setup

```sh
arcgis-sdk-mcp doctor                      # configuration, cache, proxy, GitHub quota, source probes
arcgis-sdk-mcp doctor --product arcpy      # one product
arcgis-sdk-mcp doctor --tier all --json    # every product, machine readable
```

Without `--product`, `doctor` probes the sources of the developer products at one request
per second or slower, which takes about a minute. It exits with status 1 when the floor
source of a developer product cannot be reached.

```sh
arcgis-sdk-mcp call search '{"query":"cluster points","product":"js-maps-sdk"}'
```

`call` runs one tool and prints the text an agent would receive. The tool name may be given
without its `arcgis_docs_` prefix. The exit status is 1 when the tool reports an error.
