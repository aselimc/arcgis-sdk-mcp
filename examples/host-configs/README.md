# Host configurations

Ready-to-copy server entries for four MCP hosts. Each one starts the server over stdio; the
host does that itself, so there is nothing to keep running.

The package is **not on npm yet**, so these files start a build from a clone. Build it once:

```sh
git clone https://github.com/aselimc/arcgis-sdk-mcp.git
cd arcgis-sdk-mcp
npm ci
npm run build
node dist/cli/main.js --version
```

Then replace `/absolute/path/to/arcgis-sdk-mcp` in the file for your host with the clone's
absolute path (on Windows, forward slashes work: `C:/Users/you/arcgis-sdk-mcp/...`).

| Host           | File                                         | Copy it to                                                                               |
| -------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Claude Code    | [claude-code.mcp.json](claude-code.mcp.json) | `.mcp.json` at your project root (shared with the team), or use the command below        |
| Claude Desktop | [claude-desktop.json](claude-desktop.json)   | Settings, Developer, Edit Config (`claude_desktop_config.json`); merge into `mcpServers` |
| Cursor         | [cursor.mcp.json](cursor.mcp.json)           | `.cursor/mcp.json` in the project, or `~/.cursor/mcp.json` for every project             |
| VS Code        | [vscode.mcp.json](vscode.mcp.json)           | `.vscode/mcp.json` in the workspace (note the `servers` key, not `mcpServers`)           |

Claude Code can also add the entry from the command line:

```sh
claude mcp add arcgis-docs -- node /absolute/path/to/arcgis-sdk-mcp/dist/cli/main.js
```

## Notes

- **Project detection.** The server looks for Esri SDKs (for example `@arcgis/core` in
  `package.json`) in the directory the host starts it in. Claude Desktop starts servers
  elsewhere, so its file sets `ARCGIS_DOCS_PROJECT_DIR`; remove the `env` block if you do not
  want that.
- **GitHub quota.** Sample lookups use the GitHub API. Without a token the quota is 60
  requests per hour. Add `"GITHUB_TOKEN": "<token with no scopes>"` to an `env` block, or
  start the host from a shell where `GITHUB_TOKEN` is set. Do not commit a token.
- **After the npm release** the `command`/`args` pair becomes `"command": "npx"`,
  `"args": ["-y", "arcgis-sdk-mcp"]` (on Windows `"command": "cmd"`,
  `"args": ["/c", "npx", "-y", "arcgis-sdk-mcp"]`). Do not use `npx` before the package is
  published under this name.
- Every environment variable the server reads is listed in
  [docs/configuration.md](../../docs/configuration.md).
