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
const chatGptUploadDir = process.argv[7] || path.join(runtimeDir, "chatgpt-files");

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
process.env.ROBLOX_MCP_HTTP = "true";
process.env.ROBLOX_MCP_UPLOAD_DIR = path.resolve(chatGptUploadDir);
fs.mkdirSync(process.env.ROBLOX_MCP_UPLOAD_DIR, { recursive: true });
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

const keepAlive = setInterval(() => {}, 60_000);
keepAlive.ref?.();
let fatalExitScheduled = false;

function fatal(label, error) {
  const detail = error?.stack || error?.message || String(error);
  writeStatus(`ERROR ${label}: ${detail}`);
  console.error(`[Android] ${label}`, error);
  if (fatalExitScheduled) return;
  fatalExitScheduled = true;
  clearInterval(keepAlive);
  setTimeout(() => process.exit(1), 75);
}

process.on("uncaughtException", (error) => fatal("JavaScript uncaught exception", error));
process.on("unhandledRejection", (error) => fatal("JavaScript unhandled rejection", error));

writeStatus(`JAVASCRIPT_ENTRY Node ${process.version}`);
console.error(`[Android] Embedded Node ${process.version}; runtime ${runtimeDir}`);
try {
  await import("./dist/android.js");
  writeStatus(`JAVASCRIPT_LOADED Node ${process.version}`);
  console.error("[Android] Bridge module loaded; embedded runtime keepalive active.");
} catch (error) {
  fatal("JavaScript startup failed", error);
  await new Promise((resolve) => setTimeout(resolve, 100));
  process.exit(1);
}
