# Agent evaluations

Twenty-five multi-step developer questions, a runner that lets a model answer them with the
server's tools, and a scorer. They measure what the unit tests cannot: whether an agent
reaches a correct, cited answer, and at what cost in tool calls and tokens.

The evaluations are **manual**. They call a paid model API and fetch documentation from the
live sites, so they are not part of `npm test` or CI. Run them before a release and when a
change touches tool descriptions, the server instructions, ranking or budgets.

## Running

```sh
npm run build
export ANTHROPIC_API_KEY=...            # or sign in with `ant auth login`
npx tsx evals/run.ts --out evals/results.jsonl
```

| Option | Default | Meaning |
|---|---|---|
| `--only id,id` | all | Run the named tasks |
| `--model` | `claude-opus-5-5` | Model under evaluation |
| `--effort` | `high` | `low`, `medium`, `high`, `xhigh` or `max` |
| `--max-turns` | `12` | Model requests allowed per task |
| `--sources` | the server default | Value for `ARCGIS_DOCS_SOURCES`, for example `standard,+site-search` |
| `--out` | none | Write one JSON line per task, including the final answer |
| `--list` | | Print the tasks and exit; needs no credentials |

The runner starts `dist/cli/main.js` over stdio, passes its instructions and tool list to
the model unchanged, and runs each tool call through the server. It exits with status 1 when
a task fails.

A full run is 25 conversations of several turns each, so it costs real money: try two or
three tasks with `--only` first and read the token totals in the summary line before running
the whole set. The tool list and the instructions are cached between turns. The first run
against a cold documentation cache also builds the search indexes of about a dozen products
and is slower.

## Tasks

`tasks.jsonl` holds one task per line:

```json
{"id":"rest-query-pagination","prompt":"How do I page through ...","facts":["resultOffset","resultRecordCount"],"tools":["arcgis_docs_lookup_symbol"]}
```

- `facts`: case-insensitive regular expressions the final answer must match, all of them.
  They are identifiers and terms that any correct answer contains, chosen to stay true
  across releases (no version numbers).
- `tools` (optional): the agent must call at least one of these. Used where the route
  matters, for example a version question must go through `arcgis_docs_get_versions`.
- `cite` (optional): overrides the default rule that the answer cites a URL on an Esri
  documentation host or an Esri GitHub repository.

The set covers the main products and every tool: JavaScript components and upgrades, REST
operations, Swift, Kotlin, .NET, Flutter, Qt, Python, ArcPy and geoprocessing tools, Arcade,
Calcite, Experience Builder, ArcGIS Pro SDK, authentication, version lines, retired products,
and one question about a method that does not exist.

## Scoring

A task passes when the run ended normally, every fact matched, the answer cites a source and
a required tool was used. Per task the runner also records the number of tool calls, tool
errors, model requests and tokens, which is what to compare between two versions of the
server:

- fewer tool calls and tokens for the same pass rate is an improvement;
- tool errors show descriptions or schemas that mislead the model;
- a task that passes without citing shows an answer from memory.

Pattern matching is a coarse grader. Read the answers in the output file for any task whose
result surprises you before drawing a conclusion, and treat a single run as one sample: model
output varies between runs.

## Design notes

- Refusal fallbacks are not enabled. A fallback would answer with another model than the one
  under evaluation; a refusal is recorded as the task's outcome instead.
- The server runs in the `evals/` directory, which has no package manifests, so project
  detection cannot steer the answers.
- Running the set twice, once with `--sources standard,+site-search`, shows what Esri's site
  search adds over the local index.
