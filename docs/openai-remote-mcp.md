# OpenAI remote MCP and plugin connections

This project has two separate transports:

1. The AI client launches `dist/index.js` locally and communicates with it through MCP over `stdio`.
2. The Roblox connector communicates with that process through WebSocket or HTTP on port `16384`.

Port `16384` is also used by the local dashboard. It is not an MCP Streamable HTTP endpoint and it has no authentication.

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

## Remote MCP gateway for Codex

A remote Codex connection requires a separate HTTPS service that implements MCP Streamable HTTP. A tunnel can publish that gateway, but a tunnel does not convert this project's `stdio` transport into HTTP by itself.

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

## ChatGPT plugin connection

ChatGPT plugins can include a registered remote MCP server connection, but this repository cannot be registered directly in its current `stdio`-only form. First deploy an HTTPS Streamable HTTP MCP gateway.

For authenticated ChatGPT plugins, implement the MCP OAuth 2.1 authorization flow. The server must publish protected-resource metadata, the authorization server must publish OAuth or OpenID discovery metadata, and access tokens must be validated for issuer, audience, expiration, and scopes. ChatGPT does not present arbitrary custom API keys to MCP servers, so an `X-API-Key` or fixed bearer-key design is suitable for a private Codex gateway but not as the authentication design for a ChatGPT plugin.

After the OAuth-enabled remote MCP gateway is available:

1. Enable Developer mode in ChatGPT under **Settings > Security and login**.
2. Open the Plugins page and add the HTTPS MCP server URL and its connection details.
3. Complete the OAuth connection flow.
4. Copy the generated technical connection ID, which begins with `plugin_asdk_app`.
5. Reference that registered connection from a plugin `.app.json`, then package it with `.codex-plugin/plugin.json`.
6. Install the plugin from a personal or repository marketplace and test it in a new conversation.

Do not paste an example `plugin://...` link into code or configuration. That link identifies a plugin already registered in a particular account or workspace; it is not a reusable server URL or credential.

## Tunnel checklist

Before using any public tunnel for a remote MCP gateway, confirm all of the following:

- The tunnel targets the authenticated MCP gateway, not port `16384`.
- The public URL uses HTTPS with a valid certificate.
- Authentication is enforced before tools can be listed or called.
- Secrets are stored outside Git and are easy to rotate.
- The tunnel hostname is stable if OAuth metadata and redirect configuration depend on it.
- The gateway rejects unexpected hosts, oversized bodies, and invalid content types.
- Logs do not contain access tokens, Roblox loader contents, or sensitive tool results.

## Official references

- [OpenAI: Package your plugin](https://developers.openai.com/plugins/build/plugins)
- [OpenAI: Plugin authentication](https://developers.openai.com/plugins/build/auth)
- [OpenAI: Build an MCP server](https://developers.openai.com/plugins/build/mcp-server)
- [OpenAI: Codex configuration reference](https://developers.openai.com/codex/config-reference)
