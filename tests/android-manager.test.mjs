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
const installer = read(`${javaRoot}/AssetInstaller.java`);
const manifest = read("android-manager/app/src/main/AndroidManifest.xml");
const gradle = read("android-manager/app/build.gradle");
const entrypoint = read("android-manager/runtime/main.mjs");
const androidEntrypoint = read("src/android.ts");
const prepare = read("android-manager/scripts/prepare-embedded-runtime.ps1");
const updateChecker = read(`${javaRoot}/ManagerUpdateChecker.java`);
const updateProvider = read(`${javaRoot}/UpdateFileProvider.java`);
const primaryServer = read("src/bridge/handlers/server/primary.ts");
const secondaryServer = read("src/bridge/handlers/server/secondary.ts");
const androidMcp = read("src/http/android-mcp.ts");

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
  assert.match(gradle, /jniLibs\/arm64-v8a\/libc\+\+_shared\.so/);
  assert.match(mainActivity, /Node\.js: EMBEDDED 18\.17\.1/);
  assert.match(mainActivity, /Git: NOT REQUIRED/);
  assert.match(mainActivity, /Repository: BUNDLED MCP v2\.4\.4/);
});

test("runtime asset activation preserves the previous working bundle", () => {
  assert.match(installer, /embedded-runtime-staging/);
  assert.match(installer, /embedded-runtime-previous/);
  assert.match(installer, /previous\.renameTo\(runtime\)/);
  assert.match(installer, /\.installed-version/);
});

test("embedded bridge and executor loader stay on Android localhost", () => {
  assert.match(entrypoint, /bridgeHost = process\.argv\[5\] \|\| "127\.0\.0\.1"/);
  assert.match(entrypoint, /ROBLOX_MCP_HOST = bridgeHost/);
  assert.match(entrypoint, /ROBLOX_MCP_UPDATE_CHECK = "false"/);
  assert.match(mainActivity, /BridgeURL = \\"127\.0\.0\.1:/);
  assert.match(mainActivity, /http:\/\/127\.0\.0\.1:/);
  assert.match(mainActivity, /MCP_AutoReconnect/);
  assert.match(mainActivity, /\/script\.luau/);
  assert.doesNotMatch(mainActivity, /raw\.githubusercontent\.com/);
  assert.match(entrypoint, /dist\/android\.js/);
  assert.doesNotMatch(androidEntrypoint, /StdioServerTransport/);
  assert.match(androidEntrypoint, /await boot\(\)/);
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
  assert.match(tunnelClient, /sample_mcp_remote_no_auth/);
  assert.match(tunnelClient, /http:\/\/127\.0\.0\.1:.*\/mcp/);
  assert.match(tunnelService, /START_NOT_STICKY/);
  assert.match(tunnelService, /removeExtra\(EXTRA_RUNTIME_KEY\)/);
  assert.doesNotMatch(tunnelService, /SharedPreferences/);
});

test("Android MCP HTTP transport is enabled only in the embedded runtime and restricted to loopback", () => {
  assert.match(entrypoint, /ROBLOX_MCP_HTTP = "true"/);
  assert.match(primaryServer, /isAndroidMcpRequest/);
  assert.match(androidMcp, /StreamableHTTPServerTransport/);
  assert.match(androidMcp, /isLoopback\(req\.socket\.remoteAddress\)/);
  assert.match(androidMcp, /restricted to localhost/);
  assert.match(androidMcp, /oauth-protected-resource/);
  assert.match(primaryServer, /isAndroidOAuthDiscoveryRequest/);
  assert.match(primaryServer, /res\.writeHead\(404/);
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
  assert.match(updateChecker, /debugFallback/);
  assert.match(updateChecker, /match\.group\(1\)/);
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
