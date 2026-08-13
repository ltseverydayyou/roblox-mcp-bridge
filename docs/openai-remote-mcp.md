# OpenAI remote MCP and plugin connections

This project has two separate transports:

1. The AI client launches `dist/index.js` locally and communicates with it through MCP over `stdio`.
2. The Roblox connector communicates with that process through WebSocket or HTTP on port `16384`.

Port `16384` is also used by the local dashboard. It is not an MCP Streamable HTTP endpoint and it has no authentication.

OpenAI's `tunnel-client` is a separate transport layer. It can launch this project's local `stdio` command and carry MCP traffic through an outbound-only OpenAI tunnel without exposing port `16384` to the public internet.

## Local Codex connection

Use the local `stdio` configuration whenever Codex and this repository run on the same computer:

```toml
[mcp_servers.roblox-mcp-bridge]
command = "node"
args = ["/absolute/path/to/roblox-mcp-bridge/dist/index.js"]
```

This is the simplest and safest configuration because the MCP process is not exposed to the network.

## Cross-machine Roblox bridge

If Codex runs on one computer and Roblox runs on another trusted computer, run an MCP instance beside Codex and relay it to the Roblox computer:

```toml
[mcp_servers.roblox-mcp-bridge]
command = "node"
args = [
  "/absolute/path/to/roblox-mcp-bridge/dist/index.js",
  "--baseurl",
  "http://127.0.0.1:16384"
]
```

Then create an SSH tunnel from the Codex computer to the Roblox computer:

```bash
ssh -N -L 16384:127.0.0.1:16384 user@roblox-computer
```

The relay continues to use `127.0.0.1:16384`; SSH carries the traffic securely to the other machine. A private mesh VPN is another reasonable option. Do not expose port `16384` with a public tunnel, public router rule, or open cloud firewall.

## ChatGPT through OpenAI tunnel-client

This is the tested Windows path for connecting the local server to ChatGPT. It does not require changing this project to Streamable HTTP.

### Prerequisites

- A built checkout with `dist/index.js`
- A supported `tunnel-client.exe` from [OpenAI tunnel-client releases](https://github.com/openai/tunnel-client/releases/latest) or OpenAI Platform Tunnels
- A `tunnel_id` created for the correct ChatGPT workspace
- A restricted Platform Runtime API key with **Tunnels Read + Use**

The tunnel ID and runtime API key are different values. The ID selects the tunnel; `CONTROL_PLANE_API_KEY` authenticates `doctor` and `run`. An OpenAI admin key is only needed for tunnel create/list/update/delete operations and should not be used for the runtime daemon.

### First-time profile setup

Open PowerShell in the folder containing `tunnel-client.exe`. Read the runtime key without echoing it:

```powershell
$env:CONTROL_PLANE_API_KEY = [System.Net.NetworkCredential]::new("", (Read-Host "Paste runtime API key" -AsSecureString)).Password
```

Create a named profile. Replace the checkout path and tunnel ID:

```powershell
.\tunnel-client.exe init --sample sample_mcp_stdio_local --profile roblox-executor --tunnel-id "tunnel_YOUR_ID" --mcp-command "node C:/Users/YOUR_NAME/roblox-mcp-bridge/dist/index.js"
```

Validate the profile:

```powershell
.\tunnel-client.exe doctor --profile roblox-executor --explain
```

Start the tunnel runtime:

```powershell
.\tunnel-client.exe run --profile roblox-executor
```

Leave that window running. The profile launches `node .../dist/index.js` itself, so do not also start a second copy with `npm start` or `node dist/index.js` for the same tunnel profile.

### Verify the runtime

The `run` command prints a local operator URL. Check these surfaces in order:

1. `/readyz` must report ready.
2. `/ui#overview` should show the tunnel connected and MCP ready.
3. `/ui#logs` contains the detailed error when readiness fails.
4. `http://localhost:16384/` should show the Roblox bridge dashboard.

Launch Roblox and let the installed autoexec loader run, or execute the manual loader from the main README. The bridge dashboard should then show a connected Roblox client.

### Connect ChatGPT

While `tunnel-client run` is still active:

1. Open ChatGPT settings and enable Developer mode if it is not already enabled.
2. Open **Connectors**, **Apps**, or **Plugins**, depending on the current client label.
3. Add or refresh the Roblox MCP connection.
4. Choose **Connection: Tunnel** and select or paste the same `tunnel_...` ID.
5. For this local `stdio` tunnel profile, choose **Authentication: None** if the connection form asks for MCP authentication. The runtime API key authenticates the tunnel daemon to OpenAI; it is not an API key passed to this MCP server.
6. Attach the app to a new conversation and test: `Use Roblox MCP Bridge to list connected Roblox clients.`

Refreshing the connection updates its advertised tool metadata. Use a separate tunnel ID if Roblox Studio MCP and this executor MCP must remain available at the same time.

### After restarting Windows

Open PowerShell in the tunnel-client folder, set the runtime key again, and run the existing profile:

```powershell
$env:CONTROL_PLANE_API_KEY = [System.Net.NetworkCredential]::new("", (Read-Host "Paste runtime API key" -AsSecureString)).Password
.\tunnel-client.exe run --profile roblox-executor
```

Then launch Roblox and connect the executor. Never put the real key in this repository, the profile command, a loader script, a screenshot, or a shared conversation.

## Direct remote MCP gateway for Codex

A direct remote-URL Codex connection requires a separate HTTPS service that implements MCP Streamable HTTP. This is an alternative to the OpenAI tunnel-client profile above.

The safe architecture is:

```text
Codex -> HTTPS Streamable HTTP MCP gateway -> local stdio MCP process -> localhost:16384 -> Roblox
```

If the gateway accepts a bearer key, store it in an environment variable instead of placing the secret directly in `config.toml`:

```toml
[mcp_servers.roblox-mcp-bridge-remote]
url = "https://your-private-gateway.example/mcp"
bearer_token_env_var = "ROBLOX_MCP_TOKEN"
```

Alternatively, map a custom header to an environment variable:

```toml
[mcp_servers.roblox-mcp-bridge-remote]
url = "https://your-private-gateway.example/mcp"
env_http_headers = { "X-API-Key" = "ROBLOX_MCP_API_KEY" }
```

Set the variable in the environment that launches Codex. Never commit the real token, place it in a loader script, include it in a screenshot, or append it to a tunnel URL.

The gateway should terminate TLS, validate authentication before accepting MCP requests, restrict origins or clients where practical, rate-limit requests, and keep the underlying port `16384` bound to a private interface.

## Public HTTPS plugin connection

For a conventional public plugin URL rather than an OpenAI tunnel, first deploy an HTTPS Streamable HTTP MCP gateway.

For authenticated ChatGPT plugins, implement the MCP OAuth 2.1 authorization flow. The server must publish protected-resource metadata, the authorization server must publish OAuth or OpenID discovery metadata, and access tokens must be validated for issuer, audience, expiration, and scopes. ChatGPT does not present arbitrary custom API keys to MCP servers, so an `X-API-Key` or fixed bearer-key design is suitable for a private Codex gateway but not as the authentication design for a ChatGPT plugin.

After the OAuth-enabled remote MCP gateway is available:

1. Enable Developer mode in ChatGPT under **Settings > Security and login**.
2. Open the Plugins page and add the HTTPS MCP server URL and its connection details.
3. Complete the OAuth connection flow.
4. Copy the generated technical connection ID, which begins with `plugin_asdk_app`.
5. Reference that registered connection from a plugin `.app.json`, then package it with `.codex-plugin/plugin.json`.
6. Install the plugin from a personal or repository marketplace and test it in a new conversation.

Do not paste an example `plugin://...` link into code or configuration. That link identifies a plugin already registered in a particular account or workspace; it is not a reusable server URL or credential.

## Public gateway checklist

Before publishing any direct remote MCP gateway, confirm all of the following:

- The tunnel targets the authenticated MCP gateway, not port `16384`.
- The public URL uses HTTPS with a valid certificate.
- Authentication is enforced before tools can be listed or called.
- Secrets are stored outside Git and are easy to rotate.
- The tunnel hostname is stable if OAuth metadata and redirect configuration depend on it.
- The gateway rejects unexpected hosts, oversized bodies, and invalid content types.
- Logs do not contain access tokens, Roblox loader contents, or sensitive tool results.

## Official references

- [OpenAI tunnel-client end-user guide](https://github.com/openai/tunnel-client/blob/master/docs/end-user-guide.md)
- [OpenAI tunnel-client onboarding](https://github.com/openai/tunnel-client/blob/master/docs/onboarding.md)
- [OpenAI: Package your plugin](https://developers.openai.com/plugins/build/plugins)
- [OpenAI: Plugin authentication](https://developers.openai.com/plugins/build/auth)
- [OpenAI: Build an MCP server](https://developers.openai.com/plugins/build/mcp-server)
- [OpenAI: Codex configuration reference](https://developers.openai.com/codex/config-reference)
