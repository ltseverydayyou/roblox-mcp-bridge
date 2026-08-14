import type { WebSocket } from "ws";
import {
  relayClients,
  relayRequestOrigin,
  requestToClientId,
  SendToClient,
} from "../../bridge/handlers/shared/communication.js";
import {
  formatActiveClientListForTool,
  resolveTargetClient,
} from "../../bridge/handlers/shared/registry.js";

interface RelayMessage {
  id?: string;
  type?: string;
  targetClientId?: string;
  [key: string]: unknown;
}

export function WS(ws: WebSocket): void {
  console.error(`[Primary] Relay client connected. Total: ${relayClients.size + 1}`);
  relayClients.add(ws);

  ws.on("message", (rawData) => {
    try {
      const message: RelayMessage = JSON.parse(rawData.toString());

      // Relay-level request handled directly by the primary.
      if (message.type === "list-clients" && message.id) {
        ws.send(
          JSON.stringify({
            id: message.id,
            output: formatActiveClientListForTool(),
          })
        );
        return;
      }

      if (message.type === "set-active-client" && message.id) {
        const requestedClientId =
          typeof message.targetClientId === "string" ? message.targetClientId : "";
        const target = resolveTargetClient(requestedClientId);
        if (!target) {
          ws.send(
            JSON.stringify({
              id: message.id,
              output: undefined,
              error: `Invalid or inactive client ID: ${requestedClientId}. Use list-clients to get active client IDs.`,
            })
          );
          return;
        }

        ws.send(
          JSON.stringify({
            id: message.id,
            output:
              `Active client set to ${target.clientId} ` +
              `(${target.username} @ ${target.placeName}, ${target.transport}).`,
            clientId: target.clientId,
          })
        );
        return;
      }

      if (message.id) {
        relayRequestOrigin.set(message.id, ws);
      }

      const targetClientId = message.targetClientId;
      if (targetClientId) {
        delete message.targetClientId;
      }

      const target = resolveTargetClient(targetClientId);
      if (target) {
        if (message.id) requestToClientId.set(message.id, target.clientId);
        SendToClient(target, JSON.stringify(message));
      } else if (message.id) {
        relayRequestOrigin.delete(message.id);
        ws.send(
          JSON.stringify({
            id: message.id,
            output: undefined,
            error: "No active Roblox client connected.",
          })
        );
      }
    } catch (e) {
      console.error("[Primary] Error parsing relay message:", e);
    }
  });

  ws.on("close", () => {
    relayClients.delete(ws);
    console.error(`[Primary] Relay client disconnected. Total: ${relayClients.size}`);
    for (const [id, origin] of relayRequestOrigin.entries()) {
      if (origin === ws) relayRequestOrigin.delete(id);
    }
  });

  ws.on("error", (err) => {
    console.error("[Primary] Relay client error:", err.message);
    relayClients.delete(ws);
  });
}
