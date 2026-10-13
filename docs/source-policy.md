# Source policy

This document states what the server reads, from where, and why the defaults are what they
are. It is written for users deciding whether the tool fits their obligations, and for
contributors proposing a new source. It is not legal advice.

## Principles

1. **Public documentation only.** No sign-in, no API key, no content behind a licence gate.
2. **On demand.** A request to an upstream host happens only because a user's agent called a
   tool or a person ran a CLI command. There is no crawl, no scheduled refresh and no request
   at start-up.
3. **Per-user cache.** Responses are cached on the user's machine to avoid repeated requests.
   The cache is not shared and is not redistributed.
4. **Nothing Esri-authored is shipped.** The repository and the npm package contain the
   registry (ids, URLs, patterns), this project's own briefs, and code. A release gate
   (`scripts/check-package-contents.ts`) fails the build otherwise.
5. **Attribution on every result.** Each result ends with a source line naming the URL, the
   retrieval date and the rights holder, in the wording that fits the licence of the content.
6. **Refusals are final.** A `403` or `429` is reported, never retried and never worked
   around. `robots.txt` is honoured.
7. **One switch per source class.** Each class of source is a named capability that can be
   turned off.

## Being a considerate client

- User-Agent: `arcgis-sdk-mcp/<version> (+https://github.com/aselimc/arcgis-sdk-mcp)` on
  every request, so a host operator can identify and contact the project.
- Rate: at most two requests per second and two concurrent requests per host, four
  concurrent requests overall. A tool call may issue at most 12 upstream requests.
- Robots: compiled rules for every allow-listed host, plus the live `robots.txt` read once
  per host per day. The live file can only add restrictions.
- Conditional requests: cached entries are revalidated with `If-None-Match` /
  `If-Modified-Since` where the host supports them.
- Circuit breaker: five failures within a minute stop requests to a host for five minutes.
- Hosts that disallow automated access are link-only: the server returns the URL and never
  fetches it. These are Esri's archive of older documentation
  (`archive.developers.arcgis.com`) and the ArcMap help (`desktop.arcgis.com`).
- A host that asks for a crawl delay gets it: `hub.arcgis.com` is requested at most once a
  minute.

## Capabilities and their defaults

| Capability                    | Default                    | Reasoning                                                                                                                                                                                                                         |
| ----------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `github`                      | on in every preset         | Public repositories under open-source licences, read through GitHub's API. The licence of each repository is read at run time and decides the source line                                                                         |
| `registries`                  | on in every preset         | Version metadata that package registries publish for exactly this purpose (npm, PyPI, NuGet, pub.dev), and the version ArcGIS Online reports about itself                                                                         |
| `local-packages`, `workspace` | on in every preset (stdio) | Files already on the user's machine                                                                                                                                                                                               |
| `website`                     | on in `standard`           | Fetching a public documentation page a user asked for is what a browser does, and sitemaps are published for automated readers. It is still automated access; see the caveat below                                                |
| `site-index`                  | on in `standard`           | Navigation, table-of-contents, search and symbol index files are published for the site's own scripts. The server reads titles, URLs and symbol names from them, not page text. Without them most API references cannot be listed |
| `package-cdn`                 | on in `standard`           | Single files of Esri's npm packages at a pinned version. These packages are public on npm without a licence-acceptance step, but their content is licensed under the Esri Master License Agreement, and the source line says so   |
| `site-search`                 | off                        | An undocumented backend of Esri's site search. Opt-in                                                                                                                                                                             |
| `lifecycle-api`               | off                        | An undocumented backend of Esri's life-cycle pages. Opt-in                                                                                                                                                                        |

## What `strict` looks like

With `ARCGIS_DOCS_SOURCES=strict` nothing is requested from Esri's documentation hosts. The
GitHub sources, version metadata and the local project still answer, and every result says
what was left out:

```text
$ ARCGIS_DOCS_SOURCES=strict arcgis-sdk-mcp call search '{"query":"download offline map","product":"swift-maps-sdk","limit":2}'
Search "download offline map" | products: swift-maps-sdk, resolved from "swift-maps-sdk" | line: latest | mode: local index (site search off) | hits 1-2 of 26
Note: not searched: swift-maps-sdk/guide: capability "website" is switched off
Note: not searched: swift-maps-sdk/api: capability "website" is switched off
Note: not searched: swift-maps-sdk/toolkit-api: capability "website" is switched off

1. Generate offline map [sample] swift-maps-sdk/samples 300.1
   https://github.com/Esri/arcgis-maps-sdk-swift-samples/blob/v300.1.0/Shared/Samples/Generate%20offline%20map/README.md
[...]

$ ARCGIS_DOCS_SOURCES=strict arcgis-sdk-mcp call read '{"ref":"https://developers.arcgis.com/javascript/latest/get-started/"}'
Error [SOURCE_DISABLED]: developers.arcgis.com needs capability "website". Capability "website" is switched off (preset strict). Next: Set ARCGIS_DOCS_SOURCES=strict,+website and restart the server.
```

## The caveat

Esri's website terms of use restrict automated access to its sites and the inclusion of its
content in AI tools. Those clauses can be read to cover any documentation retrieval tool,
this one included. In addition, `site-index` and `package-cdn` enable two source classes that
a strictly cautious reading would leave off.

The project's position is that retrieving a public documentation page at a person's request,
for that person, with attribution and without redistribution, is a reasonable use. That
position has not been confirmed by Esri. Therefore:

- The README states this plainly.
- `ARCGIS_DOCS_SOURCES=strict` restricts the server to GitHub, package registries and the
  local project, and every capability can be switched off individually.
- Running a public, shared or paid instance is outside what this project considers
  reasonable without Esri's written permission.
- If Esri asks for a source to be removed or a default to change, it will be.

## Hosts

The allow-list is `src/registry/hosts.ts`; a URL on any other host is refused with
`HOST_NOT_ALLOWED`, including a redirect target.

| Capability      | Hosts                                                                                                                                                                                                                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `website`       | `developers.arcgis.com`, `location.arcgis.com`, `doc.esri.com`, `doc.arcgis.com`, `pro.arcgis.com`, `enterprise.arcgis.com`, `support.esri.com` (knowledge base only), `esri.github.io`, `koopjs.github.io`, `r.esri.com`, and the published OpenAPI documents of `hub.arcgis.com` and `sitescan-api.arcgis.com` |
| `site-index`    | The same hosts: the index files those sites publish for their own search and navigation. It has an effect only together with `website`                                                                                                                                                                           |
| `github`        | `api.github.com`, `raw.githubusercontent.com` (owners `Esri`, `R-ArcGIS`, `koopjs`)                                                                                                                                                                                                                              |
| `package-cdn`   | `cdn.jsdelivr.net`, `data.jsdelivr.com` (packages `@arcgis/*`, `@esri/*`, `esri-leaflet*`)                                                                                                                                                                                                                       |
| `registries`    | `registry.npmjs.org` (the same packages), `pypi.org`, `api.nuget.org`, `pub.dev`, `www.arcgis.com/sharing/rest`                                                                                                                                                                                                  |
| `site-search`   | `esearchapi.esri.com`                                                                                                                                                                                                                                                                                            |
| `lifecycle-api` | `plc-api.esri.com`                                                                                                                                                                                                                                                                                               |
| none: link-only | `archive.developers.arcgis.com`, `desktop.arcgis.com`                                                                                                                                                                                                                                                            |

## What is deliberately not done

- No bulk download of documentation sets, package archives or index dumps for redistribution.
- No requests to hosts whose `robots.txt` disallows all automated access.
- No scraping of Esri Community or the ArcGIS Blog.
- No calls to ArcGIS services, and no use of a user's ArcGIS credentials.
- No remote configuration: registry fixes ship as releases, not as a file fetched at run time.

## Adding a source

A pull request that adds a host, a new kind of file or a higher request rate must state:
the host and its `robots.txt` rules, the licence of the content, which capability it belongs
to, the number of requests an enumeration costs, and how it is attributed. See
[adding-an-adapter.md](adding-an-adapter.md).
