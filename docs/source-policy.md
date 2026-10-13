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
  fetches it. Examples are Esri's archive of older documentation and the ArcMap help.

## Capabilities and their defaults

| Capability | Default | Reasoning |
|---|---|---|
| `github` | on in every preset | Public repositories under open-source licences, read through GitHub's API. The licence of each repository is read at run time and decides the source line |
| `registries` | on in every preset | Version metadata that package registries publish for exactly this purpose |
| `local-packages`, `workspace` | on in every preset (stdio) | Files already on the user's machine |
| `website` | on in `standard` | Fetching a public documentation page a user asked for is what a browser does. It is still automated access; see the caveat below |
| `site-index` | on in `standard` | Sitemaps are published for automated readers. Navigation, search and symbol index files are published for the site's own scripts; the server reads titles, URLs and symbol names from them, not page text |
| `package-cdn` | on in `standard` | Single files of Esri's npm packages at a pinned version. These packages are public on npm without a licence-acceptance step, but their content is licensed under the Esri Master License Agreement, and the source line says so |
| `site-search` | off | An undocumented backend of Esri's site search. Opt-in |
| `lifecycle-api` | off | An undocumented backend of Esri's life-cycle pages. Opt-in |

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
