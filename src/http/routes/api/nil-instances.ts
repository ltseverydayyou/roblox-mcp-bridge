import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "http";
import {
  GetResponseOfIdFromClient,
  SendArbitraryDataToClient,
} from "../../../bridge/handlers/shared/communication.js";
import { getActiveClients } from "../../../bridge/handlers/shared/registry.js";
import {
  takeCompletedNilInstanceScan,
  type NilInstanceRecord,
  type NilInstanceScan,
  type NilInstanceScanIdentity,
} from "../nil-instance-scan.js";

function text(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
}

function encode(value: unknown): string {
  return encodeURIComponent(value == null ? "" : String(value));
}

function formatRecord(item: NilInstanceRecord): string {
  return [
    "ITEM",
    encode(item.DebugId),
    encode(item.Name),
    encode(item.ClassName),
    encode(item.Path),
    encode(item.RelativePath),
    encode(item.ParentDebugId),
    encode(item.RootDebugId),
    String(item.Depth || 0),
    item.IsNilRoot ? "1" : "0",
    item.IsScript ? "1" : "0",
    item.Archivable == null ? "" : item.Archivable ? "1" : "0",
    String(item.ChildCount || 0),
  ].join("\t");
}

function formatScan(scan: NilInstanceScan): string {
  const meta = [
    "META",
    String(scan.capturedRoots || 0),
    String(scan.instances.length),
    String(scan.capturedScripts || 0),
    scan.treeTruncated ? "1" : "0",
    encode(scan.scannedAt),
    encode((scan.sourcesUsed || ["getnilinstances"]).join("\x1f")),
  ].join("\t");
  const rows = scan.instances.map(formatRecord);
  return [meta, ...rows].join("\n");
}

export async function POST(_req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const clientId = url.searchParams.get("clientId") || "";
  const confirmed = url.searchParams.get("confirmed") === "1";
  if (!clientId) return text(res, 400, "clientId is required");
  if (!confirmed) return text(res, 400, "Explicit risk confirmation is required before nil-instance recovery.");

  const client = getActiveClients().find((entry) => entry.clientId === clientId);
  if (!client) return text(res, 404, "Client not found");

  const maxTreeNodes = Math.min(
    100_000,
    Math.max(1_000, Math.floor(Number(url.searchParams.get("maxTreeNodes")) || 50_000))
  );
  const scanId = randomUUID();
  const callId = SendArbitraryDataToClient(
    "scan-nil-instances",
    { userConfirmedRisk: true, maxTreeNodes, clientId: client.clientId, scanId },
    undefined,
    client.clientId
  );

  if (!callId) return text(res, 500, "Failed to dispatch nil-instance scan to client");
  if (callId === "INVALID_CLIENT") return text(res, 404, "Client not found");

  const response = await GetResponseOfIdFromClient(callId, 120_000);
  if (response.error) return text(res, 500, response.error);

  const identity: NilInstanceScanIdentity = {
    clientId: client.clientId,
    placeId: client.placeId,
    jobId: client.jobId,
  };
  const scan = takeCompletedNilInstanceScan(scanId, identity);
  if (!scan) {
    return text(res, 500, "Nil-instance scan finished but no live scan rows were received by the bridge");
  }

  text(res, 200, formatScan(scan));
}
