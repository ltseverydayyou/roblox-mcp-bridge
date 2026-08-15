import { createServer, IncomingMessage, ServerResponse } from "http";
import { WebSocketServer } from "ws";
import { SERVER_HOST, WS_PORT } from "../../../config.js";
import { SERVER_VERSION } from "../../../version.js";
import { dispatchHttp, dispatchWs, loadRoutes } from "../../../http/router.js";
import {
  resetPrimaryState,
  setInstanceRole,
} from "../shared/communication.js";
import { resetRegistry } from "../shared/registry.js";

export async function startAsPrimary(): Promise<void> {
  await loadRoutes();

  return new Promise((resolve, reject) => {
    setInstanceRole("primary");
    resetRegistry();
    resetPrimaryState();

    const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
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

      const wss = new WebSocketServer({ server: httpServer });
      wss.on("connection", (ws, req) => dispatchWs(ws, req));

      resolve();
    });
  });
}
