import type { WebSocket } from "ws";
import { handleRobloxResponse } from "../../bridge/handlers/shared/communication.js";
import {
  getClientIdByWs,
  registerClient,
  unregisterClient,
} from "../../bridge/handlers/shared/registry.js";
import type { RobloxResponse } from "../../bridge/types.js";

interface RegisterMessage {
  type: "register";
  username?: string;
  userId?: number;
  displayName?: string;
  placeId?: number;
  gameId?: number;
  jobId?: string;
  placeName?: string;
  executorName?: string;
  executorVersion?: string;
  robloxVersion?: string;
  platform?: string;
  sessionId?: string;
}

export function WS(ws: WebSocket): void {
  ws.on("message", (rawData) => {
    try {
      const data = JSON.parse(rawData.toString()) as RegisterMessage | RobloxResponse;

      if ((data as RegisterMessage).type === "register") {
        const info = data as RegisterMessage;
        const clientId = registerClient({
          username: info.username || "Unknown",
          userId: info.userId || 0,
          displayName: info.displayName,
          placeId: info.placeId || 0,
          gameId: info.gameId,
          jobId: info.jobId || "",
          placeName: info.placeName || "Unknown",
          executorName: info.executorName,
          executorVersion: info.executorVersion,
          robloxVersion: info.robloxVersion,
          platform: info.platform,
          sessionId: info.sessionId,
          transport: "ws",
          ws,
        });
        ws.send(JSON.stringify({ type: "registered", clientId }));
        return;
      }

      handleRobloxResponse(data as RobloxResponse);
    } catch (e) {
      console.error("[Primary] Error parsing Roblox WS message:", e);
    }
  });

  ws.on("close", () => {
    const clientId = getClientIdByWs(ws);
    if (clientId) unregisterClient(clientId);
    console.error("[Primary] Roblox client disconnected.");
  });
}
