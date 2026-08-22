# Roblox MCP Manager for Android

The Android manager runs the Roblox MCP bridge inside its own app process. It bundles an ARM64 build of Node.js Mobile and the compiled bridge, so users do not need Termux, Git, npm, or a separate Node installation. Roblox itself is unchanged: an executor runs the normal `connector.luau` loader and connects to `127.0.0.1:16384`.

## Runtime design

- Node.js Mobile 18.17.1 is packaged as `libnode.so` for `arm64-v8a`.
- The compiled MCP bridge and its JavaScript dependencies are APK assets. On first use they are atomically extracted to the app's private storage; a version marker avoids unnecessary copies and the previous runtime is retained until activation succeeds.
- A foreground service runs Node in an isolated `:bridge` process. Closing the UI does not stop it; **Stop** terminates only that isolated process, allowing a clean later restart.
- Node binds only to Android localhost. The app performs an HTTP health check and reads the runtime's append-only log into the built-in console.
- Automatic source updates are disabled inside the embedded runtime. The app update checker downloads a new APK release, which keeps the native runtime and JavaScript bundle on the same tested version.

The current APK targets 64-bit ARM phones. It will not install on 32-bit-only devices or x86 emulators.

## Phone setup

1. Install `RobloxMcpManager-Android-v0.2.3-debug.apk`. Android may ask permission to install from the browser or file manager used to open it.
2. Open the manager and tap **Prepare embedded runtime** once. This copies the bundled files; it does not download Termux or development tools.
3. Tap **Start** and wait for the health panel to say `RUNNING`.
4. Tap **Copy executor code**.
5. Run the copied auto-reconnect code in the mobile executor. It repeatedly fetches `/script.luau` from `127.0.0.1:16384`, waits two seconds after a disconnect/failure, and reconnects without requiring another paste.
6. Use **Dashboard** for the local web UI and **Refresh logs** for the built-in console.

Android may stop background work under aggressive battery management. Keep the foreground-service notification enabled and exempt the manager from battery optimization if a device vendor repeatedly kills the bridge.

## ChatGPT tunnel status

The local Roblox bridge is self-contained in v0.2.3. The ChatGPT tunnel is not yet active in this APK: OpenAI's official tunnel client currently publishes desktop/server binaries, not an Android artifact. The old Termux prototype sometimes ran its Linux binary, but embedding that assumption would make the supposedly self-contained build device-dependent.

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

- The bridge and copied executor loader use localhost only.
- Runtime extraction stays in app-private storage and activates through a staging/previous-directory swap.
- Stop kills only the isolated bridge service process, not the manager UI or another app.
- The app never invokes a shell or grants another app command-execution access.
- Runtime keys are not written to preferences or logs; tunnel actions clear the field while the transport is unavailable.
- Native and JavaScript runtime updates ship together through the APK update flow.
