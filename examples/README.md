# Examples

| Example                                           | What it shows                                                                       | Needs                         | Run for this repository   |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------- | ------------------------- |
| [quickstart-client](quickstart-client/)           | A script drives the server over MCP stdio through one agent task in five tool calls | a build                       | yes, transcript committed |
| [agent-builds-a-map-app](agent-builds-a-map-app/) | Claude, with the server attached, builds a small ArcGIS Maps SDK for JavaScript app | a build, an Anthropic API key | not yet (see its README)  |
| [host-configs](host-configs/)                     | Copy-ready server entries for Claude Code, Claude Desktop, Cursor and VS Code       | a build                       | n/a                       |

All of them start the server from `dist/cli/main.js`, so run `npm ci` and `npm run build` in
the repository root first. The TypeScript examples run with `npx tsx <file>` from the
repository root and are type-checked with `npx tsc -p examples/tsconfig.json`.

This project is unofficial and not affiliated with Esri. Output shown in these examples is
trimmed so that the repository does not reproduce Esri's documentation text.
