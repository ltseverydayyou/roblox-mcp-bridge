export const serverStartTime = Date.now();
function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

function readPort(value: string | undefined): number {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 16384;
}

export const WS_PORT = readPort(process.env.ROBLOX_MCP_PORT || readArg("--port"));
export const SERVER_HOST = process.env.ROBLOX_MCP_HOST || readArg("--host") || "127.0.0.1";
export const RELAY_TOKEN = process.env.ROBLOX_MCP_LAN_TOKEN || readArg("--relay-token") || "";

const configuredBodyLimit = Number(process.env.ROBLOX_MCP_MAX_BODY_BYTES);
export const MAX_HTTP_BODY_BYTES = Number.isFinite(configuredBodyLimit)
  ? Math.max(1024, Math.floor(configuredBodyLimit))
  : 16 * 1024 * 1024;

const configuredFileLimit = Number(process.env.ROBLOX_MCP_MAX_FILE_BYTES);
export const MAX_CHATGPT_FILE_BYTES = Number.isFinite(configuredFileLimit)
  ? Math.max(1024, Math.floor(configuredFileLimit))
  : 32 * 1024 * 1024;

export const CHATGPT_FILE_DOWNLOAD_TIMEOUT_MS = 60_000;

export const HTTP_POLL_TIMEOUT = 10000;
export const PROMOTION_JITTER_MAX = 300;
export const TOOL_RESPONSE_TIMEOUT = 15000;

const args = process.argv.slice(2);
const baseUrlIdx = args.indexOf("--baseurl");
export const BASE_URL: string | null =
  baseUrlIdx !== -1 ? (args[baseUrlIdx + 1] ?? null) : null;

const serverNameIdx = args.indexOf("--server-name");
export const SERVER_NAME =
  serverNameIdx !== -1 && args[serverNameIdx + 1]
    ? args[serverNameIdx + 1]
    : process.env.ROBLOX_MCP_SERVER_NAME || "roblox-mcp";

if (BASE_URL) {
  console.error(
    `[Config] --baseurl specified: ${BASE_URL} (will run as secondary relay to this host)`,
  );
}
