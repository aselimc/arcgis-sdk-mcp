# Contributing

Thank you for helping. This document covers the working rules; the design itself is described
in [docs/architecture.md](docs/architecture.md). Code comments that cite "design section N",
"risk Rnn" or "INV-n" refer to the original design specification, which is not published;
[docs/architecture.md](docs/architecture.md#where-the-implementation-differs-from-the-first-design)
says how to read them.

## Set up

Node.js 22.12 or later (`.nvmrc` names the version CI uses).

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

`npm test` runs the unit project and never touches the network: a guard replaces `fetch`
and rejects every request that is not to loopback. `npm run test:e2e` builds, packs and runs
the packed binary over stdio. `npm run test:live` talks to the real hosts and is for manual
and scheduled runs only.

## Rules that are not negotiable

1. **No Esri-authored content in the repository.** Test fixtures are synthetic: they
   reproduce the structure of a page with our own prose. Files copied from Esri's Apache-2.0
   GitHub repositories are allowed only under `test/fixtures/oss/`, with the source URL,
   commit and licence in a provenance file beside them. Live recordings go to
   `test/fixtures/recorded/`, which is git-ignored. See
   [ADR-0006](docs/adr/0006-fixture-policy.md).
2. **Every upstream request goes through the gateway** (`src/net/http-client.ts`). No module
   calls `fetch` itself. The gateway applies the allow-list, the source policy, robots rules,
   the cache and the rate limit; bypassing it bypasses all of them.
3. **Nothing is fetched except as a consequence of a tool call or a CLI command.** No
   start-up requests, no background crawling, no telemetry.
4. **Layering.** `src/core` imports nothing from the other packages. Adapters, services and
   the MCP layer meet only through the interfaces in `src/core/ports.ts`; the only place that
   knows every implementation is `src/app/composition-root.ts`. ESLint enforces the import
   rules.
5. **A failed upstream is not an exception when a lower rung can answer.** Degrade, and say
   so in the result (`degraded: <reason>`).

## Code style

- Strict TypeScript, ESM, `.js` extensions in imports, named exports only.
- TSDoc on every exported symbol. Comments explain why, not what.
- Small files (about 300 lines), one concept per file.
- No `any` without a comment that justifies it; no `@ts-ignore`.
- `npm run format` (Prettier) before you push.

## Tests

Each layer has its own kind of test; [docs/testing.md](docs/testing.md) lists them. In short:

- a new HTML rule needs a synthetic fixture and a golden file under
  `test/fixtures/synthetic/html/<family>/`;
- a new adapter must pass the shared adapter contract suite against cassettes;
- a bug found against a live site is fixed together with a synthetic fixture that reproduces
  the markup that caused it.

## Common changes

- [Adding a product](docs/adding-a-product.md)
- [Adding an adapter](docs/adding-an-adapter.md)

After changing a brief or the help registry source, run `npm run gen`; CI fails when the
generated files are out of date. After changing a tool schema, run
`npx tsx scripts/gen-tools-doc.ts` to refresh `docs/tools.md`.

The coverage tables in `README.md` and [docs/products.md](docs/products.md) are a snapshot of
the registry. When you add, rename or retire a product, change its row in both.

Maintainers: [docs/releasing.md](docs/releasing.md) describes how a version is released.

## Pull requests

Keep them focused. State what you changed and how you checked it; the pull request template
lists the checks. If a change alters what is fetched from Esri's hosts (a new host, a new
kind of file, a higher request rate), say so in the description: such changes are reviewed
against [docs/source-policy.md](docs/source-policy.md). Add a line under "Unreleased" in
[CHANGELOG.md](CHANGELOG.md) when users can notice the change.

## Reporting upstream drift

Esri's documentation sites change. If a result is degraded or wrong, open an issue with the
"Wrong or degraded result" form: it asks for the tool call that failed, the URL of the page
and the output of `npx arcgis-sdk-mcp doctor --product <id>`. Please do not paste more of a
documentation page than the few lines that show the problem.

## Conduct and security

Participation is covered by the [code of conduct](CODE_OF_CONDUCT.md). Report a security
problem privately, as described in [SECURITY.md](SECURITY.md), not in an issue.
