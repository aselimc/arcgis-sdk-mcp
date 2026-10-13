# Security policy

## Supported versions

Security fixes are made on the latest released version.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private reporting:
<https://github.com/aselimc/arcgis-sdk-mcp/security/advisories/new>.

Include what you observed, how to reproduce it, and the version (`arcgis-sdk-mcp --version`).
You can expect an acknowledgement within seven days.

## What the server does and does not do

Knowing the design helps when judging a report.

- **Read-only.** The six tools fetch and return documentation. They do not write files outside
  the cache directory, run commands, or call ArcGIS services on a user's behalf.
- **Outbound requests are allow-listed.** Every request goes through one gateway that accepts
  HTTPS URLs on a fixed list of hosts. Redirects are followed manually and each hop is checked
  against the list again, as are meta-refresh targets. A URL supplied by an agent that is not
  on the list is refused with `HOST_NOT_ALLOWED`.
- **Local reads are narrow.** In stdio mode the server reads package manifests in the project
  directory (names and versions only) and files of Esri packages under `node_modules`. Both
  are off in HTTP mode and can be switched off with `ARCGIS_DOCS_SOURCES`.
- **HTTP mode is local.** It binds to loopback and validates the `Host` and `Origin` headers.
  Binding elsewhere needs `--allow-remote`; there is no authentication, so do not expose it to
  an untrusted network.
- **Fetched text is untrusted.** Scripts, comments and hidden elements are removed before a
  page is converted to Markdown, and the server's instructions tell the agent that tool
  results are reference data, not instructions. A documentation page can still contain text
  that tries to steer a model; treat tool output as you would any web content.
- **Secrets.** `GITHUB_TOKEN`, when set, is sent only with requests to the GitHub API
  (`api.github.com`). It is not written to the log or to the cache.
- **No telemetry.** The server reports nothing to this project or anyone else.

Reports about these properties not holding (a way around the allow-list, a request that
leaks the token, a path that reads outside the project or cache directories, content that
survives sanitising and executes in a host) are exactly what this policy is for.
