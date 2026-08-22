# Roblox MCP Manager for Android

The Android manager runs the Roblox MCP bridge inside its own app process. It bundles an ARM64 build of Node.js Mobile and the compiled bridge, so users do not need Termux, Git, npm, or a separate Node installation. Roblox itself is unchanged: an executor runs the normal `connector.luau` loader and connects to `127.0.0.1:16384`.

## Runtime design

- Node.js Mobile 18.17.1 is packaged as `libnode.so` for `arm64-v8a`.
- The compiled MCP bridge and its JavaScript dependencies are APK assets. On first use they are atomically extracted to the app's private storage; a version marker avoids unnecessary copies and the previous runtime is retained until activation succeeds.
- A `specialUse` foreground service runs Node in an isolated `:bridge` process. Closing the UI does not stop it; **Stop** terminates only that isolated process, allowing a clean later restart. Android can recreate an ordinarily evicted service with its last saved port, bind address, and relay token.
- Node binds to Android localhost by default. It binds to all interfaces only when the user explicitly enables the authenticated trusted-LAN relay. The app performs a localhost HTTP health check and reads the runtime's append-only log into the built-in console.
- Automatic source updates are disabled inside the embedded runtime. The app update checker downloads a new APK release, which keeps the native runtime and JavaScript bundle on the same tested version.

The current APK targets 64-bit ARM phones. It will not install on 32-bit-only devices or x86 emulators.

## Phone setup

1. Install `RobloxMcpManager-Android-v0.3.2-debug.apk`. Android may ask permission to install from the browser or file manager used to open it.
2. Open the manager and tap **Prepare embedded runtime** once. This copies the bundled files; it does not download Termux or development tools.
3. Tap **Start** and wait for the health panel to say `RUNNING`.
4. Tap **Copy executor code**.
5. Run the copied auto-reconnect code in the mobile executor. It repeatedly fetches `/script.luau` from `127.0.0.1:16384`, waits two seconds after a disconnect/failure, and reconnects without requiring another paste.
6. Use **Dashboard** for the local web UI and **Refresh logs** for the built-in console.

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
3. Start the local Roblox bridge, configure the tunnel runtime with that same tunnel ID, and keep both running before creating the plugin. ChatGPT must be able to validate the MCP server through the selected tunnel.
4. Open [ChatGPT Plugins](https://chatgpt.com/plugins), tap **+**, enter a name such as **Roblox MCP**, and select **Connection: Tunnel**.
5. Select the same tunnel ID, choose **Authentication: No Auth**, review and acknowledge the custom-MCP risk warning, then tap **Create**.
6. Keep the bridge and tunnel alive whenever the plugin is in use. If Android stops the foreground service, the tunnel exits, or the user presses **Stop**, ChatGPT loses the MCP connection.

The app includes direct buttons for all three pages and a **Copy setup steps** action. OpenAI may restrict custom plugin creation or tunnels by account, plan, organization, or workspace policy; the manager cannot change that access.

## ChatGPT tunnel transport status

The local Roblox bridge is self-contained in v0.3.2. The APK bundles both `libnode.so` and its required ARM64 `libc++_shared.so` runtime. The ChatGPT tunnel runtime is not yet active in this APK: OpenAI's official tunnel client currently publishes desktop/server binaries, not an Android artifact. The authenticated trusted-LAN relay is an alternative when Codex or Claude runs on a PC that can reach the phone. The old Termux prototype sometimes ran the tunnel's Linux binary, but embedding that assumption would make the supposedly self-contained build device-dependent.

The tunnel fields remain visible for the Android-native transport port. Pressing a tunnel action explains the limitation and immediately clears the runtime-key field. No runtime key is saved. Do not distribute this build as having working ChatGPT tunnel support until that transport passes an on-device end-to-end test.

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

The preparation step downloads the official Node.js Mobile v18.17.3 Android archive, requires SHA-256 `d0d1a85314272bd13a16aeb08a88be2a456f323ed80bcbe8ca31bfb83e6d26fc`, builds the MCP server, and packages only production JavaScript dependencies. Android lint then runs and an installable debug-signed APK is written to `android-manager\app\build\distributions\RobloxMcpManager-Android-vX.Y.Z-debug.apk`. The build directory is ignored by Git; upload the APK as a GitHub Release asset instead of committing it to the repository.

Public releases should use a private production keystore. The checked-in debug APK is for direct testing and its signature is not suitable as a long-term release identity.

## Security boundaries

- The copied executor loader always uses localhost. The bridge uses localhost unless the user explicitly enables the authenticated trusted-LAN relay.
- Runtime extraction stays in app-private storage and activates through a staging/previous-directory swap.
- Stop kills only the isolated bridge service process, not the manager UI or another app.
- The app never invokes a shell or grants another app command-execution access.
- Runtime keys are not written to preferences or logs; tunnel actions clear the field while the transport is unavailable.
- Native and JavaScript runtime updates ship together through the APK update flow.
