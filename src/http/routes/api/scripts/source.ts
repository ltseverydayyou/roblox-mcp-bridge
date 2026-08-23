import type { IncomingMessage, ServerResponse } from "http";
import {
  GetResponseOfIdFromClient,
  SendArbitraryDataToClient,
} from "../../../../bridge/handlers/shared/communication.js";
import { getActiveClients } from "../../../../bridge/handlers/shared/registry.js";
import {
  getScriptSourceIndex,
  upsertScriptSources,
  type ScriptSourceStoreIdentity,
} from "../../../../bridge/handlers/shared/script-source-store.js";
import { readJsonBody } from "../../../body.js";

export async function GET(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const clientId = url.searchParams.get("clientId");
  const debugId = url.searchParams.get("debugId");

  if (!clientId || !debugId) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "clientId and debugId are required" }));
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

  let index = getScriptSourceIndex(identity);
  let script = index.scripts.find((s) => s.debugId === debugId);

  if (!script) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Script not found" }));
    return;
  }

  // The hierarchy sync can know about a LocalScript/ModuleScript before its
  // background source-mapping attempt succeeds. If the dashboard opens one of
  // those entries, ask the live client to decompile that exact DebugId. The
  // get-script-content handler uploads the complete source into this store
  // before returning its bounded preview, so a successful on-demand decompile
  // immediately heals stale "source unavailable" rows.
  if (!script.sourceAvailable) {
    const callId = SendArbitraryDataToClient(
      "get-script-content",
      { debugId, startLine: 1, endLine: 1, maxLines: 1 },
      undefined,
      client.clientId
    );

    if (callId && callId !== "INVALID_CLIENT") {
      try {
        await GetResponseOfIdFromClient(callId, 90_000);
      } catch {
        // Keep the existing metadata/error below if the live fallback times out.
      }

      index = getScriptSourceIndex(identity);
      script = index.scripts.find((s) => s.debugId === debugId) ?? script;
    }
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      debugId: script.debugId,
      path: script.path,
      source: script.source,
      sourceAvailable: script.sourceAvailable,
      sourceError: script.sourceError,
      className: script.className,
      sourceHash: script.sourceHash,
      updatedAt: script.updatedAt,
    })
  );
}

export async function PUT(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: { clientId?: string; debugId?: string; source?: string };
  try {
    body = await readJsonBody(req);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON body" }));
    return;
  }

  const { clientId, debugId, source } = body;

  if (!clientId || !debugId || typeof source !== "string") {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "clientId, debugId, and source are required" }));
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

  // Look up the existing script to get its path
  const currentIndex = getScriptSourceIndex(identity);
  const existing = currentIndex.scripts.find((s) => s.debugId === debugId);

  if (!existing) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Script not found" }));
    return;
  }

  upsertScriptSources(identity, {
    scripts: [{ debugId, path: existing.path, source }],
  });

  const lines = source.split("\n");

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      debugId,
      path: existing.path,
      lines: lines.length,
      bytes: source.length,
    })
  );
}
