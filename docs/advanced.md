# Advanced Configuration

## Primary / Secondary Mode

By default, the server starts as a **primary** on `127.0.0.1:16384`. If that address and port are already in use, it automatically becomes a **secondary** that relays all tool calls through the primary. When the primary disconnects, a secondary will promote itself automatically.

### Remote primary (`--baseurl`)

If your AI client runs on macOS/Linux but Roblox is on a Windows machine, you can relay through a remote primary:

```json
{
  "mcpServers": {
    "roblox-executor-mcp": {
      "command": "node",
      "args": [
        "/path/to/roblox-executor-mcp/dist/index.js",
        "--baseurl",
        "http://<windows-ip>:16384"
      ]
    }
  }
}
```

**Fallback behavior:**

| Scenario | Result |
|---|---|
| Remote reachable | Secondary relay to remote host |
| Remote unreachable | Falls back to primary locally |
| Remote unreachable + local port taken | Secondary to local primary |

> `screenshot-window` and `list-roblox-windows` are forwarded over HTTP to the primary, so a Mac secondary can capture windows on a Windows primary.

## Connector Options

Set these in Roblox **before** running the connector:

| Variable | Default | Description |
|---|---|---|
| `getgenv().BridgeURL` | `localhost:16384` | Server address to connect to |
| `getgenv().DisableWebSocket` | `false` | Force HTTP polling instead of WebSocket |
| `getgenv().DisableInitialScriptDecompMapping` | `false` | Skip decompiling all scripts on connect |

## Server environment variables

| Variable | Default | Description |
|---|---|---|
| `ROBLOX_MCP_HOST` | `127.0.0.1` | HTTP/WebSocket bind host. Use `0.0.0.0` only on a trusted LAN/VPN. Equivalent CLI option: `--host`. |
| `ROBLOX_MCP_PORT` | `16384` | HTTP/WebSocket bridge and dashboard port. Equivalent CLI option: `--port`. |
| `ROBLOX_MCP_MAX_BODY_BYTES` | `16777216` | Maximum accepted HTTP request body. The default accommodates batched script uploads and decompiler payloads while bounding memory use. |
| `ROBLOX_MCP_UPLOAD_DIR` | OS temporary directory | Dedicated local directory for files transferred through `import-chatgpt-files`. |
| `ROBLOX_MCP_MAX_FILE_BYTES` | `33554432` | Maximum bytes accepted for each imported ChatGPT file. |
| `ROBLOX_MCP_UPDATE_CHECK` | `true` | Check the published package version after startup and every six hours. Set to `false` to disable network checks. |
| `ROBLOX_MCP_UPDATE_MANIFEST_URL` | GitHub package manifest | Advanced override for the HTTPS JSON manifest used by the update checker. The document must contain a semantic `version` string. |

For a Roblox client on another trusted machine:

```powershell
$env:ROBLOX_MCP_HOST = "0.0.0.0"
npm start
```

Keep the machine firewall scoped to the trusted network and set `BridgeURL` to that machine's private address.

The connector supports two transport modes:
- **WebSocket** (preferred) — persistent connection, lower latency
- **HTTP Polling** — fallback for executors that don't support WebSocket

## Dashboard

A live status dashboard is available at `http://localhost:16384/` when the server is running. It shows connected clients, server role, and uptime.

When an update is available, the dashboard shows a dismissible banner with the published version and a copyable update command. The MCP server also exposes `check-for-updates` for an on-demand read-only check. Neither path installs anything automatically; run `npm run update` from the repository and restart the bridge when you are ready.

## Security

**This server allows arbitrary code execution.** Any connected AI client can run Lua code in your Roblox session, take screenshots, and read client data.

**Never expose port `16384` to the internet.** There is no authentication. For cross-machine setups:

- Use a **local network** or **VPN**
- Use an **SSH tunnel**: `ssh -L 16384:localhost:16384 user@windows-machine`
- **Never** forward the port through a public router or cloud firewall

An SSH tunnel keeps the bridge bound to the remote machine while making it available at `localhost:16384` on the AI-client machine. This is for trusted cross-machine use; it does not convert the local `stdio` MCP server into a ChatGPT-compatible remote MCP endpoint.

For remote OpenAI client and plugin requirements, see [OpenAI remote MCP and plugin connections](openai-remote-mcp.md).
