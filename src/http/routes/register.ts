import type { IncomingMessage, ServerResponse } from "http";
import { registerClient } from "../../bridge/handlers/shared/registry.js";
import { readJsonBody } from "../body.js";

interface RegisterBody {
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

export async function POST(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const info = await readJsonBody<RegisterBody>(req);
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
      transport: "http",
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ clientId }));
  } catch {
    res.writeHead(400);
    res.end("Invalid JSON");
  }
}
