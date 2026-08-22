import { createServer, IncomingMessage, ServerResponse } from "http";
import { timingSafeEqual } from "crypto";
import { WebSocketServer } from "ws";
import { RELAY_TOKEN, SERVER_HOST, WS_PORT } from "../../../config.js";
import { SERVER_VERSION } from "../../../version.js";
import { dispatchHttp, dispatchWs, loadRoutes } from "../../../http/router.js";
import {
  handleAndroidMcp,
  isAndroidMcpRequest,
  isAndroidOAuthDiscoveryRequest,
} from "../../../http/android-mcp.js";
import {
  resetPrimaryState,
  setInstanceRole,
} from "../shared/communication.js";
import { resetRegistry } from "../shared/registry.js";

function isLoopback(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function hasValidRelayToken(req: IncomingMessage): boolean {
  if (!RELAY_TOKEN || isLoopback(req.socket.remoteAddress)) return true;
  const authorization = req.headers.authorization || "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const expectedBuffer = Buffer.from(RELAY_TOKEN);
  const suppliedBuffer = Buffer.from(supplied);
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

export async function startAsPrimary(): Promise<void> {
  await loadRoutes();

  return new Promise((resolve, reject) => {
    setInstanceRole("primary");
    resetRegistry();
    resetPrimaryState();

    const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (isAndroidOAuthDiscoveryRequest(req)) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("OAuth protected-resource metadata is not advertised.");
        return;
      }
      if (isAndroidMcpRequest(req)) {
        void handleAndroidMcp(req, res);
        return;
      }
      if (!hasValidRelayToken(req)) {
        res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("A valid LAN relay token is required.");
        return;
      }
      void dispatchHttp(req, res);
    });

    httpServer.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(err);
      } else {
        console.error("[Primary] HTTP server error:", err);
        reject(err);
      }
    });

    httpServer.listen(WS_PORT, SERVER_HOST, () => {
      console.error(
        `[Primary] MCP Bridge v${SERVER_VERSION} listening on ${SERVER_HOST}:${WS_PORT} (WebSocket + HTTP)`
      );

      const wss = new WebSocketServer({
        server: httpServer,
        verifyClient: ({ req }: { req: IncomingMessage }) => hasValidRelayToken(req),
      });
      wss.on("connection", (ws, req) => dispatchWs(ws, req));

      resolve();
    });
  });
}
