import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const port = Number.parseInt(process.argv[2] || "16384", 10);
const logArgument = process.argv[3] || path.join(runtimeDir, "bridge.log");
const logPath = path.resolve(logArgument);
const statusPath = path.resolve(process.argv[4] || path.join(runtimeDir, "bridge-service-status.txt"));
const bridgeHost = process.argv[5] || "127.0.0.1";
const lanToken = process.argv[6] || "";

function writeStatus(value) {
  try {
    fs.writeFileSync(statusPath, value, "utf8");
  } catch (error) {
    console.error("[Android] Could not write service status", error);
  }
}

process.chdir(runtimeDir);
process.env.HOME = runtimeDir;
process.env.ROBLOX_MCP_HOST = bridgeHost;
process.env.ROBLOX_MCP_PORT = String(Number.isInteger(port) ? port : 16384);
process.env.ROBLOX_MCP_UPDATE_CHECK = "false";
if (lanToken) process.env.ROBLOX_MCP_LAN_TOKEN = lanToken;

const logStream = fs.createWriteStream(logPath, { flags: "a" });
for (const method of ["log", "info", "warn", "error"]) {
  const original = console[method].bind(console);
  console[method] = (...values) => {
    const line = values.map((value) => value instanceof Error ? value.stack : String(value)).join(" ");
    logStream.write(`[${new Date().toISOString()}] ${line}\n`);
    original(...values);
  };
}

process.on("uncaughtException", (error) => {
  writeStatus(`ERROR JavaScript uncaught exception: ${error?.stack || error}`);
  console.error("[Android] Uncaught exception", error);
});
process.on("unhandledRejection", (error) => {
  writeStatus(`ERROR JavaScript unhandled rejection: ${error?.stack || error}`);
  console.error("[Android] Unhandled rejection", error);
});
writeStatus(`JAVASCRIPT_ENTRY Node ${process.version}`);
console.error(`[Android] Embedded Node ${process.version}; runtime ${runtimeDir}`);
await import("./dist/android.js");
writeStatus(`JAVASCRIPT_LOADED Node ${process.version}`);
