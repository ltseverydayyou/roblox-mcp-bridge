import { WebSocket } from "ws";
import { RELAY_TOKEN, WS_PORT } from "../../../config.js";
import {
  resetSecondaryState,
  secondaryResponseResolvers,
  setInstanceRole,
  setRelaySocket,
} from "../shared/communication.js";
import type { RobloxResponse } from "../../types.js";

export function startAsSecondary(
  relayUrl: string = `ws://localhost:${WS_PORT}/mcp-relay`,
  onFailed?: () => void,
  onPromote?: () => void
): void {
  setInstanceRole("secondary");
  resetSecondaryState();

  console.error(`[Secondary] Connecting to primary relay at ${relayUrl} ...`);

  const socket = new WebSocket(relayUrl, RELAY_TOKEN
    ? { headers: { Authorization: `Bearer ${RELAY_TOKEN}` } }
    : undefined);
  setRelaySocket(socket);

  let everConnected = false;

  socket.on("open", () => {
    everConnected = true;
    console.error("[Secondary] Connected to primary via relay.");
  });

  socket.on("message", (rawData) => {
    try {
      const data = JSON.parse(rawData.toString()) as RobloxResponse;
      if (data.id) {
        const resolver = secondaryResponseResolvers.get(data.id);
        if (resolver) {
          resolver(data);
          secondaryResponseResolvers.delete(data.id);
        }
      }
    } catch (e) {
      console.error("[Secondary] Error parsing relay response:", e);
    }
  });

  socket.on("close", () => {
    setRelaySocket(null);
    // Reject all pending resolvers so tool calls don't hang forever.
    for (const [id, resolver] of secondaryResponseResolvers.entries()) {
      resolver({ id, output: undefined });
    }
    secondaryResponseResolvers.clear();

    if (!everConnected && onFailed) {
      console.error("[Secondary] Never connected — remote unreachable. Falling back to primary mode.");
      onFailed();
    } else if (everConnected) {
      console.error("[Secondary] Lost connection to primary. Attempting promotion...");
      onPromote?.();
    }
  });

  socket.on("error", (err) => {
    console.error("[Secondary] Relay socket error:", err.message);
    // "error" is always followed by "close", so fallback is handled there.
  });
}
