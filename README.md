<p align="center">
  <img src="docs/banner.svg" alt="Roblox Executor MCP" width="900"/>
</p>

# Roblox MCP Bridge

An MCP server that allows Agents to interact with a running Roblox game client — execute code, inspect scripts, spy on remotes, and more.

> This repository is a maintained mirror of the original `notpoiu/roblox-executor-mcp` project. The original Git history and [MIT license](LICENSE) are preserved.

## Dashboard

Roblox Executor MCP includes a local web dashboard at:

```text
http://localhost:16384/
```

Use it to see connected Roblox clients, inspect scripts, run tools, view server logs, configure semantic search, and index games for semantic script search.

## Features

- **Code Execution** — Run Lua code and fetch data from the game client.
- **Script Inspection** — Decompile scripts and search across all sources.
- **Instance Search** — CSS-like selectors and hierarchy trees.
- **Remote Spy** — Intercept, log, block, and ignore Remotes/Bindables via [Cobalt](https://github.com/notpoiu/cobalt).
- **GUI Interaction** — Click buttons and type into text boxes.
- **Screenshot** — Capture Roblox window screenshots (Windows only).
- **Multi-Client** — Connect multiple Roblox clients at once.
- **Primary / Secondary** — Multiple MCP instances auto-coordinate with automatic promotion. Supports remote relaying via `--baseurl`. See [Advanced](docs/advanced.md).

## Tutorial

[![roblox-executor-mcp installation guide](http://img.youtube.com/vi/Tcy5RNf1TRc/0.jpg)](https://youtube.com/watch?v=Tcy5RNf1TRc)

## Prerequisites

- **Node.js** ≥ 18
- **Bun** ≥ 1.3 for the interactive OpenTUI harness installer
- **A Roblox executor** that supports `loadstring`, `request`, and (preferably) `WebSocket`

## Installation

### 1. Clone the server

```bash
git clone https://github.com/ltseverydayyou/roblox-mcp-bridge.git
cd roblox-mcp-bridge
```

### 2. Run the harness installer

The installer builds the server, lets you choose AI clients, writes supported MCP configs, and prints the Roblox loader script.

```bash
npm run install:harnesses
```

This command installs dependencies, builds `dist/index.js`, lets you select supported AI clients, and writes their local MCP configuration. Bun is installed automatically if the interactive installer needs it.

The picker is built with [OpenTUI](https://opentui.com/) and runs through Bun. `npm run install:harnesses` installs Bun first if it is not already available. It shows detected local clients by default; if none are detected, it warns you to install a harness first. Press `s` in the picker or pass `--show-all-harnesses` to reveal every supported config target. If your terminal has trouble with the interactive picker, use the plain numbered prompt:

```bash
npm run install:harnesses -- --plain
```

The installer can also place the Roblox loader into a detected executor autoexec folder, such as MacSploit on macOS or supported Windows executor autoexec folders. Use the prompt, or run:

```bash
npm run getscript -- --autoexec
```

It can also help with:

- cross-machine setup on the same LAN
- copying the Roblox loader to your clipboard
- optional Ollama `embeddinggemma` setup for semantic indexing
- pulling latest repo changes before install/build

To update an existing install later, run:

```bash
npm run update
```

The update command can stop currently running MCP server processes, optionally pull latest changes, and always rebuilds the server.

### Manual setup

To install and build without the interactive installer:

```bash
npm install
npm run build
```

If you prefer to configure a client yourself, use the setup guide for your client:

| Client         | Guide                                       |
| -------------- | ------------------------------------------- |
| Cursor         | [Setup Guide](docs/setup-cursor.md)         |
| Claude Desktop | [Setup Guide](docs/setup-claude-desktop.md) |
| Claude Code    | [Setup Guide](docs/setup-claude-code.md)    |
| Codex CLI      | [Setup Guide](docs/setup-codex.md)          |
| Windsurf       | [Setup Guide](docs/setup-windsurf.md)       |
| Antigravity    | [Setup Guide](docs/setup-antigravity.md)    |

### 3. Connect from Roblox

The installer prints this for you. Put it in your executor or Auto Execute:

```lua
local bridgeUrl = getgenv().BridgeURL or "localhost:16384"
loadstring(game:HttpGet("http://" .. bridgeUrl .. "/script.luau"))()
```

**Optional settings** (set before the `loadstring`):

```lua
getgenv().BridgeURL = "10.0.0.4:16384"                  -- default: localhost:16384
getgenv().DisableWebSocket = true                        -- force HTTP polling
getgenv().DisableInitialScriptDecompMapping = true       -- skip initial decompilation
```

After the MCP server starts and Roblox connects, open the dashboard:

```text
http://localhost:16384/
```

## Remote access and ChatGPT plugins

This project currently exposes MCP over local `stdio`. Port `16384` is the unauthenticated Roblox bridge and dashboard, **not** a remote MCP endpoint. Do not point a public tunnel at that port.

- For another computer on the same trusted network, use a VPN, LAN address, or SSH tunnel as described in [Advanced Configuration](docs/advanced.md).
- For ChatGPT, OpenAI's `tunnel-client` can launch this local `stdio` MCP server and carry MCP traffic over an outbound-only tunnel without publicly exposing port `16384`.
- For a direct remote MCP URL, place an authenticated Streamable HTTP MCP gateway in front of the local server and keep bearer tokens in environment variables. Public authenticated plugins should use the supported MCP OAuth 2.1 flow.

See [OpenAI remote MCP and plugin connections](docs/openai-remote-mcp.md) for architecture, tunnel, authentication, and configuration examples.

Windows users can download and checksum-verify the latest official OpenAI tunnel client from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-tunnel-client.ps1
```

For the complete first-time setup—project build, autoexec installer, official tunnel-client download, profile creation, secure runtime-key prompt, diagnostics, and startup—run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-chatgpt-tunnel.ps1
```

After restarting Windows, start the saved profile with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-chatgpt-tunnel.ps1
```

See the [complete Windows and ChatGPT tunnel setup](docs/windows-chatgpt-tunnel.md) for the Roblox, ChatGPT, restart, and troubleshooting steps.

## Community

Have a suggestion or need help? Join the [Discord server](https://discord.gg/FJcJMuze7S).

## Security

> **This server allows arbitrary code execution.** Only use with AI clients you trust. Port `16384` has no authentication — **never expose it to the internet.** For cross-machine setups, use a local network, VPN, or SSH tunnel. See [Advanced](docs/advanced.md) for details.

## License

[MIT](LICENSE)
