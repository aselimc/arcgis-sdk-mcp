# Adding a product

A product is one entry of typed data in `src/registry/data/`. Adding one needs no new code
when an existing adapter can read its documentation.

## 1. Find out how the documentation is published

Before writing anything, look at the site:

- Which host is it on, and what does its `robots.txt` allow? A host that is not in
  `src/registry/hosts.ts` must be added there, with its rules, and that is a
  [source-policy](source-policy.md) change.
- Is there a sitemap (`sitemap-0.xml`, `sitemap.xml`)? A site-published index (a search
  file, a navigation JSON, a `toc.json`, an `objects.inv`, an `xrefmap.yml`)?
- Which page family does a typical page belong to? `arcgis-sdk-mcp call read '{"ref":"<url>"}'`
  shows what the generic extractor makes of it; `doctor --product <id>` names the family once
  the product exists.
- Is there a public repository with samples, and what is its licence?
- Where does the current version come from: a package registry, a page banner, a release
  tag?

## 2. Write the entry

Pick the data file of the product's category (`web.ts`, `native.ts`, `python.ts`,
`desktop-enterprise.ts`, `rest-services.ts`, `ai.ts`, `specs.ts`, `devops-oss.ts`,
`support.ts`, `legacy.ts`). The shape is `Product` in `src/core/types.ts`:

```ts
{
  id: 'tide-sdk',                       // lower-case, hyphenated, globally unique
  name: 'ArcGIS Tide SDK',
  aliases: ['tide', '@arcgis/tide'],    // names, abbreviations, package names; globally unique
  category: 'web',
  status: 'active',
  tier: 'developer',
  summary: 'One sentence in this project\'s own words.',
  keywords: ['tides', 'harbour charts'],
  languages: ['typescript'],
  homepage: 'https://developers.arcgis.com/tide/',
  packages: [{ registry: 'npm', name: '@arcgis/tide' }],
  repos: [],
  lines: [{ id: 'latest', label: 'Current', current: true, access: 'live', vars: {} }],
  sources: [
    {
      id: 'guide',
      title: 'Guide',
      kinds: ['guide', 'tutorial'],
      adapter: 'astro',
      config: { base: '/tide/', sitemap: 'sitemap-0.xml' },
      capability: 'website',
      floor: true,
      pagesApprox: 120,
      probe: { url: '/tide/sitemap-0.xml', expect: 'xml', minRecords: 60 },
    },
  ],
  oracles: [
    {
      type: 'npm-dist-tags',
      options: { package: '@arcgis/tide' },
      provides: ['installable', 'prerelease'],
    },
  ],
  startHere: [{ title: 'Get started', ref: 'https://developers.arcgis.com/tide/get-started/' }],
  pitfalls: ['At most four one-liners an agent should know before writing code.'],
  related: ['js-maps-sdk'],
  licenseTier: 'esri-website-terms',
  verifiedOn: '2026-10-13',
}
```

The data files contain helper functions for recurring shapes (a native SDK with two version
lines, a GitHub-only product, a mapping-library guide); use them where they fit.

Rules the registry tests enforce:

- **Exactly one floor source** per product, on a simple adapter (`astro`, `gatsby`,
  `docfx-esri`, `legacy-help`, `sitemap`, `github-repo`, `static`, `openapi`, `brief`).
- Every URL host is in the hosts table; GitHub owners are `Esri`, `R-ArcGIS` or `koopjs`.
- Every source has a `probe`: one cheap request that proves the source is alive, with a
  floor for the number of records (about half of the count you observed).
- Ids and aliases are unique across the registry; `related` and `successor` resolve; exactly
  one line is `current`.
- No URL contains a build hash, and every regular expression compiles.
- Text fields are this project's wording. Do not paste product descriptions from Esri.

## 3. Check it

```sh
npm run registry:check                    # offline lint of the whole registry
npx vitest run test/registry              # schema and invariants
npm run build
node dist/cli/main.js doctor --product tide-sdk
node dist/cli/main.js call list_products '{"product":"tide-sdk","section":"guide"}'
node dist/cli/main.js call search '{"query":"harbour chart","product":"tide-sdk"}'
```

`doctor` runs the probes through the normal gateway. A probe that fails here will fail in the
weekly canary.

## 4. Tests

Add the product to the alias-resolution and router tables in `test/registry/` when it
introduces names that could collide with existing ones ("maps", "sdk", a shared package
scope), and to the URL ownership table when its URLs share a prefix with another product.

## 5. Documentation

Add the product to the coverage tables in `README.md` and [products.md](products.md), and
name it under "Unreleased" in `CHANGELOG.md`.

## Product help sites

The end-user help entries (`category: 'product-help'`) are generated. Edit
`scripts/data/help-registry.source.json` and run `npm run gen`; do not edit
`help.generated.ts`.
