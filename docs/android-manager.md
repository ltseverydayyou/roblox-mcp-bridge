# Roblox MCP Manager for Android

The Android manager automates the Termux setup that otherwise requires manually installing packages, cloning the repository, building it, and managing several long-running commands. Roblox itself is not modified: an executor runs the normal `connector.luau` loader and connects to the manager's bridge at `127.0.0.1:16384`.

## Current runtime design

Android prevents unrelated apps from executing each other's private native programs. The first release therefore uses the official Termux `RUN_COMMAND` interface as its runtime boundary:

- Termux provides Android-native Node.js, npm, Git, curl, jq, and unzip packages.
- The manager sends only explicit, user-triggered commands through Termux's protected command service.
- Termux requires both its `RUN_COMMAND` permission and `allow-external-apps=true` before another app can run anything.
- The OpenAI runtime API key is passed through the command's standard input. It is never added to command arguments or Android preferences and is cleared from the UI after doctor/start.
- PID files are accepted only when `/proc/<pid>/cmdline` identifies the expected bridge or tunnel binary.

## Phone setup

1. Install Termux from its official GitHub release or F-Droid build, then open it once.
2. In the manager, tap **Copy permission**. Termux opens; paste and run the copied one-time command. Merely copying it is not enough.
3. Return to the manager and grant **Run commands in Termux environment** when Android asks.
4. Tap **Connect manager to Termux**.
5. Tap **Install all required**. The manager installs Node.js and Git, clones this repository, installs dependencies, and builds `dist/index.js`.
6. Tap **Start**, then **Copy executor code**.
7. Run the copied code in the mobile executor. It connects to `127.0.0.1:16384` using WebSocket when supported and HTTP polling otherwise.

## ChatGPT tunnel

1. Enter the tunnel profile and `tunnel_...` ID.
2. Tap **Install client**. The manager selects the official OpenAI Linux ARM64/AMD64 release, downloads `SHA256SUMS.txt`, and refuses installation unless the archive hash matches.
3. Tap **Configure**.
4. Paste a restricted OpenAI Platform Runtime API key and tap **Doctor**.
5. Paste the key again and tap **Start tunnel**. Android/Termux keeps the managed process alive with a wake lock and writes output to the private manager directory.

OpenAI does not publish an Android-specific tunnel-client artifact. Its statically built Linux artifact is used when it executes successfully under Termux; the installer reports a clear failure instead of retaining an unusable binary when the device/runtime is incompatible.

## Build the APK

Requirements:

- JDK 21
- Android SDK platform 35 and build tools
- Internet access for the first Gradle dependency download

From the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-android-manager.ps1
```

The script runs Android lint and writes an installable debug-signed APK to `release\RobloxMcpManager-Android-vX.Y.Z-debug.apk`, then prints its SHA-256. Public releases should be signed with a private production keystore and uploaded as `RobloxMcpManager-Android-vX.Y.Z.apk`; the app's update checker detects that release asset.

## Security boundaries

- The bridge listens only on Android localhost. The copied executor code also uses localhost.
- The runtime key is memory-only in the Android app and stdin-only across the Termux boundary.
- The manager never sends arbitrary text entered by the user to a shell command string. Repository, branch, port, profile, and tunnel ID are passed as separate process arguments and validated again by the shell manager.
- Repository updates are fast-forward-only.
- Tunnel downloads require the official release checksum.
- Closing the Android UI does not intentionally stop bridge/tunnel processes. Use the explicit stop buttons.
