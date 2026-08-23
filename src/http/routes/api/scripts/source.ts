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
  let liveLookupError: string | undefined;

  // Normal indexed scripts and manually discovered nil scripts both resolve by
  // DebugId. Nil scripts are intentionally not injected into the regular script
  // hierarchy during scanning, so they may not exist in the source store yet.
  // Ask the live client to decompile the exact DebugId whenever the stored entry
  // is missing or unavailable. The connector caches nil scan results by DebugId,
  // and get-script-content uploads the full decompiled source into this store.
  if (!script || !script.sourceAvailable) {
    const callId = SendArbitraryDataToClient(
      "get-script-content",
      { debugId, startLine: 1, endLine: 1, maxLines: 1 },
      undefined,
      client.clientId
    );

    if (callId && callId !== "INVALID_CLIENT") {
      try {
        const liveResponse = await GetResponseOfIdFromClient(callId, 90_000);
        if (liveResponse.error) liveLookupError = liveResponse.error;
      } catch (error) {
        liveLookupError = error instanceof Error ? error.message : String(error);
      }

      index = getScriptSourceIndex(identity);
      script = index.scripts.find((s) => s.debugId === debugId) ?? script;
    } else if (callId === "INVALID_CLIENT") {
      liveLookupError = "Client not found";
    } else {
      liveLookupError = "Failed to dispatch live script decompile";
    }
  }

  if (!script) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      error: liveLookupError || "Script was found by the nil-instance scan but is no longer available on the live client",
    }));
    return;
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
