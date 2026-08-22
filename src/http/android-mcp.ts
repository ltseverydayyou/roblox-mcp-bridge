import { randomUUID } from "crypto";
import type { IncomingMessage, ServerResponse } from "http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { readJsonBody } from "./body.js";
import { createMcpServer } from "../mcp-server.js";

type Session = {
  server: ReturnType<typeof createMcpServer>;
  transport: StreamableHTTPServerTransport;
};

const sessions = new Map<string, Session>();

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

  const sessionId = typeof req.headers["mcp-session-id"] === "string"
    ? req.headers["mcp-session-id"]
    : undefined;

  try {
    if (req.method === "POST") {
      const body = await readJsonBody<unknown>(req);
      const existing = sessionId ? sessions.get(sessionId) : undefined;
      if (existing) {
        await existing.transport.handleRequest(req, res, body);
        return;
      }
      if (sessionId || !isInitializeRequest(body)) {
        jsonError(res, 400, "No valid MCP session was found. Initialize a new session first.");
        return;
      }

      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (createdSessionId) => {
          sessions.set(createdSessionId, { server, transport });
          console.error(`[Android MCP] Session ${createdSessionId} initialized.`);
        },
      });
      transport.onclose = () => {
        const closedSessionId = transport.sessionId;
        if (closedSessionId) sessions.delete(closedSessionId);
        void server.close();
      };
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }

    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session) {
      jsonError(res, 400, "A valid MCP-Session-Id header is required.");
      return;
    }
    if (req.method === "GET" || req.method === "DELETE") {
      await session.transport.handleRequest(req, res);
      return;
    }
    res.writeHead(405, { Allow: "GET, POST, DELETE" });
    res.end();
  } catch (error) {
    console.error("[Android MCP] Request failed:", error);
    if (!res.headersSent) jsonError(res, 500, "Internal MCP transport error.");
  }
}
