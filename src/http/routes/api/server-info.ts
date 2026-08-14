import type { IncomingMessage, ServerResponse } from "http";
import { serverStartTime } from "../../../config.js";
import { getActiveClients } from "../../../bridge/handlers/shared/registry.js";
import { SERVER_VERSION } from "../../../version.js";


export function GET(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      startTime: serverStartTime,
      clientCount: getActiveClients().length,
      version: SERVER_VERSION,
    })
  );
}
