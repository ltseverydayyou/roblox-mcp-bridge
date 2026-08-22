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
const installer = read(`${javaRoot}/AssetInstaller.java`);
const manifest = read("android-manager/app/src/main/AndroidManifest.xml");
const gradle = read("android-manager/app/build.gradle");
const entrypoint = read("android-manager/runtime/main.mjs");
const androidEntrypoint = read("src/android.ts");
const prepare = read("android-manager/scripts/prepare-embedded-runtime.ps1");
const updateChecker = read(`${javaRoot}/ManagerUpdateChecker.java`);

test("Android manager owns an isolated embedded foreground service", () => {
  assert.match(manifest, /android:name="\.BridgeService"/);
  assert.match(manifest, /android:process=":bridge"/);
  assert.match(manifest, /android:foregroundServiceType="dataSync"/);
  assert.doesNotMatch(manifest, /com\.termux/);
  assert.match(bridgeService, /NativeNode\.start/);
  assert.match(bridgeService, /Process\.killProcess\(Process\.myPid\(\)\)/);
  assert.match(bridgeService, /NATIVE_NODE_STARTING/);
  assert.match(bridgeService, /ERROR.*getClass/s);
  assert.match(mainActivity, /refreshStatus\(true, 30\)/);
});

test("embedded Node runtime is pinned to ARM64 and checksum verified", () => {
  assert.match(gradle, /abiFilters "arm64-v8a"/);
  assert.match(prepare, /nodejs-mobile-v18\.17\.3-android\.zip/);
  assert.match(prepare, /d0d1a85314272bd13a16aeb08a88be2a456f323ed80bcbe8ca31bfb83e6d26fc/);
  assert.match(prepare, /Get-FileHash.*SHA256/);
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
  assert.match(entrypoint, /ROBLOX_MCP_HOST = "127\.0\.0\.1"/);
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

test("unfinished tunnel transport cannot persist a runtime key", () => {
  assert.doesNotMatch(mainActivity, /putString\("runtimeKey"/);
  assert.match(mainActivity, /runtimeKeyField\.setText\(""\)/);
  assert.match(mainActivity, /Tunnel transport is not embedded yet/);
});

test("app updates recognize Android production and debug APK names", () => {
  assert.match(updateChecker, /RobloxMcpManager-Android-v/);
  assert.match(updateChecker, /debugFallback/);
  assert.match(updateChecker, /match\.group\(1\)/);
});
