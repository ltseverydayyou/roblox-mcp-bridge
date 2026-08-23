import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "http";
import {
  GetResponseOfIdFromClient,
  SendArbitraryDataToClient,
} from "../../../bridge/handlers/shared/communication.js";
import { getActiveClients } from "../../../bridge/handlers/shared/registry.js";
import {
  clearNilInstanceScan,
  getNilInstanceScan,
  type NilInstanceStoreIdentity,
} from "../../../bridge/handlers/shared/nil-instance-store.js";
import { readJsonBody } from "../../body.js";

interface ScanRequest {
  clientId?: string;
  userConfirmedRisk?: boolean;
  maxTreeNodes?: number;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function resolveIdentity(clientId: string): NilInstanceStoreIdentity | null {
  const client = getActiveClients().find((entry) => entry.clientId === clientId);
  if (!client) return null;
  return {
    clientId: client.clientId,
    placeId: client.placeId,
    jobId: client.jobId,
  };
}

export function GET(_req: IncomingMessage, res: ServerResponse, url: URL): void {
  const clientId = url.searchParams.get("clientId");
  if (!clientId) return json(res, 400, { error: "clientId is required" });

  const identity = resolveIdentity(clientId);
  if (!identity) return json(res, 404, { error: "Client not found" });

  const scan = getNilInstanceScan(identity);
  json(res, 200, scan ? { scan } : { scan: null });
}

export async function POST(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: ScanRequest;
  try {
    body = await readJsonBody<ScanRequest>(req);
  } catch {
    return json(res, 400, { error: "Invalid JSON body" });
  }

  if (!body.clientId) return json(res, 400, { error: "clientId is required" });
  if (body.userConfirmedRisk !== true) {
    return json(res, 400, {
      error: "Explicit risk confirmation is required before nil-instance recovery.",
    });
  }

  const client = getActiveClients().find((entry) => entry.clientId === body.clientId);
  if (!client) return json(res, 404, { error: "Client not found" });

  const maxTreeNodes = Math.min(100_000, Math.max(1_000, Math.floor(Number(body.maxTreeNodes) || 50_000)));
  const scanId = randomUUID();
  const callId = SendArbitraryDataToClient(
    "scan-nil-instances",
    {
      userConfirmedRisk: true,
      maxTreeNodes,
      clientId: client.clientId,
      scanId,
    },
    undefined,
    client.clientId
  );

  if (!callId) return json(res, 500, { error: "Failed to dispatch nil-instance scan to client" });
  if (callId === "INVALID_CLIENT") return json(res, 404, { error: "Client not found" });

  const response = await GetResponseOfIdFromClient(callId, 120_000);
  if (response.error) return json(res, 500, { error: response.error });

  const identity: NilInstanceStoreIdentity = {
    clientId: client.clientId,
    placeId: client.placeId,
    jobId: client.jobId,
  };
  const stored = getNilInstanceScan(identity);
  if (!stored || stored.success !== true || !Array.isArray(stored.instances)) {
    return json(res, 500, {
      error: "Nil-instance scan finished but no streamed scan data was received by the bridge",
    });
  }

  json(res, 200, { scan: stored });
}

export function DELETE(_req: IncomingMessage, res: ServerResponse, url: URL): void {
  const clientId = url.searchParams.get("clientId");
  if (!clientId) return json(res, 400, { error: "clientId is required" });

  const identity = resolveIdentity(clientId);
  if (!identity) return json(res, 404, { error: "Client not found" });

  clearNilInstanceScan(identity);
  json(res, 200, { success: true });
}
