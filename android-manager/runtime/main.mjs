import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const port = Number.parseInt(process.argv[2] || "16384", 10);
const logArgument = process.argv[3] || path.join(runtimeDir, "bridge.log");
const logPath = path.resolve(logArgument);

process.chdir(runtimeDir);
process.env.HOME = runtimeDir;
process.env.ROBLOX_MCP_HOST = "127.0.0.1";
process.env.ROBLOX_MCP_PORT = String(Number.isInteger(port) ? port : 16384);
process.env.ROBLOX_MCP_UPDATE_CHECK = "false";

const logStream = fs.createWriteStream(logPath, { flags: "a" });
for (const method of ["log", "info", "warn", "error"]) {
  const original = console[method].bind(console);
  console[method] = (...values) => {
    const line = values.map((value) => value instanceof Error ? value.stack : String(value)).join(" ");
    logStream.write(`[${new Date().toISOString()}] ${line}\n`);
    original(...values);
  };
}

process.on("uncaughtException", (error) => console.error("[Android] Uncaught exception", error));
process.on("unhandledRejection", (error) => console.error("[Android] Unhandled rejection", error));
console.error(`[Android] Embedded Node ${process.version}; runtime ${runtimeDir}`);
await import("./dist/index.js");
