import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mainActivity = fs.readFileSync(path.join(root, "android-manager/app/src/main/java/com/ltseverydayyou/robloxmcpmanager/MainActivity.java"), "utf8");
const runner = fs.readFileSync(path.join(root, "android-manager/app/src/main/java/com/ltseverydayyou/robloxmcpmanager/TermuxRunner.java"), "utf8");
const manager = fs.readFileSync(path.join(root, "android-manager/app/src/main/assets/manager.sh"), "utf8");
const manifest = fs.readFileSync(path.join(root, "android-manager/app/src/main/AndroidManifest.xml"), "utf8");

test("Android manager uses Termux's protected command contract", () => {
  assert.match(manifest, /com\.termux\.permission\.RUN_COMMAND/);
  assert.match(runner, /com\.termux\.RUN_COMMAND_PENDING_INTENT/);
  assert.match(runner, /com\.termux\.RUN_COMMAND_STDIN/);
});
test("runtime key is not persisted or passed as a command argument", () => {
  assert.doesNotMatch(mainActivity, /putString\("runtimeKey"/);
  assert.match(mainActivity, /protectedInput = stdin == null \? null : stdin \+ "\\n"/);
  assert.match(manager, /IFS= read -r runtime_key/);
  assert.doesNotMatch(manager, /--api-key/);
});

test("managed processes and downloads are verified before destructive actions", () => {
  assert.match(manager, /\/proc\/\$pid\/cmdline/);
  assert.match(manager, /pull --ff-only/);
  assert.match(manager, /sha256sum/);
  assert.match(manager, /actual.*expected/s);
});

test("executor loader stays on Android localhost", () => {
  assert.match(mainActivity, /BridgeURL = \\"127\.0\.0\.1:/);
  assert.match(manager, /ROBLOX_MCP_HOST=127\.0\.0\.1/);
});
