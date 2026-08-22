import { boot } from "./bridge/boot.js";
import { installServerLogCapture } from "./http/server-logs.js";
import { SERVER_VERSION } from "./version.js";

// Android hosts only the localhost HTTP/WebSocket bridge. It has no process
// stdio transport, so boot it directly and avoid treating Android's closed
// stdin as an MCP client disconnect.
installServerLogCapture();
console.error(`[Android] Starting localhost bridge v${SERVER_VERSION} (PID ${process.pid}).`);
await boot();
console.error(`[Android] Localhost bridge v${SERVER_VERSION} is ready.`);
