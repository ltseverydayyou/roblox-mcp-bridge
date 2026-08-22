<p align="center">
  <img src="docs/banner.svg" alt="Roblox Executor MCP" width="900"/>
</p>

# Roblox MCP Bridge

An MCP server that allows Agents to interact with a running Roblox game client — execute code, inspect scripts, spy on remotes, and more.

> **Fork attribution:** This repository is a fork and improved continuation of [notpoiu's original Roblox Executor MCP](https://gitlab.com/upio/roblox-executor-mcp), now hosted by [@upio on GitLab](https://gitlab.com/upio). It adds client-inspection, observation, safety, dashboard, desktop-manager, and Android tooling while preserving the original [MIT license](LICENSE).

## Dashboard

Roblox Executor MCP includes a local web dashboard at:

```text
http://localhost:16384/
```

Use it to see connected Roblox clients, inspect scripts, run tools, view server logs, configure semantic search, and index games for semantic script search. The Tools dashboard groups search, client, instance, observation, remote, runtime, and execution utilities, with filtering, response copy/clear controls, and explicit confirmation before risk-sensitive executor operations. The Execute Code panel accepts typed code or a locally selected/dropped `.lua`, `.luau`, or UTF-8 `.txt` file; loading a file never executes it until you click **Send**.

## Features

- **Code Execution** — Run Lua code and fetch data from the game client.
- **ChatGPT File Transfer** — Import complete ChatGPT attachments through native file parameters or execute an uploaded Luau file without copying `/mnt/data` content in chunks.
- **Script Inspection** — Decompile scripts and search across all sources.
- **Instance Search** — CSS-like selectors and hierarchy trees.
- **Typed Instance Inspection** — Batch-read useful properties, attributes, tags, stable debug IDs, and child summaries without arbitrary code.
- **Remote Spy** — Intercept, log, block, and ignore Remotes/Bindables via [Cobalt](https://gitlab.com/upio/cobalt).
- **GUI Interaction** — Click buttons and type into text boxes.
- **Screenshot** — Capture Roblox window screenshots (Windows only).
- **Multi-Client** — Connect multiple Roblox clients at once.
- **Primary / Secondary** — Multiple MCP instances auto-coordinate with automatic promotion. Supports remote relaying via `--baseurl`. See [Advanced](docs/advanced.md).
- **Safe Update Notices** — Checks for new releases in the background and shows a dismissible dashboard notice without installing code automatically.

## Tutorial

[![roblox-executor-mcp installation guide](http://img.youtube.com/vi/Tcy5RNf1TRc/0.jpg)](https://youtube.com/watch?v=Tcy5RNf1TRc)

## Prerequisites

| Requirement | Why it is needed | Official installation |
|---|---|---|
| **Git** | Clone the repository and receive updates. | [Git for Windows](https://git-scm.com/install/windows) |
| **Node.js 18+ with npm** | Run and build the MCP server. Use the current LTS release for a new installation. | [Download Node.js](https://nodejs.org/en/download) |
| **Bun 1.3+** | Run the interactive OpenTUI harness installer. The one-paste/guided installer installs Bun automatically when it is missing. | [Install Bun](https://bun.sh/docs/installation) |
| **A compatible Roblox executor** | Run the Roblox connector. It must support `loadstring` and `request`; WebSocket support is strongly recommended. | Use your executor's official installation instructions. |

On Windows, install Git and Node.js LTS from PowerShell with:

```powershell
winget install --id Git.Git --exact --source winget --accept-package-agreements --accept-source-agreements
winget install --id OpenJS.NodeJS.LTS --exact --source winget --accept-package-agreements --accept-source-agreements
```

Bun is normally installed automatically by `npm run install:harnesses`. For a manual Bun installation, use its official Windows installer:

```powershell
powershell -NoProfile -Command "irm https://bun.sh/install.ps1 | iex"
```

Close and reopen PowerShell after installing prerequisites, then verify them:

```powershell
git --version
node --version
npm --version
bun --version
```

If `winget` is missing, install Microsoft's **App Installer** from Microsoft Store, or use the official download links in the table.

## Installation

### One-paste Windows setup

For the lazy path, paste this entire block into **PowerShell**. It installs Git and Node.js LTS with `winget` when they are missing, refreshes the current terminal's `PATH`, clones (or safely fast-forwards) the bridge in `%USERPROFILE%\roblox-mcp-bridge`, and launches the guided setup wizard:

```powershell
& {
    $ErrorActionPreference = "Stop"
    $BridgeRepositoryUrl = "https://github.com/ltseverydayyou/roblox-mcp-bridge.git"
    $BridgeInstallDirectory = Join-Path $env:USERPROFILE "roblox-mcp-bridge"

    function Update-CurrentProcessPath {
        $MachinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
        $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
        $env:Path = "$MachinePath;$UserPath"
    }

    if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
        throw "winget is required for the one-paste installer. Install App Installer from Microsoft Store, then rerun this block."
    }

    if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) {
        & winget.exe install --id Git.Git --exact --source winget --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) { throw "Git installation failed with exit code $LASTEXITCODE." }
        Update-CurrentProcessPath
    }

    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
        & winget.exe install --id OpenJS.NodeJS.LTS --exact --source winget --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) { throw "Node.js installation failed with exit code $LASTEXITCODE." }
        Update-CurrentProcessPath
    }

    $InstalledNodeVersion = [version]((& node.exe --version).Trim().TrimStart("v"))
    if ($InstalledNodeVersion.Major -lt 18) {
        & winget.exe upgrade --id OpenJS.NodeJS.LTS --exact --source winget --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) { throw "Node.js upgrade failed with exit code $LASTEXITCODE." }
        Update-CurrentProcessPath
    }

    if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) { throw "Git is still unavailable. Open a new PowerShell window and rerun this block." }
    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw "npm is still unavailable. Open a new PowerShell window and rerun this block." }

    if (Test-Path -LiteralPath $BridgeInstallDirectory) {
        if (-not (Test-Path -LiteralPath (Join-Path $BridgeInstallDirectory ".git"))) {
            throw "$BridgeInstallDirectory already exists but is not a Git checkout. Rename or remove it, then rerun this block."
        }
        & git.exe -C $BridgeInstallDirectory pull --ff-only
        if ($LASTEXITCODE -ne 0) { throw "The existing checkout could not be fast-forwarded. Resolve its Git changes, then rerun this block." }
    } else {
        & git.exe clone $BridgeRepositoryUrl $BridgeInstallDirectory
        if ($LASTEXITCODE -ne 0) { throw "Repository clone failed with exit code $LASTEXITCODE." }
    }

    Set-Location -LiteralPath $BridgeInstallDirectory
    & npm.cmd run install:harnesses
    if ($LASTEXITCODE -ne 0) { throw "Bridge setup failed with exit code $LASTEXITCODE." }
}
```

The final installer is guided. It validates the detected MCP folder and opens a native folder picker if it is wrong, lets you choose the AI clients and executor autoexec folders you actually use, configures `localhost:16384` or a trusted LAN/VPN `<ip>:<port>`, and prints the matching Roblox loader. On Windows it also asks whether to create the optional **Roblox MCP Manager** `.exe` and lets you browse for `tunnel-client.exe` and the manager output folder.

### 1. Install Git on Windows

If PowerShell says `git is not recognized`, install Git first:

```powershell
winget install --id Git.Git -e --source winget
```

Close every PowerShell window, open a new one, and verify the installation:

```powershell
git --version
```

If `winget` is unavailable, download Git from [git-scm.com/download/win](https://git-scm.com/download/win), install it, and reopen PowerShell. Do not run the clone command until `git --version` works.

### 2. Clone the server

```powershell
Set-Location $env:USERPROFILE
git clone https://github.com/ltseverydayyou/roblox-mcp-bridge.git
Set-Location .\roblox-mcp-bridge
```

If cloning fails, the `roblox-mcp-bridge` folder is not created, so the following `Set-Location`/`cd` command will also fail. Fix the clone error first.

### 3. Run the harness installer

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

- repairing a wrong or moved MCP folder through a native Windows folder picker
- cross-machine setup on the same LAN
- choosing a custom dashboard/Roblox address such as `192.168.1.25:16384`
- copying the Roblox loader to your clipboard
- optional Ollama `embeddinggemma` setup for semantic indexing
- pulling latest repo changes before install/build
- creating an optional Windows manager `.exe` for update, run, tunnel, path, and status checks

For scripts or shortcuts, the folder and address can also be supplied explicitly:

```powershell
npm run install:harnesses -- --server-root "D:\MCP\roblox-mcp-bridge" --plain
```

The guided installer adds `--host 0.0.0.0` to generated client commands only when a non-loopback bridge address is selected. This is for a trusted LAN/VPN only. The localhost choice stays bound to `127.0.0.1`.

To update an existing install later, run:

```bash
npm run update
```

The update command can stop currently running MCP server processes, optionally pull latest changes, and always rebuilds the server.

The bridge checks its published version shortly after startup and every six hours. When a newer version exists, it logs a notice to stderr, shows a persistent dashboard banner, and exposes the read-only `check-for-updates` MCP tool. The banner can copy `npm run update`; the actual update always requires an explicit user action and a bridge restart. Set `ROBLOX_MCP_UPDATE_CHECK=false` to disable all network update checks.

### Beginner Windows MCP Manager `.exe`

`RobloxMcpManager.exe` is the easiest Windows setup. It is a standalone control panel intended for people who do not want to use Git, npm, or PowerShell manually. Download it from the [latest GitHub release](https://github.com/ltseverydayyou/roblox-mcp-bridge/releases/latest), open it, and click **INSTALL ALL REQUIRED**.

### Android MCP Manager `.apk`

The Android manager bundles Node.js Mobile and the compiled bridge directly in an ARM64 APK. It manages a restartable foreground service, health checks, built-in logs, independent app and MCP-source updates, background/battery guidance, ChatGPT plugin setup links, and copying the executor loader without Termux, Git, npm, or a separate Node installation. On launch and every six hours while the bridge runs, it checks both the rolling, SHA-256-verified MCP runtime channel and Android APK releases, using separate notifications so users know which component changed. **Check MCP source update** and **App update** run those checks on demand. Roblox is unchanged; the executor reaches the bridge at `127.0.0.1:16384`. An opt-in, bearer-token-protected trusted-LAN relay lets a PC Codex or Claude MCP process connect to the phone using `--baseurl http://<phone-ip>:16384` plus the copied `--relay-token`.

See [Roblox MCP Manager for Android](docs/android-manager.md) for the APK build, phone setup, background-running requirements, ChatGPT plugin creation flow, architecture, and current Android tunnel-transport status.

The manager checks each component separately and provides buttons to:

- install Git and Node.js LTS through Windows Package Manager when missing
- clone or repair the MCP repository, install dependencies, and build it
- download and checksum-verify OpenAI `tunnel-client.exe` when ChatGPT Tunnel is needed
- restart itself as administrator when Windows reports access denied
- show fetch/install errors and a live operation log instead of silently failing
- select moved MCP/tunnel paths with native Windows pickers
- choose `localhost:16384` or a trusted LAN/VPN IP and custom port
- check for updates, start the bridge, open the dashboard, and copy the Roblox loader

Git, Node.js, and the MCP build are required. The ChatGPT tunnel client, tunnel ID, and OpenAI Platform runtime API key are optional and only needed for a ChatGPT Tunnel connection. The runtime key box is password-masked, held only in process memory, cleared after use, and **never saved to JSON, the command line, logs, or Git**. The non-secret tunnel ID may be saved for convenience.

For plugin connection creation, the current official OpenAI route is **ChatGPT Settings → Security and login → Developer mode**, then **ChatGPT Plugins → + → Tunnel**. Plugins are officially supported on multiple ChatGPT and Codex surfaces; “ChatGPT Classic” is not documented as a requirement. If a Codex/Worker view gets in the way, switch to the normal Chat/Plugins surface for connection creation. See [OpenAI's connect-and-test guide](https://developers.openai.com/plugins/deploy/connect-chatgpt).

To build the release-ready versioned EXE from an existing checkout, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-manager-release.ps1
```

This writes `release\RobloxMcpManager-vX.Y.Z.exe` using the version from `package.json` and prints its SHA-256. To create or recreate the unversioned launcher directly instead:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\create-windows-launcher.ps1 `
  -RepositoryDirectory (Get-Location).Path `
  -BridgeAddress "localhost:16384" `
  -OutputDirectory (Join-Path $env:USERPROFILE "Desktop\Roblox MCP Manager")
```

To include an existing ChatGPT tunnel client and a custom LAN address:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\create-windows-launcher.ps1 `
  -RepositoryDirectory "D:\MCP\roblox-mcp-bridge" `
  -TunnelClientExecutable "D:\OpenAI Tunnel\tunnel-client.exe" `
  -BridgeAddress "192.168.1.25:16384" `
  -ProfileName "roblox-executor" `
  -OutputDirectory "D:\Roblox MCP Manager"
```

The generated `.exe` now embeds its manager UI and works by itself. It uses a modern dark control-panel layout and embeds the official Luau logo from the same [`luau-lang/site` source](https://github.com/luau-lang/site/blob/master/logo.svg) used by this project's author profile. Starting with v2.3.6, the manager checks GitHub releases for its own updates, verifies the published SHA-256 digest, atomically replaces its launcher while preserving a `.previous-...exe` backup, and offers to restart itself. The updater also compares the running EXE against the release asset SHA-256 when the version number is unchanged, so a rebuilt/replaced `RobloxMcpManager-vX.Y.Z.exe` asset is detected without requiring another version bump. `RobloxMcpManager.config.json` is optional and only prefills non-secret paths/settings; if it is missing, the manager starts with safe defaults and can install or locate everything. No third-party EXE-builder module is downloaded.

### Force-update recovery (Windows)

If the automatic notice does not appear or `npm run update` does not fetch the release, paste this block into PowerShell. It finds a common existing installation, refuses to overwrite a dirty working tree, points `origin` at this maintained repository, fast-forwards to `origin/main`, installs dependencies, and rebuilds:

```powershell
& {
    $ErrorActionPreference = "Stop"
    $BridgeRepositoryUrl = "https://github.com/ltseverydayyou/roblox-mcp-bridge.git"
    $BridgeCandidates = @(
        (Get-Location).Path,
        (Join-Path $env:USERPROFILE "roblox-mcp-bridge"),
        (Join-Path $env:USERPROFILE "Documents\GitHub\roblox-mcp-bridge"),
        (Join-Path $env:USERPROFILE "roblox-executor-mcp")
    ) | Select-Object -Unique

    $BridgeInstallDirectory = $BridgeCandidates | Where-Object {
        Test-Path -LiteralPath (Join-Path $_ ".git") -PathType Container
    } | Where-Object {
        $ManifestPath = Join-Path $_ "package.json"
        if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) { return $false }
        try { (Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json).name -eq "roblox-mcp-server" } catch { $false }
    } | Select-Object -First 1

    if (-not $BridgeInstallDirectory) {
        throw "No existing Roblox MCP checkout was found. Use the one-paste Windows setup above instead."
    }
    if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) { throw "Git is required to update the bridge." }
    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw "Node.js/npm is required to rebuild the bridge." }

    $LocalChanges = & git.exe -C $BridgeInstallDirectory status --porcelain
    if ($LASTEXITCODE -ne 0) { throw "Could not inspect the Git checkout." }
    if ($LocalChanges) {
        throw "The checkout has local changes. Commit or stash them first; this updater will not overwrite them."
    }

    $CurrentOrigin = & git.exe -C $BridgeInstallDirectory remote get-url origin 2>$null
    if ($LASTEXITCODE -ne 0) {
        & git.exe -C $BridgeInstallDirectory remote add origin $BridgeRepositoryUrl
        if ($LASTEXITCODE -ne 0) { throw "Could not add the maintained repository as origin." }
    } elseif ($CurrentOrigin -ne $BridgeRepositoryUrl) {
        & git.exe -C $BridgeInstallDirectory remote set-url origin $BridgeRepositoryUrl
        if ($LASTEXITCODE -ne 0) { throw "Could not set the maintained repository as origin." }
    }

    & git.exe -C $BridgeInstallDirectory fetch origin main
    if ($LASTEXITCODE -ne 0) { throw "Could not fetch origin/main." }
    & git.exe -C $BridgeInstallDirectory merge --ff-only origin/main
    if ($LASTEXITCODE -ne 0) { throw "The checkout cannot be fast-forwarded safely. No files were force-reset." }

    Set-Location -LiteralPath $BridgeInstallDirectory
    & npm.cmd install --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed." }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "Bridge build failed." }

    Write-Host "Roblox MCP Bridge updated successfully. Restart your MCP client/tunnel to load the new build." -ForegroundColor Green
}
```

This recovery updater deliberately uses fast-forward Git operations and stops on local modifications. It never runs `git reset --hard` or silently discards custom work.

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

### 4. Connect from Roblox

The installer prints this for you. Put it in your executor or Auto Execute:

```lua
getgenv().BridgeURL = "127.0.0.1:16384"

if getgenv().MCP_AutoReconnect then
    return
end

getgenv().MCP_AutoReconnect = true

while getgenv().MCP_AutoReconnect do
    local Success, Source = pcall(function()
        return game:HttpGet("http://" .. getgenv().BridgeURL .. "/script.luau")
    end)

    if not Success or type(Source) ~= "string" or Source == "" then
        task.wait(2)
        continue
    end

    local Bridge = loadstring(Source)

    if not Bridge then
        task.wait(2)
        continue
    end

    getgenv().MCP_Loaded = false

    pcall(Bridge)

    getgenv().MCP_Loaded = false

    task.wait(2)
end
```

**Optional settings** (set before the `loadstring`):

```lua
getgenv().BridgeURL = "10.0.0.4:16384"                  -- default: localhost:16384
getgenv().DisableWebSocket = true                        -- force HTTP polling
getgenv().DisableInitialScriptDecompMapping = true       -- skip initial decompilation
```

The bridge binds to `127.0.0.1` by default. For a trusted LAN/VPN setup, explicitly opt in to network listening when starting the server:

```powershell
$env:ROBLOX_MCP_HOST = "0.0.0.0"
npm start
```

The port can also be changed when `16384` is unavailable:

```powershell
$env:ROBLOX_MCP_HOST = "0.0.0.0"
$env:ROBLOX_MCP_PORT = "17384"
npm start
```

Use the same port in Roblox, for example `getgenv().BridgeURL = "192.168.1.25:17384"`. Equivalent command-line options are `node dist/index.js --host 0.0.0.0 --port 17384`.

`ROBLOX_MCP_MAX_BODY_BYTES` optionally changes the HTTP request-body ceiling (default: 16 MiB).

### ChatGPT attachments and `/mnt/data`

ChatGPT's `/mnt/data` directory exists in ChatGPT's cloud sandbox, not on the computer running this MCP server. When connected through an OpenAI tunnel, use:

- `execute-chatgpt-luau` to transfer and execute one complete `.lua`, `.luau`, or UTF-8 `.txt` attachment.
- `import-chatgpt-files` to transfer up to ten complete files of any type into a dedicated local staging directory. It returns the local paths, byte sizes, MIME types, and SHA-256 hashes.

Both tools use ChatGPT's native MCP file parameters. ChatGPT supplies temporary authorized download URLs, so the model should never copy a `/mnt/data/...` path into `execute-file` or send the file in text chunks.

Imported files default to the operating system's temporary directory under `roblox-mcp-bridge/chatgpt-files`. Set `ROBLOX_MCP_UPLOAD_DIR` to choose another dedicated staging directory, or `ROBLOX_MCP_MAX_FILE_BYTES` to change the default 32 MiB per-file import limit. Direct Luau execution has a separate hard limit of 8 MiB.

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

For the complete first-time setup—MCP folder picker, bridge IP/port choice, project build, autoexec installer, tunnel-client install/browse picker, profile creation, optional manager `.exe`, secure runtime-key prompt, diagnostics, and startup—run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-chatgpt-tunnel.ps1
```

For a repeatable setup where the paths are already known, pass them explicitly and suppress only the path dialogs. The tunnel ID and runtime key are still requested securely:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-chatgpt-tunnel.ps1 `
  -RepositoryDirectory "D:\MCP\roblox-mcp-bridge" `
  -TunnelClientExecutable "D:\OpenAI Tunnel\tunnel-client.exe" `
  -BridgeAddress "192.168.1.25:16384" `
  -CreateManager `
  -ManagerOutputDirectory "D:\Roblox MCP Manager" `
  -NoPathPrompts
```

After restarting Windows, start the saved profile with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-chatgpt-tunnel.ps1
```

If the tunnel client is stored somewhere else, start it with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-chatgpt-tunnel.ps1 `
  -TunnelClientExecutable "D:\OpenAI Tunnel\tunnel-client.exe"
```

See the [complete Windows and ChatGPT tunnel setup](docs/windows-chatgpt-tunnel.md) for the Roblox, ChatGPT, restart, and troubleshooting steps.

## Community

Have a suggestion or need help? Join the [Discord server](https://discord.gg/FJcJMuze7S).

## Security

> **This server allows arbitrary code execution.** Only use with AI clients you trust. Port `16384` has no authentication and binds only to localhost by default — **never expose it to the internet.** For cross-machine setups, opt in to a network bind only on a trusted LAN/VPN or use an SSH tunnel. See [Advanced](docs/advanced.md) for details.

## License

[MIT](LICENSE)


## AI-oriented inspection additions

The connector includes bounded, structured tools intended for agent-driven client debugging:

- `get-executor-capabilities` detects executor API support before a tool chooses a strategy.
- `search-executor-functions` safely searches callable paths in `getgenv()`, `getfenv(0)`, and `_G` without invoking them; use a narrow query such as `websocket`, `crypt`, `request`, `file`, or `drawing` when the fixed capability list is not enough. The scan is cycle-safe, bounded, and deduplicates function aliases by default.
- `get-roblox-api-resources` gives agents a curated directory of official Creator Hub/Luau references plus Roblox API Reference, MaximumADHD API History/Client Tracker, raw API dumps, and historical community references. `fetch-roblox-api-reference` can read those vetted public sources directly through MCP without sending cookies or credentials. See [Roblox API reference sources](docs/roblox-api-resources.md).
- `recover-nil-scripts` is an explicit-only heavy recovery operation. Startup and ordinary DebugId/script inspection do not call `getnilinstances`, `getgc`, or registry enumeration. When explicitly invoked after user confirmation, it uses bounded nil/runtime/registry discovery and returns the original nil scripts by DebugId; it does not clone or reparent them.
- Instance-facing inspection/UI tools accept stable `DebugId` targets where applicable.
- `create-console-cursor` + `get-console-output.sinceCursor` return only new console entries.
- `remote-spy` supports `mark`, `sinceCursor`, and `profile`; list ranking is applied after scanning all matching remotes.
- `search-runtime-objects`, `inspect-runtime-object`, and `inspect-function` provide bounded getgc/closure inspection through opaque handles. Detection-prone executor enumeration/introspection requires explicit user confirmation via `userConfirmedRisk=true`.
- Risk-aware MCP policy: before calling `getgc`, `getnilinstances`, `getconnections`, `getloadedmodules`, registry/debug closure APIs, hook APIs, or starting Cobalt remote spying, the AI should ask the user whether to continue. Generic execution tools also scan submitted source for these method calls and refuse unconfirmed risky code. `remote-spy status` is safe and does not load Cobalt; action observation keeps remote capture off by default.
- `inspect-connections`, `search-loaded-modules`, and `inspect-module` expose structured signal/module inspection.
- `inspect-visible-gui`, `get-player-state`, `inspect-animations`, `inspect-sounds`, and `get-performance-stats` avoid repetitive arbitrary-code probes.
- `state-observation` and `observe-action` support before/after diffs across selected properties, LocalPlayer state, console growth, remote traffic, visible GUI, playing sounds, and animations.
