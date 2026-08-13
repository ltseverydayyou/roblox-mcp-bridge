# Codex Setup

## Prerequisites

From the repository root, install dependencies and build the server:

```bash
npm install
npm run build
```

## Desktop settings

Open Codex and go to **Settings** > **MCP**, then add a new server:

- **Name:** `roblox-executor-mcp`
- **Type:** `STDIO`
- **Command:** `node`
- **Args:** `/path/to/roblox-mcp-bridge/dist/index.js`

Replace `/path/to/roblox-mcp-bridge` with the actual path where you cloned the repo.

## Manual config

The Codex CLI config is located at `~/.codex/config.toml`. Open it in your editor.

Add the following to your `config.toml`:

```toml
[mcp_servers.roblox-mcp-bridge]
command = "node"
args = ["/path/to/roblox-mcp-bridge/dist/index.js"]
```

On Windows, an absolute configuration can look like:

```toml
[mcp_servers.roblox-mcp-bridge]
command = 'C:\Program Files\nodejs\node.exe'
args = ['C:\Users\YOUR_NAME\roblox-mcp-bridge\dist\index.js']
```

## Restart Codex

Restart your Codex session for the new server to connect.

## Verify

After setup, the MCP tools should appear in your Codex session. If they don't:

- Make sure you ran `npm install && npm run build` first
- Check that the path to `dist/index.js` is correct
- Ensure Node.js ≥ 18 is installed
- Confirm that another bridge process is not unexpectedly holding port `16384`

For remote HTTP MCP gateways and bearer-token configuration, see [OpenAI remote MCP and plugin connections](openai-remote-mcp.md).
