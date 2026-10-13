# Fixtures of the github-repo adapter

Every file below this directory is synthetic: it was written for these tests and only
replicates the *structure* of the repositories the adapter reads (directory layout, file
names, metadata keys, region directives, sidebar link forms, notebook format). No file is a
copy of Esri content, and the sample names, prose and code are invented.

Each sub-directory is the working tree of one imaginary repository and is loaded into
`FakeGithub` by `test/adapters/reference/github/support.ts`:

| Directory | Preset | Replicates |
| --- | --- | --- |
| `samples-swift` | `samples-metadata` | `Shared/Samples/<Title With Spaces>/` with `README.md`, `README.metadata.json`, sources |
| `samples-dotnet` | `samples-metadata` | per-platform trees, a category level, lower-case `readme.md` |
| `samples-pro` | `samples-readme` | `<Area>/<Sample>/ReadMe.md` next to a project, no metadata |
| `snippets` | `snippets-region` | `#region` snippets with `// cref:` lines, groups and ignored set-up regions |
| `wiki` | `wiki` | `_Sidebar.md` link forms, a page kept in a sub-directory |
| `notebooks` | `notebooks` | nbformat 4 notebooks in numbered directories |
| `docs` | `markdown-docs` | README, versioned Markdown with one heading per type, a `.proto` schema |
