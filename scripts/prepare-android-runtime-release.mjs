import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputFlag = process.argv.indexOf("--output");
if (outputFlag < 0 || !process.argv[outputFlag + 1]) {
  throw new Error("Usage: node scripts/prepare-android-runtime-release.mjs --output <directory>");
}

const output = path.resolve(process.argv[outputFlag + 1]);
const manifest = JSON.parse(fs.readFileSync(path.join(repository, "package.json"), "utf8"));
const revision = String(process.env.GITHUB_SHA || execFileSync(
  "git",
  ["-C", repository, "rev-parse", "HEAD"],
  { encoding: "utf8" }
)).trim().toLowerCase();

if (!/^[0-9a-f]{7,40}$/.test(revision)) {
  throw new Error(`Invalid source revision: ${revision}`);
}

const shortRevision = revision.slice(0, 12);
const updateId = `v${manifest.version}-${shortRevision}`;
const dist = path.join(repository, "dist");
const connector = path.join(repository, "connector.luau");
const runtimePackage = path.join(repository, "android-manager", "runtime", "package.json");
if (!fs.existsSync(path.join(dist, "android.js"))) {
  throw new Error("dist/android.js is missing. Run npm run build first.");
}
if (!fs.existsSync(connector)) {
  throw new Error("connector.luau is missing.");
}

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
fs.cpSync(dist, path.join(output, "dist"), { recursive: true });
fs.copyFileSync(connector, path.join(output, "connector.luau"));
const dependencyFingerprint = crypto.createHash("sha256").update(fs.readFileSync(runtimePackage)).digest("hex");
fs.writeFileSync(path.join(output, "runtime-update.json"), `${JSON.stringify({
  schema: 1,
  runtimeApi: 1,
  updateId,
  version: manifest.version,
  revision,
  dependencyFingerprint,
  createdAt: new Date().toISOString()
}, null, 2)}\n`, "utf8");

process.stdout.write(`${JSON.stringify({
  output,
  updateId,
  assetName: `RobloxMcpRuntime-v${manifest.version}-${shortRevision}.zip`
})}\n`);
