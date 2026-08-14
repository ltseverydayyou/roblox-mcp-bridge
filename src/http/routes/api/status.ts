import type { IncomingMessage, ServerResponse } from "http";
import { relayClients } from "../../../bridge/handlers/shared/communication.js";
import { getActiveClients } from "../../../bridge/handlers/shared/registry.js";
import { getScriptSourceIndex } from "../../../bridge/handlers/shared/script-source-store.js";
import { loadSemanticSettings, validateSemanticSettings } from "../../../semantic/settings.js";
import { getSemanticIndexStats } from "../../../semantic/vector-index.js";
import { getUpdateStatus } from "../../../update/checker.js";

import { serverStartTime } from "../../../config.js";


export async function GET(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const active = getActiveClients();
  const settings = await loadSemanticSettings();
  const canReadSemanticStats = validateSemanticSettings(settings) === null;

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      startedAt: serverStartTime,

      connected: active.length > 0,
      clientCount: active.length,
      role: "Primary",
      relayClients: relayClients.size,
      update: getUpdateStatus(),
      clients: active.map((c) => {
        const scriptIndex = getScriptSourceIndex({
          clientId: c.clientId,
          placeId: c.placeId,
          jobId: c.jobId,
        });
        const semanticIndex = canReadSemanticStats
          ? getSemanticIndexStats(scriptIndex, settings)
          : { chunkCount: 0, embeddedChunks: 0 };

        return {
          clientId: c.clientId,
          username: c.username,
          userId: c.userId,
          placeId: c.placeId,
          jobId: c.jobId,
          placeName: c.placeName,
          transport: c.transport,
          scriptSync: {
            hasFinishedMapping: scriptIndex.hasFinishedMapping,
            mappedSources: scriptIndex.mappedSources,
            processedSources: scriptIndex.processedSources,
            skippedSources: scriptIndex.skippedSources,
            sourcesToMap: scriptIndex.sourcesToMap,
          },
          semanticIndex,
        };
      }),
    })
  );
}
