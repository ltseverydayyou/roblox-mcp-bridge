import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const javaRoot = "android-manager/app/src/main/java/com/ltseverydayyou/robloxmcpmanager";
const mainActivity = read(`${javaRoot}/MainActivity.java`);
const bridgeService = read(`${javaRoot}/BridgeService.java`);
const tunnelClient = read(`${javaRoot}/TunnelClient.java`);
const tunnelService = read(`${javaRoot}/TunnelService.java`);
const connectProxy = read(`${javaRoot}/AndroidConnectProxy.java`);
const trustBundle = read(`${javaRoot}/AndroidTrustBundle.java`);
const installer = read(`${javaRoot}/AssetInstaller.java`);
const manifest = read("android-manager/app/src/main/AndroidManifest.xml");
const gradle = read("android-manager/app/build.gradle");
const entrypoint = read("android-manager/runtime/main.mjs");
const androidEntrypoint = read("src/android.ts");
const prepare = read("android-manager/scripts/prepare-embedded-runtime.ps1");
const updateChecker = read(`${javaRoot}/ManagerUpdateChecker.java`);
const updateProvider = read(`${javaRoot}/UpdateFileProvider.java`);
const runtimeUpdateChecker = read(`${javaRoot}/RuntimeUpdateChecker.java`);
const primaryServer = read("src/bridge/handlers/server/primary.ts");
const secondaryServer = read("src/bridge/handlers/server/secondary.ts");
const androidMcp = read("src/http/android-mcp.ts");
const buildAndroid = read("scripts/build-android-manager.ps1");
const runtimeReleaseBuilder = read("scripts/prepare-android-runtime-release.mjs");
const runtimeWorkflow = read(".github/workflows/publish-android-runtime.yml");
const activityLayout = read("android-manager/app/src/main/res/layout/activity_main.xml");
const packageVersion = JSON.parse(read("package.json")).version;

test("Android manager owns an isolated embedded foreground service", () => {
  assert.match(manifest, /android:name="\.BridgeService"/);
  assert.match(manifest, /android:process=":bridge"/);
  assert.match(manifest, /android:foregroundServiceType="specialUse"/);
  assert.match(manifest, /FOREGROUND_SERVICE_SPECIAL_USE/);
  assert.doesNotMatch(manifest, /com\.termux/);
  assert.match(bridgeService, /NativeNode\.start/);
  assert.match(bridgeService, /Process\.killProcess\(Process\.myPid\(\)\)/);
  assert.match(bridgeService, /START_STICKY/);
  assert.match(bridgeService, /desiredRunning/);
  assert.match(bridgeService, /NATIVE_NODE_STARTING/);
  assert.match(bridgeService, /ERROR.*getClass/s);
  assert.match(mainActivity, /refreshStatus\(true, 30\)/);
});

test("embedded Node runtime is pinned to ARM64 and checksum verified", () => {
  assert.match(gradle, /abiFilters "arm64-v8a"/);
  assert.match(prepare, /nodejs-mobile-v18\.17\.3-android\.zip/);
  assert.match(prepare, /d0d1a85314272bd13a16aeb08a88be2a456f323ed80bcbe8ca31bfb83e6d26fc/);
  assert.match(prepare, /Get-FileHash.*SHA256/);
  assert.match(prepare, /libc\+\+_shared\.so/);
  assert.match(prepare, /repoRoot "connector\.luau"/);
  assert.match(prepare, /arm64-r9/);
  assert.match(gradle, /jniLibs\/arm64-v8a\/libc\+\+_shared\.so/);
  assert.match(gradle, /assets\/nodejs-project\/connector\.luau/);
  assert.match(mainActivity, /Node\.js: EMBEDDED 18\.17\.1/);
  assert.match(mainActivity, /Git: NOT REQUIRED/);
  assert.match(mainActivity, new RegExp(`Repository: MCP v${packageVersion.replaceAll(".", "\\.")}`));
});

test("runtime asset activation preserves the previous working bundle", () => {
  assert.match(installer, /embedded-runtime-staging/);
  assert.match(installer, /embedded-runtime-previous/);
  assert.match(installer, /previous\.renameTo\(runtime\)/);
  assert.match(installer, /\.installed-version/);
  assert.match(installer, /runtime-update-id\.txt/);
  assert.match(installer, /RuntimeUpdateChecker\.UPDATE_ID_MARKER/);
});

test("Android MCP source updates are prompted, verified, and atomically activated", () => {
  assert.match(mainActivity, /checkRuntimeUpdate\(false\)/);
  assert.match(mainActivity, /runtimeUpdateButton/);
  assert.match(mainActivity, /MCP source update available/);
  assert.match(runtimeUpdateChecker, /MCP source update available/);
  assert.match(runtimeUpdateChecker, /NotificationManager/);
  assert.match(bridgeService, /UPDATE_CHECK_INTERVAL_MS/);
  assert.match(activityLayout, /Check MCP source update/);
  assert.match(runtimeUpdateChecker, /releases\/tags\/runtime-latest/);
  assert.match(runtimeUpdateChecker, /SHA-256/);
  assert.match(runtimeUpdateChecker, /MAX_ARCHIVE_BYTES/);
  assert.match(runtimeUpdateChecker, /runtime-update\.json/);
  assert.match(runtimeUpdateChecker, /dist\/android\.js/);
  assert.match(runtimeUpdateChecker, /embedded-runtime-before-source-update/);
  assert.match(runtimeUpdateChecker, /renameTo\(runtime\)/);
  assert.match(runtimeReleaseBuilder, /runtimeApi: 1/);
  assert.match(runtimeReleaseBuilder, /RobloxMcpRuntime-v/);
  assert.match(runtimeWorkflow, /Publish rolling runtime release/);
  assert.match(runtimeWorkflow, /contents: write/);
});

test("Android manager release checks notify separately from MCP source updates", () => {
  assert.match(mainActivity, /checkManagerUpdate\(false\)/);
  assert.match(mainActivity, /checkManagerUpdate\(true\)/);
  assert.match(updateChecker, /manager_updates/);
  assert.match(updateChecker, /Roblox MCP Manager update available/);
  assert.match(updateChecker, /NotificationManager/);
  assert.match(bridgeService, /ManagerUpdateChecker\.check/);
  assert.match(bridgeService, /ManagerUpdateChecker\.notifyAvailable/);
  assert.match(activityLayout, /App update/);
});

test("embedded bridge and executor loader stay on Android localhost", () => {
  assert.match(entrypoint, /bridgeHost = process\.argv\[5\] \|\| "127\.0\.0\.1"/);
  assert.match(entrypoint, /ROBLOX_MCP_HOST = bridgeHost/);
  assert.match(entrypoint, /ROBLOX_MCP_UPDATE_CHECK = "false"/);
  assert.match(mainActivity, /BridgeURL = \\"127\.0\.0\.1:/);
  assert.match(mainActivity, /http:\/\/127\.0\.0\.1:/);
  assert.match(mainActivity, /MCP_AutoReconnect/);
  assert.match(mainActivity, /DisableWebSocket = true/);
  assert.match(mainActivity, /Connector stopped:/);
  assert.match(mainActivity, /\/script\.luau/);
  assert.doesNotMatch(mainActivity, /raw\.githubusercontent\.com/);
  assert.match(entrypoint, /dist\/android\.js/);
  assert.doesNotMatch(androidEntrypoint, /StdioServerTransport/);
  assert.match(androidEntrypoint, /await boot\(\)/);
});

test("executor connector accepts mobile request API aliases and reports registration failures", () => {
  const connector = read("connector.luau");
  assert.match(connector, /ExecutorRequest = http_request/);
  assert.match(connector, /ExecutorRequest = httprequest/);
  assert.match(connector, /ExecutorRequest = syn\.request/);
  assert.match(connector, /ExecutorRequest = http\.request/);
  assert.match(connector, /HTTP bridge registration failed:/);
  assert.match(connector, /GetResponseStatus/);
  assert.match(connector, /GetResponseBody/);
});

test("trusted LAN relay is opt-in and bearer-token protected", () => {
  assert.match(mainActivity, /Allow trusted LAN relay|lanModeCheckbox/);
  assert.match(mainActivity, /--baseurl/);
  assert.match(mainActivity, /--relay-token/);
  assert.match(entrypoint, /ROBLOX_MCP_LAN_TOKEN/);
  assert.match(primaryServer, /timingSafeEqual/);
  assert.match(primaryServer, /valid LAN relay token is required/);
  assert.match(secondaryServer, /Authorization: `Bearer \$\{RELAY_TOKEN\}`/);
});

test("official ARM64 tunnel transport never persists a runtime key", () => {
  assert.doesNotMatch(mainActivity, /putString\("runtimeKey"/);
  assert.match(mainActivity, /runtimeKeyField\.setText\(""\)/);
  assert.doesNotMatch(mainActivity, /Tunnel transport is not embedded yet/);
  assert.match(prepare, /tunnel-client-v\$tunnelVersion-linux-arm64\.zip/);
  assert.match(prepare, /6813878a3edb82ebebb32fe5a859bc6327a81cce5bc7b635a2313174d26365d6/);
  assert.match(gradle, /libtunnel-client\.so/);
  assert.match(manifest, /android:name="\.TunnelService"/);
  assert.match(manifest, /android:process=":tunnel"/);
  assert.match(tunnelClient, /CONTROL_PLANE_API_KEY/);
  assert.match(tunnelClient, /CONTROL_PLANE_HTTP_PROXY/);
  assert.match(tunnelClient, /CA_BUNDLE/);
  assert.doesNotMatch(tunnelClient, /SSL_CERT_FILE/);
  assert.match(tunnelService, /AndroidConnectProxy/);
  assert.match(tunnelService, /AndroidTrustBundle\.write/);
  assert.match(connectProxy, /127\.0\.0\.1/);
  assert.match(connectProxy, /api\.openai\.com/);
  assert.match(connectProxy, /mtls\.api\.openai\.com/);
  assert.match(connectProxy, /port != 443/);
  assert.match(connectProxy, /InetAddress\.getAllByName/);
  assert.match(connectProxy, /HTTP\/1\.1 200 Connection Established/);
  assert.match(trustBundle, /TrustManagerFactory\.getDefaultAlgorithm/);
  assert.match(trustBundle, /getAcceptedIssuers/);
  assert.match(trustBundle, /BEGIN CERTIFICATE/);
  assert.doesNotMatch(trustBundle, /ALLOW_ALL|checkServerTrusted.*\{\s*\}/s);
  assert.match(tunnelClient, /sample_mcp_remote_no_auth/);
  assert.match(tunnelClient, /http:\/\/127\.0\.0\.1:.*\/mcp/);
  assert.match(tunnelService, /START_NOT_STICKY/);
  assert.match(tunnelService, /removeExtra\(EXTRA_RUNTIME_KEY\)/);
  assert.match(tunnelService, /ACTION_RESTART/);
  assert.match(tunnelService, /One-tap tunnel restart requested/);
  assert.match(tunnelService, /activeRuntimeKey = null/);
  assert.match(mainActivity, /restartTunnelButton/);
  assert.match(tunnelService, /\/readyz/);
  assert.match(tunnelService, /READY tunnel-client/);
  assert.match(tunnelService, /NOT READY/);
  assert.match(mainActivity, /state\.startsWith\("READY"\)/);
  assert.match(mainActivity, /automatic tunnel doctor/);
  assert.match(mainActivity, /\/ui/);
  assert.doesNotMatch(tunnelService, /SharedPreferences/);
});

test("Android MCP HTTP transport is enabled only in the embedded runtime and restricted to loopback", () => {
  assert.match(entrypoint, /ROBLOX_MCP_HTTP = "true"/);
  assert.match(primaryServer, /isAndroidMcpRequest/);
  assert.match(androidMcp, /StreamableHTTPServerTransport/);
  assert.match(androidMcp, /sessionIdGenerator: undefined/);
  assert.doesNotMatch(androidMcp, /const sessions = new Map/);
  assert.match(androidMcp, /Stateless Android MCP accepts POST requests only/);
  assert.match(androidMcp, /Request reached phone:/);
  assert.match(androidMcp, /isLoopback\(req\.socket\.remoteAddress\)/);
  assert.match(androidMcp, /restricted to localhost/);
  assert.match(androidMcp, /oauth-protected-resource/);
  assert.match(primaryServer, /isAndroidOAuthDiscoveryRequest/);
  assert.match(primaryServer, /res\.writeHead\(404/);
  assert.match(primaryServer, /authorization_servers: \[\]/);
  assert.doesNotMatch(primaryServer, /OAuth protected-resource metadata is not advertised/);
});

test("Android manager explains ChatGPT plugin setup and background survival", () => {
  assert.match(mainActivity, /platform\.openai\.com\/settings\/organization\/api-keys/);
  assert.match(mainActivity, /platform\.openai\.com\/settings\/organization\/tunnels/);
  assert.match(mainActivity, /chatgpt\.com\/plugins/);
  assert.match(mainActivity, /Authentication: No Auth/);
  assert.match(mainActivity, /ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS/);
  assert.match(mainActivity, /isIgnoringBatteryOptimizations/);
  assert.match(manifest, /REQUEST_IGNORE_BATTERY_OPTIMIZATIONS/);
});

test("built-in console keeps vertical touch gestures inside its own scroller", () => {
  assert.match(mainActivity, /ScrollingMovementMethod/);
  assert.match(mainActivity, /requestDisallowInterceptTouchEvent\(true\)/);
  assert.match(mainActivity, /canScrollVertically/);
});

test("app updates download, verify, and invoke Android's installer without a browser", () => {
  assert.match(updateChecker, /RobloxMcpManager-Android-v/);
  assert.match(updateChecker, /releases\?per_page=20/);
  assert.match(updateChecker, /optBoolean\("prerelease"/);
  assert.match(updateChecker, /debugFallback/);
  assert.match(updateChecker, /match\.group\(1\)/);
  assert.match(updateChecker, /Keep a trailing build-flavor "-debug" out of the manifest version group/);
  assert.match(gradle, /RobloxMcpManager-Android-v\$\{android\.defaultConfig\.versionName\}\.apk/);
  assert.doesNotMatch(gradle, /rename \{ "RobloxMcpManager-Android-v\$\{android\.defaultConfig\.versionName\}-debug\.apk"/);
  assert.match(buildAndroid, /RobloxMcpManager-Android-v\$version\.apk/);
  assert.doesNotMatch(buildAndroid, /RobloxMcpManager-Android-v\$version-debug\.apk/);
  assert.match(updateChecker, /MessageDigest\.getInstance\("SHA-256"\)/);
  assert.match(updateChecker, /GET_SIGNING_CERTIFICATES/);
  assert.match(updateChecker, /sameSigners/);
  assert.match(updateChecker, /ACTION_MANAGE_UNKNOWN_APP_SOURCES/);
  assert.match(updateChecker, /application\/vnd\.android\.package-archive/);
  assert.match(updateChecker, /FLAG_GRANT_READ_URI_PERMISSION/);
  assert.doesNotMatch(updateChecker, /openDownload/);
  assert.match(updateProvider, /ParcelFileDescriptor\.MODE_READ_ONLY/);
  assert.match(updateProvider, /Unsupported update URI/);
  assert.match(manifest, /REQUEST_INSTALL_PACKAGES/);
  assert.match(manifest, /android:name="\.UpdateFileProvider"/);
  assert.match(manifest, /android:exported="false"/);
  assert.match(mainActivity, /Download & install/);
  assert.match(mainActivity, /resumePendingInstall/);
});
