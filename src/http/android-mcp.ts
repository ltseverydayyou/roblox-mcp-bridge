import type { IncomingMessage, ServerResponse } from "http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { readJsonBody } from "./body.js";
import { createMcpServer } from "../mcp-server.js";

function isLoopback(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function jsonError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}

export function isAndroidMcpRequest(req: IncomingMessage): boolean {
  if (process.env.ROBLOX_MCP_HTTP !== "true") return false;
  const path = new URL(req.url || "/", "http://127.0.0.1").pathname;
  return path === "/mcp";
}

export function isAndroidOAuthDiscoveryRequest(req: IncomingMessage): boolean {
  if (process.env.ROBLOX_MCP_HTTP !== "true") return false;
  const path = new URL(req.url || "/", "http://127.0.0.1").pathname;
  return path === "/.well-known/oauth-protected-resource" ||
    path.startsWith("/.well-known/oauth-protected-resource/");
}

export async function handleAndroidMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isLoopback(req.socket.remoteAddress)) {
    jsonError(res, 403, "The Android MCP transport is restricted to localhost.");
    return;
  }

  try {
    if (req.method === "POST") {
      const body = await readJsonBody<unknown>(req);
      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        // Tunnel work can arrive after the Android bridge has restarted while
        // ChatGPT still holds an older Mcp-Session-Id. Stateless mode is an
        // official Streamable HTTP mode and deliberately ignores that stale
        // header instead of stranding all subsequent tool calls on HTTP 404.
        sessionIdGenerator: undefined,
      });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }

    res.writeHead(405, {
      Allow: "POST",
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Stateless Android MCP accepts POST requests only." },
      id: null,
    }));
  } catch (error) {
    console.error("[Android MCP] Request failed:", error);
    if (!res.headersSent) jsonError(res, 500, "Internal MCP transport error.");
  }
}
