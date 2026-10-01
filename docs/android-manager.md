# Roblox MCP Manager for Android

The Android manager runs the Roblox MCP bridge inside its own app process. It bundles an ARM64 build of Node.js Mobile and the compiled bridge, so users do not need Termux, Git, npm, or a separate Node installation. The visible manager interface is the same dashboard HTML/CSS/JavaScript shipped by the localhost MCP website, rendered inside an Android WebView with Android-only manager controls exposed through a native bridge. Roblox itself is unchanged: an executor runs the normal `connector.luau` loader and connects to `127.0.0.1:16384`.

## Runtime design

- Node.js Mobile 18.17.1 is packaged as `libnode.so` for `arm64-v8a`.
- The compiled MCP bridge and its JavaScript dependencies are APK assets. On first use they are atomically extracted to the app's private storage; a version marker avoids unnecessary copies and the previous runtime is retained until activation succeeds.
- A `specialUse` foreground service runs Node in an isolated `:bridge` process. Closing the UI does not stop it; **Stop** terminates only that isolated process, allowing a clean later restart. Android can recreate an ordinarily evicted service with its last saved port and bind address.
- Node binds to Android localhost by default. When **Host MCP site on this phone's LAN IP** is enabled, Android binds the bridge to all interfaces so localhost continues working internally while the manager advertises and opens the phone's current LAN IPv4 URL. Android LAN mode intentionally uses no relay password, so it is only appropriate on trusted Wi-Fi or a private VPN. The WebView uses the exact shared dashboard assets from `src/http/assets/dashboard`; there is no separately recreated Android dashboard skin.
- The embedded Node process does not run Git or overwrite itself. Instead, the manager checks a separate `runtime-latest` GitHub prerelease when the app opens and when the user taps **Check MCP source update**. A source update is shown before installation, downloaded only with approval, checked against GitHub's SHA-256 digest, extracted with path and size limits, and activated with a previous-runtime rollback directory. If the bridge was running, the manager restarts it after activation and the executor's reconnecting loader reconnects automatically.
- The shared Android dashboard preserves the native manager shortcuts: **Refresh status**, **Dashboard** (opens localhost or the active LAN IPv4 dashboard URL), **Copy executor code**, **Copy PC MCP relay arguments**, **Copy setup steps**, API Keys, Tunnels, ChatGPT Plugins, tunnel diagnostics, logs, and the existing bridge/tunnel controls.
- APK updates remain separate under **App update**. The manager checks for a new APK when its UI opens and every six hours while the bridge service is running, then posts a separate **Roblox MCP Manager update available** notification. Native libraries or runtime-dependency changes still require a newer APK; an incompatible source bundle is rejected with an instruction to install that APK first. Refreshed builds may intentionally keep the same `versionName`; the manager compares the published release SHA-256 against the currently installed base APK and treats a changed digest as an update. Same-version rebuilds must increment Android `versionCode`, and dismissals are keyed by version plus digest so replacing an asset can prompt again.
- APK startup now fingerprints the extracted runtime `package.json` against the bundled APK copy. If an APK upgrade changes runtime dependencies while retaining the same bridge/runtime marker, the manager refreshes the embedded runtime automatically instead of retaining stale dependencies. Source-only runtime updates with the same dependency fingerprint remain preserved.
- Runtime dependency fingerprints normalize CRLF/LF line endings before hashing. This keeps the Windows-built APK and Ubuntu-built rolling runtime channel compatible when `package.json` content is identical.

The current APK targets 64-bit ARM phones. It will not install on 32-bit-only devices or x86 emulators.

## Phone setup

1. Install the latest `RobloxMcpManager-Android-vX.Y.Z.apk`. Android may ask permission to install from the browser, file manager, or the manager's built-in updater.
2. Open **Settings** in the manager dashboard and grant **Storage access**. Android 11+ opens the system **All files access** page. This allows the app and embedded MCP runtime to use `/storage/emulated/0/Android MCP`.
3. Tap **Prepare runtime** once. This copies the bundled files; it does not download Termux or development tools.
4. Tap **Start bridge** and wait for the bridge status to become active.
5. Tap **Copy executor code**.
6. Run the copied auto-reconnect code in the mobile executor. It repeatedly fetches `/script.luau` from `127.0.0.1:16384`, waits two seconds after a disconnect/failure, and reconnects without requiring another paste.

## Shared settings storage

User-facing Android manager settings are stored in `/storage/emulated/0/Android MCP/settings.json` instead of `SharedPreferences` in the APK sandbox. This includes bridge port/LAN settings, tunnel profile metadata, update-dismissal state, and Android-manager preferences. The tunnel runtime API key can be **temporary** (default) or explicitly persisted by enabling **Save runtime API key**. A persisted key is stored in this shared settings file until the user disables that option.

On Android, backend MCP configuration files such as `semantic-search.json`, `semantic-embeddings.json`, and `decompiler-settings.json` also resolve under `/storage/emulated/0/Android MCP`. Android 11+ therefore requires the user-granted **All files access** permission. Legacy `manager_settings` preferences are migrated once when shared-storage access is available, then the legacy copy is cleared.

The bridge service keeps update/install transaction files and logs in app-private storage because those are operational state rather than user configuration.

## Shared dashboard UI

The APK no longer maintains a second native card-based manager UI. `MainActivity` renders the repository's existing `src/http/assets/dashboard/index.html`, `dashboard.css`, and `dashboard.js` in a WebView. Gradle packages that source directory directly as APK assets, so Android and the localhost website use the same frontend implementation rather than visually similar copies.

When the dashboard detects the injected `AndroidManager` JavaScript interface, the APK switches into a **settings-only Android manager shell**. The normal Clients/Server/Logs/Scripts navigation and desktop-only dashboard settings are hidden. Only Android bridge/runtime management, shared-storage permission, snapshot accessibility, background battery access, APK/source updates, tunnel-client controls, ChatGPT files, and the embedded Android logs remain visible. The normal localhost dashboard opened in a browser is unchanged.

## Snapshot support

Android manager v0.5.7 includes the **Snapshot support** card for the `screenshot-window` MCP tool. On Android 11 or newer, tap **Enable snapshot support** to open the manager's accessibility-service settings, then enable **Roblox MCP screenshot capture**. Returning to the manager refreshes the card to **SNAPSHOT SUPPORT: ENABLED**. On Android 13 and newer, sideloaded APKs may first require **App settings → Allow restricted settings** before Android permits the accessibility service to be enabled.

The accessibility service exposes its screenshot endpoint only on `127.0.0.1` and uses Android's `takeScreenshot` API. It does not require Termux or root. Android captures the current device display rather than a desktop-style Roblox window, so the `pid` argument is ignored on Android.

## Update MCP source without reinstalling the APK

The manager performs source and APK checks whenever its UI process opens. While the bridge foreground service is running, it also checks both channels every six hours. MCP source changes post an **MCP source update available** notification; APK releases post a separate **Roblox MCP Manager update available** notification. Opening the manager shows **Later** and **Update MCP** choices for source changes. Choosing **Later** suppresses that revision's automatic in-app prompt; **Check MCP source update** and **App update** always check their respective channels again. If notification permission is denied, both manual buttons continue to work.

Source bundles contain only the compiled `dist` tree, `connector.luau`, and a compatibility manifest. They do not contain native libraries, the OpenAI tunnel client, or an APK. The manager verifies the published size and SHA-256 digest, rejects ZIP path traversal and oversized extraction, confirms the runtime API and dependency fingerprint, preserves the current runtime, and swaps the staged source into app-private storage. A failed activation restores the previous runtime.

Pushes to `main` that change MCP runtime files trigger `.github/workflows/publish-android-runtime.yml`, which builds the TypeScript source and replaces the asset on the `runtime-latest` prerelease. Ordinary documentation-only changes do not publish a runtime update.

## Connect a PC Codex or Claude MCP host

The Roblox executor always connects locally to `127.0.0.1:16384`. To let a separate PC MCP host use the phone's connected Roblox client:

1. Connect the phone and PC to the same trusted Wi-Fi or private VPN.
2. Select **Host MCP site on this phone's LAN IP**, then stop and start the bridge.
3. The manager detects the phone's current LAN IPv4 address and shows the MCP site as `http://<phone-ip>:<port>`.
4. Tap **Copy PC MCP relay arguments**. The copied arguments contain only `--baseurl`; Android LAN mode does not generate or require a relay password.

The APK binds to `0.0.0.0` while LAN mode is selected so the phone-local executor and OpenAI tunnel can still use loopback while PCs use the displayed LAN IPv4 address. Because Android LAN mode has no bearer-token protection, never port-forward the bridge, expose it directly to the internet, or enable it on untrusted public Wi-Fi. Changing LAN mode requires a bridge stop/start.

## Keep the bridge running in the background

The bridge must stay active for the Roblox executor and every MCP client to remain connected. Closing the manager screen or removing its UI from Recents does not intentionally stop the isolated foreground service. Its ongoing notification is the visible indication that the service is expected to be alive.

1. In **Background running**, tap **Allow unrestricted battery** and approve Android's prompt. The card reports whether the package is currently exempt from battery optimization.
2. Keep the manager notification enabled. Some vendor Android builds also require **App settings → Battery → Unrestricted** or disabling that vendor's auto-clean/sleep feature.
3. Do not press **Stop**, use Android **Force stop**, or clear the manager with a vendor task cleaner while using the bridge.
4. If the notification disappears or clients disconnect, reopen the manager, check **System health**, and tap **Start** again.

The service is restartable after ordinary memory-pressure eviction and reloads its last bridge settings. Android does not permit an app to defeat an explicit user Force stop, and a reboot still requires the user to reopen and start the manager. Battery exemptions can increase battery usage.

## Create the ChatGPT plugin connection

ChatGPT cannot fetch a service from the phone's `127.0.0.1`. A ChatGPT plugin connection therefore needs an OpenAI tunnel whose runtime is active beside this localhost bridge:

1. Create an [OpenAI Platform API key](https://platform.openai.com/settings/organization/api-keys). Treat it as a secret. Leave **Save runtime API key** off for temporary use, or enable it to persist the key in `/storage/emulated/0/Android MCP/settings.json`.
2. Create a tunnel in [OpenAI Platform tunnels](https://platform.openai.com/settings/organization/tunnels) and copy its `tunnel_...` ID.
3. Start the local Roblox bridge, enter that same tunnel ID and a runtime API key, then tap **Start tunnel**. Start always regenerates the tunnel profile from the currently displayed tunnel ID and bridge port before running Tunnel Doctor, so a stale profile cannot silently use an older tunnel. The status must reach `TUNNEL-CLIENT: READY` before creating or testing the plugin.
4. Open [ChatGPT Plugins](https://chatgpt.com/plugins), tap **+**, enter a name such as **Roblox MCP**, and select **Connection: Tunnel**.
5. Select the same tunnel ID, choose **Authentication: No Auth**, review and acknowledge the custom-MCP risk warning, then tap **Create**.
6. Keep the bridge and tunnel alive whenever the plugin is in use. If Android stops the foreground service, the tunnel exits, or the user presses **Stop**, ChatGPT loses the MCP connection. **Open tunnel diagnostics** displays the tunnel client's local `/ui`; **Refresh logs** includes the tunnel process and readiness history.

While the tunnel service is running, **Restart tunnel** stops and relaunches the official client with the active profile and runtime key. If **Save runtime API key** is disabled, the key is temporary and a later fresh Start requires another paste. If saving is enabled, the key is read from `/storage/emulated/0/Android MCP/settings.json` when Start/Doctor is used with an empty key field.

The app includes direct buttons for all three pages and a **Copy setup steps** action. OpenAI may restrict custom plugin creation or tunnels by account, plan, organization, or workspace policy; the manager cannot change that access.

## ChatGPT tunnel transport status

The APK packages the official ARM64 OpenAI `tunnel-client` executable as an app-private native library and runs it in a second Android foreground service. Its generated profile forwards the selected OpenAI tunnel to `http://127.0.0.1:16384/mcp` (or the configured bridge port). No Termux installation or desktop `.exe` is involved.

Launching the process is not treated as a successful connection. The manager monitors the tunnel client's local `/readyz` endpoint: `CONNECTING` and `NOT READY` mean ChatGPT cannot use the tunnel yet, while `READY` confirms that the client completed its first successful OpenAI control-plane poll. The key is removed from the visible field when Doctor or Start begins; it is never written to logs. Persistence is user-selectable through **Save runtime API key**.

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

The preparation step downloads the official Node.js Mobile v18.17.3 Android archive, requires SHA-256 `d0d1a85314272bd13a16aeb08a88be2a456f323ed80bcbe8ca31bfb83e6d26fc`, builds the MCP server, and packages only production JavaScript dependencies. Android lint then runs and an installable APK is written to `android-manager\app\build\distributions\RobloxMcpManager-Android-vX.Y.Z.apk`. The build directory is ignored by Git; upload the APK as a GitHub Release asset instead of committing it to the repository.

Published Android updates must keep the existing signing identity so Android can install them over earlier releases. scripts/build-android-manager.ps1 verifies the completed APK against the configured local signing keystore and aborts if the signer differs. The private keystore must never be committed or printed.


### Force update when the APK signing certificate changes

Normal Android updates still require the new APK to have the same signing certificate as the installed manager. If the manager downloads a release whose certificate differs, it offers **Force update** instead of discarding the verified APK. The already SHA-256/package-verified replacement is copied to `/storage/emulated/0/Android MCP/updates/RobloxMcpManager-Android-vX.Y.Z.apk`, outside app data so it survives uninstall. The manager does not auto-uninstall itself: uninstalling removes the running app process, so it cannot reliably launch the replacement afterward. The recovery dialog can open the shared update folder first so the user can confirm the APK exists, then offers a separate **Uninstall old app** action. After uninstall, install the staged APK from `Android MCP/updates`. Settings remain in `/storage/emulated/0/Android MCP/settings.json` and survive the reinstall. The Settings page also includes **Clear update cache**, which removes staged APKs in `Android MCP/updates` plus the manager's private pending-update cache without touching settings.

The force path still verifies the GitHub release SHA-256, package name, version, and versionCode before offering the reinstall. A certificate mismatch is the only verification failure that can enter this recovery path.

The Android runtime embeds Node 18.17.1 through nodejs-mobile. `fast-uri` 3.1.8 is pinned for the Android dependency tree and patched at packaging time to replace its `\P{ASCII}` property escape with an equivalent ASCII-range expression that the mobile V8 parser accepts. The rolling-runtime workflow installs the Android-specific production dependencies, applies the same patch, and smoke-tests that packaged runtime under Node 18.17.1 before publishing `runtime-latest`.

A repository workflow, `.github/workflows/publish-android-apk.yml`, can build the Android manager on GitHub Actions and attach the APK to the existing `v2.5.0` release without a Windows MCP machine. When the build certificate differs from the established Android certificate, the build is explicitly marked as requiring the Force update reinstall path.

## Security boundaries

- The copied executor loader always uses localhost. The bridge uses localhost unless the user explicitly enables the authenticated trusted-LAN relay.
- Runtime extraction stays in app-private storage and activates through a staging/previous-directory swap.
- Stop kills only the isolated bridge service process, not the manager UI or another app.
- The app never invokes a shell or grants another app command-execution access.
- Runtime keys are not written to preferences or logs; Doctor and Start clear the field as soon as they begin.
- Compiled MCP source can update independently through the verified rolling runtime channel. Native libraries and runtime dependency changes continue to require a verified APK update.


## Android screenshot tool

`screenshot-window` works on Android 11+ after enabling **Android Settings → Accessibility → Installed apps → Roblox MCP screenshot capture**. Android captures the current display and ignores `pid`.


## Android system bars

The manager applies Android system-bar insets to its WebView so the Settings UI starts below the status bar and stays clear of navigation/gesture areas on edge-to-edge Android releases.
