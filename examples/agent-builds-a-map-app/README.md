# An agent builds a map app from the docs

[agent.ts](agent.ts) gives Claude the server's six tools and one `write_file` tool, and asks it
to build a small ArcGIS Maps SDK for JavaScript app: the earthquakes of the last 30 days from
the USGS GeoJSON feed, clustered and labelled with counts, with popups, a legend and a switch
for clustering. It must check the SDK version, the CDN URL and every API it uses with the
tools before it writes code, and list what it checked in `NOTES.md`.

It uses the Anthropic TypeScript SDK (`@anthropic-ai/sdk`): the beta tool runner drives the
loop, and the SDK's MCP helper (`mcpTools` from `@anthropic-ai/sdk/helpers/beta/mcp`) turns
the tools of an MCP client connected over stdio into runnable tools. The default model is
`claude-opus-5-5` with adaptive thinking at effort `high`, and server-side refusal fallbacks
on.

## Status: not run yet

**This example has not been run for this repository**: no Anthropic API key was available
when it was added. There is therefore no agent output in this directory, and nothing here
should be read as a result of the agent.

What was checked: the script type-checks, `--dry-run` starts the server and converts its six
tools plus `write_file`, and without credentials the script stops with a clear message
before any request.

In its place, [output/hand-checked/](output/hand-checked/) holds an app **written by hand**,
following the same rules the agent is given: every SDK fact comes from a tool call listed in
[output/hand-checked/NOTES.md](output/hand-checked/NOTES.md). It was opened in a headless
browser and drew the clustered earthquakes. It is labelled as hand-written in the file
itself.

## Run it

```sh
npm ci
npm run build
export ANTHROPIC_API_KEY=...          # or: ant auth login
export GITHUB_TOKEN=$(gh auth token)  # optional, raises the GitHub quota
npx tsx examples/agent-builds-a-map-app/agent.ts
```

Options: `--model <id>`, `--effort low|medium|high|xhigh|max`, `--max-iterations 30`,
`--out <dir>` (default `output/agent-run/` here), `--dry-run`.

The agent writes `index.html`, `NOTES.md` and `transcript.md` into the output directory. The
transcript lists every tool call with a trimmed result (Esri's documentation prose replaced
by `[...]`) and the token usage. A run makes a few dozen model turns at most and costs real
money; check the token count it prints. Serve the result with any static web server, for
example `npx http-server examples/agent-builds-a-map-app/output/agent-run`.

If you run it, please keep the output as it came out, including mistakes: the point of the
example is to show what the agent does with the documentation, not a polished app.
