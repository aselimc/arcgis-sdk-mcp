# Releasing

A release is a version tag. Pushing `v<version>` starts
[`.github/workflows/release.yml`](../.github/workflows/release.yml), which verifies the
repository, publishes the package to npm with provenance, publishes `server.json` to the MCP
Registry and creates the GitHub release from the changelog.

No release has been made yet, and the workflow has not run. Treat the first run as a test of
the workflow itself.

## One-time set-up

1. **npm.** Trusted publishing is configured per package on npmjs.com, and a package must
   exist before it can be configured. Publish the first version by hand from a clean
   checkout (`npm publish --access public`; `prepack` builds and runs the package content
   check). Provenance is not set in `publishConfig` because npm can only attest it from CI;
   the workflow passes `--provenance` itself. Then add this repository and the workflow file `release.yml` (environment `npm`)
   as a trusted publisher in the package settings. From then on the workflow publishes
   without a token. The workflow cannot publish a version that is already on npm, so for
   that first version also publish `server.json` by hand (`mcp-publisher login github`, then
   `mcp-publisher publish`) and create the GitHub release by hand. The workflow takes over
   with the second release.
2. **GitHub environment.** Create an environment named `npm` in the repository settings. Add
   required reviewers to it if a publish should wait for approval.
3. **MCP Registry.** The name `io.github.aselimc/arcgis-sdk-mcp` is in the `io.github.aselimc`
   namespace, which the workflow proves with GitHub OIDC (`mcp-publisher login github-oidc`).
   The registry checks that the npm package belongs to the server by reading `mcpName` from
   the published `package.json`; it must equal the `name` in `server.json`.
4. **Labels.** The issue forms use the labels `bug`, `upstream-drift` and `registry`. The
   canary workflow creates `upstream-drift` when it first needs it.
5. **Security reports.** Enable private vulnerability reporting (Settings, Code security),
   or the link in `SECURITY.md` and in the issue chooser leads nowhere for an outside
   reporter: `gh api -X PUT repos/aselimc/arcgis-sdk-mcp/private-vulnerability-reporting`.
6. **Repository page.** Set the description, homepage and topics that the link preview and
   the sidebar show, for example
   `gh repo edit aselimc/arcgis-sdk-mcp --description "<the package.json description>" --add-topic mcp,mcp-server,arcgis,esri,gis,documentation`,
   and create the two labels the issue forms assign:
   `gh label create registry --color 0E8A16` and
   `gh label create upstream-drift --color D93F0B`.

## Before the tag

1. Run the checks CI runs, and the ones it does not:

   ```sh
   npm ci
   npm run format:check && npm run lint && npm run typecheck
   npm run test:coverage
   npm run test:e2e
   node dist/cli/main.js doctor --tier developer
   ```

2. Run the agent evaluations and compare the summary line with the previous release
   ([evals/README.md](../evals/README.md)).
3. Refresh what is generated or recorded:
   - `npm run gen` (briefs and the help registry) and `npx tsx scripts/gen-tools-doc.ts`
     (`docs/tools.md`) must leave no diff;
   - the coverage tables in `README.md` and `docs/products.md` when products were added or
     retired;
   - the example output in `README.md` when the envelope or a presenter changed.
4. Set the version in three places, which the workflow compares with the tag: `version` in
   `package.json` (and `package-lock.json`, through `npm version --no-git-tag-version`), and
   both `version` fields in `server.json`.
5. Move the entries under "Unreleased" in `CHANGELOG.md` to a new `## [<version>] - <date>`
   section and update the link definitions at the end. The workflow fails without that
   section, and its text becomes the GitHub release notes.
6. Commit, tag and push:

   ```sh
   git tag v<version>
   git push origin main v<version>
   ```

## What the workflow does

| Job                | What it does                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| `verify`           | Checks that the tag, `package.json`, `server.json` and the changelog agree; runs lint, typecheck, unit and e2e |
| `publish-npm`      | `npm publish --provenance --access public` with an OIDC token; `prepack` runs the package content check        |
| `publish-registry` | Installs `mcp-publisher`, logs in with GitHub OIDC and publishes `server.json`                                 |
| `github-release`   | Creates the GitHub release with the changelog section of the version as its notes                              |

If `publish-registry` or `github-release` fails after the package is on npm, fix the cause
and re-run the failed job; do not move the tag. A version that reached npm is never
republished: release a patch version instead.

## After the release

- `npx -y arcgis-sdk-mcp@<version> --version` prints the new version.
- The package page on npmjs.com shows the provenance statement.
- The server appears in the MCP Registry under `io.github.aselimc/arcgis-sdk-mcp`.

## Scheduled checks

[`.github/workflows/canary.yml`](../.github/workflows/canary.yml) runs every Monday: `doctor`
for the developer products, a fresh recording of the live fixtures and the live suite. On
the first day of each month it also runs every source probe of the registry
(`npm run registry:check -- --live`). A failure opens or updates one issue labelled
`upstream-drift`; it never blocks a merge. See [testing.md](testing.md) for how to
reproduce a canary failure locally.
