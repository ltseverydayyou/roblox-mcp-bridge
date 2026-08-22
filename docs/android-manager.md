# Roblox MCP Manager for Android

The Android manager runs the Roblox MCP bridge inside its own app process. It bundles an ARM64 build of Node.js Mobile and the compiled bridge, so users do not need Termux, Git, npm, or a separate Node installation. Roblox itself is unchanged: an executor runs the normal `connector.luau` loader and connects to `127.0.0.1:16384`.

## Runtime design

- Node.js Mobile 18.17.1 is packaged as `libnode.so` for `arm64-v8a`.
- The compiled MCP bridge and its JavaScript dependencies are APK assets. On first use they are atomically extracted to the app's private storage; a version marker avoids unnecessary copies and the previous runtime is retained until activation succeeds.
- A `specialUse` foreground service runs Node in an isolated `:bridge` process. Closing the UI does not stop it; **Stop** terminates only that isolated process, allowing a clean later restart. Android can recreate an ordinarily evicted service with its last saved port, bind address, and relay token.
- Node binds to Android localhost by default. It binds to all interfaces only when the user explicitly enables the authenticated trusted-LAN relay. The app performs a localhost HTTP health check and reads the runtime's append-only log into the built-in console.
- The embedded Node process does not run Git or overwrite itself. Instead, the manager checks a separate `runtime-latest` GitHub prerelease when the app opens and when the user taps **Check MCP source update**. A source update is shown before installation, downloaded only with approval, checked against GitHub's SHA-256 digest, extracted with path and size limits, and activated with a previous-runtime rollback directory. If the bridge was running, the manager restarts it after activation and the executor's reconnecting loader reconnects automatically.
- APK updates remain separate under **App update**. The manager checks for a new APK when its UI opens and every six hours while the bridge service is running, then posts a separate **Roblox MCP Manager update available** notification. Native libraries or runtime-dependency changes still require a newer APK; an incompatible source bundle is rejected with an instruction to install that APK first.

The current APK targets 64-bit ARM phones. It will not install on 32-bit-only devices or x86 emulators.

## Phone setup

1. Install the latest `RobloxMcpManager-Android-vX.Y.Z.apk`. Android may ask permission to install from the browser, file manager, or the manager's built-in updater.
2. Open the manager and tap **Prepare embedded runtime** once. This copies the bundled files; it does not download Termux or development tools.
3. Tap **Start** and wait for the health panel to say `RUNNING`.
4. Tap **Copy executor code**.
5. Run the copied auto-reconnect code in the mobile executor. It repeatedly fetches `/script.luau` from `127.0.0.1:16384`, waits two seconds after a disconnect/failure, and reconnects without requiring another paste.
6. Use **Dashboard** for the local web UI and **Refresh logs** for the built-in console.

## Update MCP source without reinstalling the APK

The manager performs source and APK checks whenever its UI process opens. While the bridge foreground service is running, it also checks both channels every six hours. MCP source changes post an **MCP source update available** notification; APK releases post a separate **Roblox MCP Manager update available** notification. Opening the manager shows **Later** and **Update MCP** choices for source changes. Choosing **Later** suppresses that revision's automatic in-app prompt; **Check MCP source update** and **App update** always check their respective channels again. If notification permission is denied, both manual buttons continue to work.

Source bundles contain only the compiled `dist` tree, `connector.luau`, and a compatibility manifest. They do not contain native libraries, the OpenAI tunnel client, or an APK. The manager verifies the published size and SHA-256 digest, rejects ZIP path traversal and oversized extraction, confirms the runtime API and dependency fingerprint, preserves the current runtime, and swaps the staged source into app-private storage. A failed activation restores the previous runtime.

Pushes to `main` that change MCP runtime files trigger `.github/workflows/publish-android-runtime.yml`, which builds the TypeScript source and replaces the asset on the `runtime-latest` prerelease. Ordinary documentation-only changes do not publish a runtime update.

## Connect a PC Codex or Claude MCP host

The Roblox executor always connects locally to `127.0.0.1:16384`. To let a separate PC MCP host use the phone's connected Roblox client:

1. Connect the phone and PC to the same trusted Wi-Fi or private VPN.
2. Select **Allow trusted LAN relay for PC Codex / Claude**, then stop and start the bridge.
3. Tap **Copy PC MCP relay arguments**.
4. On the PC, keep the normal `roblox-mcp` MCP command and add the copied `--baseurl` and `--relay-token` arguments to its existing argument list.

The APK binds to `0.0.0.0` only while LAN mode is selected, displays the phone's current LAN IPv4 address, and requires a generated bearer token for every non-local HTTP/WebSocket request. Never port-forward the bridge, expose it directly to the internet, or enable it on untrusted public Wi-Fi. Changing LAN mode requires a bridge stop/start.

## Keep the bridge running in the background

The bridge must stay active for the Roblox executor and every MCP client to remain connected. Closing the manager screen or removing its UI from Recents does not intentionally stop the isolated foreground service. Its ongoing notification is the visible indication that the service is expected to be alive.

1. In **Background running**, tap **Allow unrestricted battery** and approve Android's prompt. The card reports whether the package is currently exempt from battery optimization.
2. Keep the manager notification enabled. Some vendor Android builds also require **App settings → Battery → Unrestricted** or disabling that vendor's auto-clean/sleep feature.
3. Do not press **Stop**, use Android **Force stop**, or clear the manager with a vendor task cleaner while using the bridge.
4. If the notification disappears or clients disconnect, reopen the manager, check **System health**, and tap **Start** again.

The service is restartable after ordinary memory-pressure eviction and reloads its last bridge settings. Android does not permit an app to defeat an explicit user Force stop, and a reboot still requires the user to reopen and start the manager. Battery exemptions can increase battery usage.

## Create the ChatGPT plugin connection

ChatGPT cannot fetch a service from the phone's `127.0.0.1`. A ChatGPT plugin connection therefore needs an OpenAI tunnel whose runtime is active beside this localhost bridge:

1. Create an [OpenAI Platform API key](https://platform.openai.com/settings/organization/api-keys). Treat it as a secret; the manager's runtime-key field is memory-only and is never saved.
2. Create a tunnel in [OpenAI Platform tunnels](https://platform.openai.com/settings/organization/tunnels) and copy its `tunnel_...` ID.
3. Start the local Roblox bridge, configure the tunnel runtime with that same tunnel ID, paste a runtime API key, and tap **Start tunnel**. The manager runs Tunnel Doctor automatically and the status must reach `TUNNEL-CLIENT: READY` before creating or testing the plugin.
4. Open [ChatGPT Plugins](https://chatgpt.com/plugins), tap **+**, enter a name such as **Roblox MCP**, and select **Connection: Tunnel**.
5. Select the same tunnel ID, choose **Authentication: No Auth**, review and acknowledge the custom-MCP risk warning, then tap **Create**.
6. Keep the bridge and tunnel alive whenever the plugin is in use. If Android stops the foreground service, the tunnel exits, or the user presses **Stop**, ChatGPT loses the MCP connection. **Open tunnel diagnostics** displays the tunnel client's local `/ui`; **Refresh logs** includes the tunnel process and readiness history.

While the tunnel service is running, **Restart tunnel** stops and relaunches the official client with the profile and runtime key already held in that service's memory. It does not save the key and does not require another Configure or paste. If Android has already killed the service or the user pressed **Stop**, the key no longer exists and Start requires it again.

The app includes direct buttons for all three pages and a **Copy setup steps** action. OpenAI may restrict custom plugin creation or tunnels by account, plan, organization, or workspace policy; the manager cannot change that access.

## ChatGPT tunnel transport status

The APK packages the official ARM64 OpenAI `tunnel-client` executable as an app-private native library and runs it in a second Android foreground service. Its generated profile forwards the selected OpenAI tunnel to `http://127.0.0.1:16384/mcp` (or the configured bridge port). No Termux installation or desktop `.exe` is involved.

Launching the process is not treated as a successful connection. The manager monitors the tunnel client's local `/readyz` endpoint: `CONNECTING` and `NOT READY` mean ChatGPT cannot use the tunnel yet, while `READY` confirms that the client completed its first successful OpenAI control-plane poll. The runtime key remains memory-only, is removed from the screen when Doctor or Start begins, and is never written to preferences or logs.

The phone-local `/mcp` endpoint uses stateless Streamable HTTP. Each tunneled JSON-RPC POST receives a fresh server transport, so restarting the bridge does not leave ChatGPT stuck with a stale `Mcp-Session-Id`. GET and DELETE are intentionally rejected with `405 Method Not Allowed` because the tunnel workflow does not require a persistent server-side session.

Every accepted MCP POST writes only its JSON-RPC method name to the built-in bridge log, for example `[Android MCP] Request reached phone: tools/call (stateless).`; arguments and runtime keys are never logged. If ChatGPT reports a tunnel error but no new marker appears after **Refresh logs**, the request did not reach the phone and the tunnel ID, Platform organization, ChatGPT workspace association, and Tunnels Read + Use permission must be checked upstream.

## Build the APK

Requirements:

- JDK 21
- Android SDK platform 35 and build tools
- Android NDK `27.0.12077973`
- CMake `3.22.1`
- Node.js plus pnpm (preferred) or npm
- Internet access for the pinned Node.js Mobile archive and first dependency download

From the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-android-manager.ps1
```

The preparation step downloads the official Node.js Mobile v18.17.3 Android archive, requires SHA-256 `d0d1a85314272bd13a16aeb08a88be2a456f323ed80bcbe8ca31bfb83e6d26fc`, builds the MCP server, and packages only production JavaScript dependencies. Android lint then runs and an installable debug-signed APK is written to `android-manager\app\build\distributions\RobloxMcpManager-Android-vX.Y.Z.apk`. The build directory is ignored by Git; upload the APK as a GitHub Release asset instead of committing it to the repository.

Public releases should use a private production keystore. The checked-in debug APK is for direct testing and its signature is not suitable as a long-term release identity.

## Security boundaries

- The copied executor loader always uses localhost. The bridge uses localhost unless the user explicitly enables the authenticated trusted-LAN relay.
- Runtime extraction stays in app-private storage and activates through a staging/previous-directory swap.
- Stop kills only the isolated bridge service process, not the manager UI or another app.
- The app never invokes a shell or grants another app command-execution access.
- Runtime keys are not written to preferences or logs; Doctor and Start clear the field as soon as they begin.
- Compiled MCP source can update independently through the verified rolling runtime channel. Native libraries and runtime dependency changes continue to require a verified APK update.
