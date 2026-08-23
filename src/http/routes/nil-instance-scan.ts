import type { IncomingMessage, ServerResponse } from "http";
import { getActiveClients } from "../../bridge/handlers/shared/registry.js";
import {
  setNilInstanceScan,
  type NilInstanceRecord,
  type NilInstanceScan,
  type NilInstanceStoreIdentity,
} from "../../bridge/handlers/shared/nil-instance-store.js";
import { readJsonBody } from "../body.js";

interface UploadBody {
  clientId?: string;
  scanId?: string;
  phase?: "start" | "batch" | "finish";
  instances?: NilInstanceRecord[];
  summary?: NilInstanceScan;
}

interface PendingUpload {
  identity: NilInstanceStoreIdentity;
  instances: NilInstanceRecord[];
  startedAt: number;
}

const pending = new Map<string, PendingUpload>();
const MAX_PENDING = 20;
const MAX_AGE_MS = 10 * 60 * 1000;
const MAX_INSTANCES = 100_000;
const MAX_BATCH = 512;

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function cleanupPending(now = Date.now()): void {
  for (const [scanId, state] of pending) {
    if (now - state.startedAt > MAX_AGE_MS) pending.delete(scanId);
  }
  while (pending.size > MAX_PENDING) {
    const oldest = pending.keys().next().value as string | undefined;
    if (!oldest) break;
    pending.delete(oldest);
  }
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

function isSameIdentity(a: NilInstanceStoreIdentity, b: NilInstanceStoreIdentity): boolean {
  return a.clientId === b.clientId && a.placeId === b.placeId && a.jobId === b.jobId;
}

export async function POST(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: UploadBody;
  try {
    body = await readJsonBody<UploadBody>(req);
  } catch {
    return json(res, 400, { error: "Invalid JSON body" });
  }

  if (!body.clientId) return json(res, 400, { error: "clientId is required" });
  if (!body.scanId) return json(res, 400, { error: "scanId is required" });
  if (!body.phase) return json(res, 400, { error: "phase is required" });

  const identity = resolveIdentity(body.clientId);
  if (!identity) return json(res, 404, { error: "Client not found" });

  cleanupPending();

  if (body.phase === "start") {
    pending.set(body.scanId, {
      identity,
      instances: [],
      startedAt: Date.now(),
    });
    cleanupPending();
    return json(res, 200, { ok: true, phase: "start" });
  }

  const state = pending.get(body.scanId);
  if (!state || !isSameIdentity(state.identity, identity)) {
    return json(res, 409, { error: "Unknown or expired nil-instance scan" });
  }

  if (body.phase === "batch") {
    if (!Array.isArray(body.instances)) {
      return json(res, 400, { error: "instances array is required for batch phase" });
    }
    if (body.instances.length > MAX_BATCH) {
      return json(res, 413, { error: `Nil-instance batch exceeds ${MAX_BATCH} records` });
    }
    if (state.instances.length + body.instances.length > MAX_INSTANCES) {
      pending.delete(body.scanId);
      return json(res, 413, { error: `Nil-instance scan exceeds ${MAX_INSTANCES} records` });
    }
    state.instances.push(...body.instances);
    return json(res, 200, { ok: true, phase: "batch", received: body.instances.length, total: state.instances.length });
  }

  if (!body.summary || body.summary.success !== true) {
    return json(res, 400, { error: "Successful summary is required for finish phase" });
  }

  const stored = setNilInstanceScan(identity, {
    ...body.summary,
    success: true,
    instances: state.instances,
    capturedInstances: state.instances.length,
    containedInstances: Math.max(0, state.instances.length - Number(body.summary.capturedRoots || 0)),
    scannedAt: new Date().toISOString(),
  });
  pending.delete(body.scanId);
  json(res, 200, { ok: true, phase: "finish", capturedInstances: stored.instances?.length || 0 });
}
