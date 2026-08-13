# Complete Windows and ChatGPT tunnel setup

This guide reproduces the working Windows setup using the official OpenAI `tunnel-client`. Use placeholders only—never put a real runtime API key in a command, script, Git commit, screenshot, issue, or shared conversation.

## What you need

- Windows 10 or 11
- Git
- Node.js 18 or newer
- A compatible Roblox executor such as Potassium
- An OpenAI tunnel created for the correct ChatGPT workspace
- A restricted OpenAI Platform Runtime API key with **Tunnels Read + Use**

The tunnel ID is an identifier. The runtime API key is the credential used by `tunnel-client doctor` and `run`. Do not substitute an OpenAI admin key for the runtime key.

## 1. Clone the repository

Open PowerShell:

```powershell
Set-Location $env:USERPROFILE
git clone https://github.com/ltseverydayyou/roblox-mcp-bridge.git
Set-Location .\roblox-mcp-bridge
```

## 2. Run the complete first-time setup

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-chatgpt-tunnel.ps1
```

The script:

1. Confirms Node.js 18 or newer is installed.
2. Runs the repository's plain installer so you can build the MCP server and install the executor autoexec loader.
3. Downloads the latest official Windows `tunnel-client` release.
4. Selects AMD64 or ARM64 automatically.
5. Verifies the ZIP against OpenAI's published `SHA256SUMS.txt`.
6. Prompts for the tunnel ID.
7. Prompts for the runtime API key with hidden input.
8. Creates the `roblox-executor` profile and runs `doctor --explain`.
9. Offers to start the foreground tunnel runtime.

The runtime API key is never passed on the command line, printed, or written to the repository/profile by these scripts. It exists only in the setup process environment long enough for `doctor` or `run` and is cleared or restored afterward.

If the repository is already built and the autoexec loader is installed:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-chatgpt-tunnel.ps1 -SkipProjectSetup
```

To redownload and verify the newest tunnel-client release:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-chatgpt-tunnel.ps1 -SkipProjectSetup -UpdateTunnelClient
```

## 3. Roblox installer choices

The repository installer is interactive. For the setup used by this guide:

- Select any local AI harnesses you also want, or press Enter if none are needed.
- Choose the same-computer connection when Roblox and tunnel-client run on this PC.
- Pull updates if desired.
- Ollama semantic indexing is optional.
- Install the autoexec loader when your executor is detected.

The completed build is `dist\index.js`. The tunnel profile launches it automatically; do not separately run `node dist/index.js` while the same profile is active.

## 4. Connect Roblox

Start Roblox, join a game, and inject the executor. If autoexec does not load the connector, run:

```lua
local bridgeUrl = getgenv().BridgeURL or "localhost:16384"
loadstring(game:HttpGet("http://" .. bridgeUrl .. "/script.luau"))()
```

Open the bridge dashboard:

```text
http://localhost:16384/
```

It should show the connected Roblox client.

## 5. Connect ChatGPT

Keep the PowerShell window running `tunnel-client` open.

1. Open ChatGPT settings.
2. Enable Developer mode if required.
3. Open **Connectors**, **Apps**, or **Plugins**.
4. Add or refresh the Roblox MCP connection.
5. Choose **Connection: Tunnel**.
6. Select or paste the same `tunnel_...` ID.
7. Choose **Authentication: None** if MCP authentication is requested for this local stdio profile.
8. Attach the app to a new conversation.

Test with:

```text
Use Roblox MCP Bridge to list connected Roblox clients.
```

Use a separate tunnel ID if Roblox Studio MCP and this executor MCP must remain available at the same time.

## 6. Start it after restarting Windows

From the repository folder:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-chatgpt-tunnel.ps1
```

The script prompts for the runtime API key with hidden input and keeps the tunnel in the foreground. Add `-Doctor` to validate the profile before starting:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-chatgpt-tunnel.ps1 -Doctor
```

Then open Roblox, join a game, and inject the executor.

## Troubleshooting order

The tunnel runtime prints a local operator URL. Check:

1. `/readyz`
2. `/ui#overview`
3. `/ui#logs`
4. `http://localhost:16384/`

The tunnel must report ready, the MCP process must be ready, and the Roblox dashboard must show a client before ChatGPT can successfully call executor tools.

## Download only

To download and checksum-verify `tunnel-client.exe` without creating a profile:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-tunnel-client.ps1
```

The default destination is `%LOCALAPPDATA%\OpenAI\tunnel-client`. Pass `-AddToPath` only if you want the installer to modify your user `PATH`.

## Official references

- [OpenAI tunnel-client releases](https://github.com/openai/tunnel-client/releases/latest)
- [OpenAI tunnel-client end-user guide](https://github.com/openai/tunnel-client/blob/master/docs/end-user-guide.md)
- [OpenAI tunnel-client onboarding](https://github.com/openai/tunnel-client/blob/master/docs/onboarding.md)
