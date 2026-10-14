# Hosting a private instance

`arcgis-sdk-mcp` normally runs on your machine, started by your MCP host over stdio. This page
shows how to run it as a **private** remote endpoint instead, so an agent that cannot start a
local process (a cloud agent, an Agent SDK job, a second machine) can still use it. The
recipe is Vercel's free Hobby plan; [other hosts](#other-hosts) are covered briefly at the end.

The result is an endpoint such as `https://arcgis-sdk-mcp.vercel.app/api/mcp` that answers
only requests carrying your bearer token.

## Keep it private

The documentation this server reads is Esri's, and its use is subject to
[Esri's terms](https://www.esri.com/en-us/legal/overview). The project's position
([source-policy.md](source-policy.md#responsible-use)) is that the server fetches a public
page at a person's request, for that person. A hosted instance fits that only while it serves
you and your own agents:

- **Do not share the URL and token, publish them, or offer the endpoint to others.** A shared,
  public or paid instance would redistribute Esri's documentation as a service, which needs
  Esri's permission. Ask Esri first if you want to run one.
- Vercel's Hobby plan is for non-commercial, personal use only
  ([Vercel fair use](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage)).
- The server enforces the first rule for you: without `ARCGIS_DOCS_HTTP_TOKEN` a hosted
  instance refuses every request (fail closed), and with it every MCP request needs the token.

## How it works

```
MCP client --HTTPS, Authorization: Bearer <token>--> Vercel function api/mcp.ts
  -> refuse with 503 if no token is configured (fail closed)
  -> Host and Origin must be one of the deployment's own names
  -> /healthz, /mcp, /api/mcp routing
  -> bearer token check (constant time; 401 with WWW-Authenticate otherwise)
  -> the same stateless MCP handler as `arcgis-sdk-mcp --http`
```

`api/mcp.ts` is a [Vercel Function](https://vercel.com/docs/functions/runtimes/node-js) with
web-standard `GET`/`POST` exports. It wraps `src/cli/http-hosted.ts`, which builds one
application container per function instance (caches, indexes and rate limits are shared by
every request that instance serves) and creates a fresh MCP server per request, exactly as
the local HTTP mode does. `vercel.json` sets the build, the function's maximum duration,
`Cache-Control: no-store` on every response, and two rewrites so `/mcp` and `/healthz` work
as well as `/api/mcp`.

## Deploy with the Vercel CLI

You need Node 22.12 or later, a clone of this repository, and the
[Vercel CLI](https://vercel.com/docs/cli) logged in (`vercel login`, then `vercel whoami`).

1. **Generate a token.** At least 32 characters of letters, digits and `-._~+/`:

   ```sh
   openssl rand -hex 32
   # or, without OpenSSL (any OS):
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   Store it in your password manager. Anyone with the token can use your instance.

2. **Create and link the project** from the repository root. Accept the detected settings;
   `vercel.json` supplies the install, build and output settings. Name the project
   `arcgis-sdk-mcp` to get `arcgis-sdk-mcp.vercel.app` (if the name is taken, Vercel adds a
   suffix; use the URL it prints).

   ```sh
   vercel link
   ```

3. **Set the token** for the production environment. The command prompts for the value, so
   the token never lands in your shell history:

   ```sh
   vercel env add ARCGIS_DOCS_HTTP_TOKEN production
   ```

   Recommended: also add `GITHUB_TOKEN` (a fine-grained personal access token with no
   permissions beyond public repositories is enough). Vercel functions share outbound IP
   addresses, and GitHub's anonymous quota of 60 requests per hour is per address, so without
   a token the GitHub-backed sources can run out of quota because of other people's traffic.

   ```sh
   vercel env add GITHUB_TOKEN production
   ```

4. **Deploy to production:**

   ```sh
   vercel deploy --prod
   ```

5. **Check it.** The health check needs no token; the MCP endpoint must refuse a request
   without one:

   ```sh
   curl https://arcgis-sdk-mcp.vercel.app/healthz
   # {"status":"ok","server":"arcgis-sdk-docs","version":"0.1.0"}

   curl -i -X POST https://arcgis-sdk-mcp.vercel.app/api/mcp
   # HTTP/2 401 ... www-authenticate: Bearer realm="arcgis-sdk-docs"
   ```

   A `503` that names `ARCGIS_DOCS_HTTP_TOKEN` means the variable is missing in that
   environment: add it and deploy again (environment variables apply to new deployments only).

## Deploy from the Vercel dashboard

1. Push the repository (or your fork) to GitHub.
2. In the [dashboard](https://vercel.com/new), choose **Add New... > Project** and import the
   repository. Keep the root directory at `./`. The framework preset does not matter:
   `vercel.json` sets `"framework": null` (Other) and the install, build and output settings.
3. Under **Environment Variables**, add `ARCGIS_DOCS_HTTP_TOKEN` (and optionally
   `GITHUB_TOKEN`) for **Production**.
4. Select **Deploy**. Every push to the default branch deploys again.
5. Check the deployment as in step 5 above.

To change a variable later: **Settings > Environment Variables**, then redeploy from the
**Deployments** tab.

## Connect a client

Use the production URL with `/api/mcp` (or `/mcp`). Keep the token in an environment variable
rather than in a file you might commit:

```sh
export ARCGIS_DOCS_HTTP_TOKEN=...   # PowerShell: $env:ARCGIS_DOCS_HTTP_TOKEN = "..."
```

### Claude Code

```sh
claude mcp add --transport http --scope user arcgis-docs \
  https://arcgis-sdk-mcp.vercel.app/api/mcp \
  --header "Authorization: Bearer $ARCGIS_DOCS_HTTP_TOKEN"
```

This stores the expanded token in your user configuration. To keep it out of every file,
use a project `.mcp.json` with variable expansion instead; Claude Code expands `${VAR}` in
`url` and `headers` from the environment it was started in:

```json
{
  "mcpServers": {
    "arcgis-docs": {
      "type": "http",
      "url": "https://arcgis-sdk-mcp.vercel.app/api/mcp",
      "headers": { "Authorization": "Bearer ${ARCGIS_DOCS_HTTP_TOKEN}" }
    }
  }
}
```

Run `/mcp` in Claude Code to confirm the server shows as connected with six tools.

### Claude Agent SDK

TypeScript:

```ts
import { query } from '@anthropic-ai/claude-agent-sdk';

for await (const message of query({
  prompt: 'How do I query features from a FeatureLayer in the ArcGIS Maps SDK for JavaScript?',
  options: {
    mcpServers: {
      'arcgis-docs': {
        type: 'http',
        url: 'https://arcgis-sdk-mcp.vercel.app/api/mcp',
        headers: { Authorization: `Bearer ${process.env.ARCGIS_DOCS_HTTP_TOKEN}` },
      },
    },
    allowedTools: ['mcp__arcgis-docs__*'],
  },
})) {
  if (message.type === 'result' && message.subtype === 'success') console.log(message.result);
}
```

Python:

```python
import os
from claude_agent_sdk import ClaudeAgentOptions

options = ClaudeAgentOptions(
    mcp_servers={
        "arcgis-docs": {
            "type": "http",
            "url": "https://arcgis-sdk-mcp.vercel.app/api/mcp",
            "headers": {"Authorization": f"Bearer {os.environ['ARCGIS_DOCS_HTTP_TOKEN']}"},
        }
    },
    allowed_tools=["mcp__arcgis-docs__*"],
)
```

### Any MCP client

The endpoint speaks Streamable HTTP, statelessly: a client of protocol version 2026-07-28 gets
one JSON body per request, a 2025-era client one SSE-framed message, so a client must accept
both `application/json` and `text/event-stream`. With the TypeScript SDK:

```ts
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const transport = new StreamableHTTPClientTransport(
  new URL('https://arcgis-sdk-mcp.vercel.app/api/mcp'),
  { requestInit: { headers: { Authorization: `Bearer ${process.env.ARCGIS_DOCS_HTTP_TOKEN}` } } },
);
const client = new Client({ name: 'my-agent', version: '1.0.0' });
await client.connect(transport);
console.log((await client.listTools()).tools.map((tool) => tool.name));
```

A missing or wrong token makes `connect` fail with an HTTP 401 error; the server does not
offer OAuth, so a client that tries to start an OAuth flow on 401 has to be given the header
instead.

## What differs from local mode

| Local (stdio, or `--http` on loopback)                           | Hosted on Vercel                                                                                                                                                                                                                         |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cache on disk in your user cache directory, kept across runs     | Cache in `/tmp/arcgis-sdk-mcp` of each function instance (256 MB cap), empty after every cold start and not shared between instances. The first search of a product after a cold start builds its index again and is slower              |
| An index build that outlasts its call finishes in the background | Background work may be frozen when the response has been sent. A source reported as "not searched yet" is picked up by a later call on a warm instance                                                                                   |
| Workspace detection pins versions to your project                | Off: the function cannot see your project. Pass the version you use (`line`, or the version in your question) explicitly                                                                                                                 |
| `local-packages` reads Esri packages in `node_modules`           | Off                                                                                                                                                                                                                                      |
| Logs on stderr                                                   | Logs in the project's **Logs** tab (one hour of history on Hobby). Set `ARCGIS_DOCS_LOG_LEVEL=info` for more detail                                                                                                                      |
| No token needed on loopback                                      | Token mandatory; no token means 503 for every request                                                                                                                                                                                    |
| `Host` must be a loopback name                                   | `Host` and `Origin` must be one of the deployment's names: `VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_URL`, `VERCEL_BRANCH_URL` (Vercel sets these), plus `ARCGIS_DOCS_HTTP_ALLOWED_HOSTS`. Add every extra custom domain to that variable |

The `arcgis-docs://status` resource leaves out the cache directory and project paths in HTTP
mode, as it does locally.

## Cost and limits

The Hobby plan is free. Its monthly included usage
([Vercel Hobby plan](https://vercel.com/docs/plans/hobby)) is 1,000,000 function invocations,
4 hours of active CPU, 360 GB-hours of provisioned memory and 100 GB of fast data transfer;
when a limit is exceeded, the feature pauses until 30 days have passed. One person's agent
stays far below these: a tool call spends most of its time waiting on upstream hosts, which
does not count as active CPU.

Other limits that apply ([Vercel Functions limits](https://vercel.com/docs/functions/limitations)):

- **Duration**: `vercel.json` sets `maxDuration` to 60 seconds. A tool call has its own
  25-second budget, so this leaves room; Hobby allows at most 300 seconds.
- **Memory**: 2 GB and 1 vCPU, fixed on Hobby.
- **Body size**: 4.5 MB per request or response; the server's answers are far smaller.
- **Region**: one region, `iad1` by default (Settings > Functions to change it).

The upstream rate limits of the server (two requests per second per host, robots rules, the
circuit breaker; see [source-policy.md](source-policy.md)) apply per function instance.

## Security notes

- The token is compared in constant time (both sides hashed, then `timingSafeEqual`), and is
  never logged, cached or passed to the MCP server instance.
- There is no rate limiting of failed attempts in the server. A 32-byte random token cannot be
  guessed; if you want more, Vercel's firewall can block or challenge traffic by IP or path.
- **Rotate** the token by replacing the variable (`vercel env rm ARCGIS_DOCS_HTTP_TOKEN
production`, then `vercel env add ...`) and deploying again; update your clients.
- **Preview deployments** are protected by Vercel Authentication by default
  ([Deployment Protection](https://vercel.com/docs/deployment-protection)), so an MCP client
  reaching a preview URL gets Vercel's login page instead of the server. Use the production
  URL. Preview environments also have no token unless you add one for them, in which case they
  answer 503.
- Responses carry `Cache-Control: no-store` and `X-Robots-Tag: noindex`, and `robots.txt`
  disallows everything.

## Configuration reference

All variables of [configuration.md](configuration.md) apply. These matter for HTTP serving:

| Variable                         | Meaning                                                                                                                                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARCGIS_DOCS_HTTP_TOKEN`         | Bearer token every MCP request must carry, at least 32 characters. Required on a hosting platform and for any non-loopback `--host`; without it the server refuses to start (CLI) or to answer (function) |
| `ARCGIS_DOCS_HTTP_ALLOWED_HOSTS` | Comma-separated host names (no scheme or port) accepted in `Host` and `Origin` besides the defaults, for a custom domain or a reverse proxy                                                               |
| `PORT`                           | Port of `--http` when `--port` is not given. Hosting platforms set it                                                                                                                                     |
| `GITHUB_TOKEN`                   | Raises the GitHub API quota; recommended on any shared-IP platform                                                                                                                                        |
| `ARCGIS_DOCS_CACHE_DIR`          | Hosted default: `/tmp/arcgis-sdk-mcp` (the temporary directory of the instance)                                                                                                                           |
| `ARCGIS_DOCS_CACHE_MAX_MB`       | Hosted default: 256                                                                                                                                                                                       |

A hosting platform is recognised by a variable it sets: `VERCEL`, `K_SERVICE` (Cloud Run),
`AWS_LAMBDA_FUNCTION_NAME`, `FLY_APP_NAME`, `RENDER`, `RAILWAY_ENVIRONMENT`, `DYNO` (Heroku)
or `WEBSITE_SITE_NAME` (Azure App Service). On any of them the token is mandatory, even on a
loopback bind.

## Troubleshooting

| Symptom                                                    | Cause and fix                                                                                                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `503` naming `ARCGIS_DOCS_HTTP_TOKEN`                      | The variable is not set for this environment. Add it and redeploy                                                                                             |
| `500` "Configuration error: ..."                           | A variable has an invalid value (a token shorter than 32 characters, a host with a scheme); the message names it. Fix it and redeploy                         |
| `401` with `error="invalid_token"`                         | The client sends a different token, or no `Bearer ` prefix. Check the header and that the client's environment has the variable                               |
| `403` "Invalid Host"                                       | The request used a host name the deployment does not list, such as a second custom domain. Add it to `ARCGIS_DOCS_HTTP_ALLOWED_HOSTS`                         |
| An HTML login page instead of JSON                         | Vercel Deployment Protection on a preview URL. Use the production domain                                                                                      |
| `504 FUNCTION_INVOCATION_TIMEOUT`                          | A call ran past `maxDuration`. Rare, since a tool call stops at 25 seconds; raise `maxDuration` in `vercel.json` (Hobby maximum 300) if it happens repeatedly |
| Searches report "not searched yet" more often than locally | Cold instances start with an empty cache. Repeat the call; warm instances keep their indexes                                                                  |

## Testing a deployment locally

The deployment can be checked without creating anything on Vercel:

- `npm test` runs the function handler in-process: `test/cli/http-hosted.test.ts` imports
  `api/mcp.ts` and calls its exports with web-standard `Request` objects (token missing,
  wrong and right; foreign `Host`; fail closed without a token).
- `vercel build` produces `.vercel/output` locally. It needs project settings in
  `.vercel/project.json`, which `vercel link` or `vercel pull` writes; both talk to your
  Vercel account, so run them only when you mean to create the project.
- `arcgis-sdk-mcp --http` with `ARCGIS_DOCS_HTTP_TOKEN` set runs the same rules on your
  machine; connect a client to `http://127.0.0.1:3333/mcp` with the header.

## Other hosts

Any host that can run Node 22.12 or later can serve the CLI's HTTP mode. Bind every interface,
pass the token, and let the platform's `PORT` choose the port:

```sh
npm ci && npm run build
ARCGIS_DOCS_HTTP_TOKEN=... node dist/cli/main.js --http --host 0.0.0.0 --allow-remote
```

- The server speaks plain HTTP. Put it behind TLS (the platform's HTTPS, or a reverse proxy
  such as Caddy or nginx) so the token never crosses a network in clear.
- Without `ARCGIS_DOCS_HTTP_TOKEN` it refuses to start on a non-loopback address or on a
  recognised platform.
- With a wildcard bind, `Host` is not checked unless you list your public host names in
  `ARCGIS_DOCS_HTTP_ALLOWED_HOSTS`; set it when you know them.
- Mount a persistent volume and point `ARCGIS_DOCS_CACHE_DIR` at it to keep the cache across
  restarts.

A Dockerfile is not provided yet: one was not added because it could not be build-tested when
this page was written.
