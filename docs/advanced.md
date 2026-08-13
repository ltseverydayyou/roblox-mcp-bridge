# Advanced Configuration

## Primary / Secondary Mode

By default, the server starts as a **primary** on port `16384`. If that port is already in use, it automatically becomes a **secondary** that relays all tool calls through the primary. When the primary disconnects, a secondary will promote itself automatically.

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

The connector supports two transport modes:
- **WebSocket** (preferred) — persistent connection, lower latency
- **HTTP Polling** — fallback for executors that don't support WebSocket

## Dashboard

A live status dashboard is available at `http://localhost:16384/` when the server is running. It shows connected clients, server role, and uptime.

## Security

**This server allows arbitrary code execution.** Any connected AI client can run Lua code in your Roblox session, take screenshots, and read client data.

**Never expose port `16384` to the internet.** There is no authentication. For cross-machine setups:

- Use a **local network** or **VPN**
- Use an **SSH tunnel**: `ssh -L 16384:localhost:16384 user@windows-machine`
- **Never** forward the port through a public router or cloud firewall

An SSH tunnel keeps the bridge bound to the remote machine while making it available at `localhost:16384` on the AI-client machine. This is for trusted cross-machine use; it does not convert the local `stdio` MCP server into a ChatGPT-compatible remote MCP endpoint.

For remote OpenAI client and plugin requirements, see [OpenAI remote MCP and plugin connections](openai-remote-mcp.md).
