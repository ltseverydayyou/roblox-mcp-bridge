import type { IncomingMessage, ServerResponse } from "http";
import { getActiveClients } from "../../../bridge/handlers/shared/registry.js";
import {
  getScriptSourceIndex,
  type ScriptSourceStoreIdentity,
} from "../../../bridge/handlers/shared/script-source-store.js";
import { loadSemanticSettings, validateSemanticSettings } from "../../../semantic/settings.js";
import { getScriptIndexStatus } from "../../../semantic/vector-index.js";

export async function GET(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const clientId = url.searchParams.get("clientId");
  if (!clientId) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "clientId is required" }));
    return;
  }

  const client = getActiveClients().find((c) => c.clientId === clientId);
  if (!client) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Client not found" }));
    return;
  }

  const identity: ScriptSourceStoreIdentity = {
    clientId: client.clientId,
    placeId: client.placeId,
    jobId: client.jobId,
  };

  const index = getScriptSourceIndex(identity);
  const settings = await loadSemanticSettings();
  const canRead = validateSemanticSettings(settings) === null;

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      clientId: index.clientId,
      hasFinishedMapping: index.hasFinishedMapping,
      mappedSources: index.mappedSources,
      processedSources: index.processedSources,
      sourcesToMap: index.sourcesToMap,
      scripts: index.scripts.map((s) => ({
        debugId: s.debugId,
        path: s.path,
        className: s.className,
        sourceAvailable: s.sourceAvailable,
        sourceError: s.sourceError,
        lines: s.sourceAvailable ? s.source.split("\n").length : 0,
        bytes: s.source.length,
        updatedAt: s.updatedAt,
        hasEmbeddings: s.sourceAvailable && canRead
          ? getScriptIndexStatus(s.debugId, index, settings).isFullyIndexed
          : false,
      })),
    })
  );
}
