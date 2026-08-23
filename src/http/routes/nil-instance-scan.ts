import type { IncomingMessage, ServerResponse } from "http";
import { getActiveClients } from "../../bridge/handlers/shared/registry.js";
import { readBody } from "../body.js";

export interface NilInstanceRecord {
  DebugId?: string;
  Name: string;
  ClassName: string;
  Path?: string;
  RelativePath?: string;
  ParentDebugId?: string;
  RootDebugId?: string;
  Depth: number;
  IsNilRoot: boolean;
  IsScript: boolean;
  Archivable?: boolean;
  ChildCount?: number;
}

export interface NilInstanceScan {
  success: true;
  foundNilInstances: number;
  capturedRoots: number;
  capturedInstances: number;
  recoveredScripts: number;
  capturedScripts: number;
  functionScans: number;
  tableScans: number;
  operations: number;
  maxTreeNodes: number;
  treeTruncated: boolean;
  sourcesUsed: string[];
  instances: NilInstanceRecord[];
  scannedAt: string;
}

export interface NilInstanceScanIdentity {
  clientId: string;
  placeId: number;
  jobId: string;
}

interface PendingScan {
  identity: NilInstanceScanIdentity;
  instances: NilInstanceRecord[];
  startedAt: number;
}

interface CompletedScan {
  identity: NilInstanceScanIdentity;
  scan: NilInstanceScan;
  completedAt: number;
}

const pending = new Map<string, PendingScan>();
const completed = new Map<string, CompletedScan>();
const MAX_PENDING = 20;
const MAX_AGE_MS = 10 * 60 * 1000;
const MAX_INSTANCES = 100_000;
const MAX_BATCH = 512;

function text(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
}

function cleanup(now = Date.now()): void {
  for (const [scanId, state] of pending) {
    if (now - state.startedAt > MAX_AGE_MS) pending.delete(scanId);
  }
  for (const [scanId, state] of completed) {
    if (now - state.completedAt > MAX_AGE_MS) completed.delete(scanId);
  }
  while (pending.size > MAX_PENDING) {
    const oldest = pending.keys().next().value as string | undefined;
    if (!oldest) break;
    pending.delete(oldest);
  }
  while (completed.size > MAX_PENDING) {
    const oldest = completed.keys().next().value as string | undefined;
    if (!oldest) break;
    completed.delete(oldest);
  }
}

function resolveIdentity(clientId: string): NilInstanceScanIdentity | null {
  const client = getActiveClients().find((entry) => entry.clientId === clientId);
  if (!client) return null;
  return { clientId: client.clientId, placeId: client.placeId, jobId: client.jobId };
}

function sameIdentity(a: NilInstanceScanIdentity, b: NilInstanceScanIdentity): boolean {
  return a.clientId === b.clientId && a.placeId === b.placeId && a.jobId === b.jobId;
}

function decode(value: string | undefined): string {
  if (!value) return "";
  try { return decodeURIComponent(value.replace(/\+/g, "%20")); } catch { return value; }
}

function bool(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

function num(value: string | undefined, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseRecord(line: string): NilInstanceRecord | null {
  const fields = line.split("\t");
  if (fields.length < 12) return null;
  const archivable = fields[10] === "" ? undefined : bool(fields[10]);
  return {
    DebugId: decode(fields[0]) || undefined,
    Name: decode(fields[1]) || "Instance",
    ClassName: decode(fields[2]) || "Instance",
    Path: decode(fields[3]) || undefined,
    RelativePath: decode(fields[4]) || undefined,
    ParentDebugId: decode(fields[5]) || undefined,
    RootDebugId: decode(fields[6]) || undefined,
    Depth: Math.max(0, Math.floor(num(fields[7]))),
    IsNilRoot: bool(fields[8]),
    IsScript: bool(fields[9]),
    Archivable: archivable,
    ChildCount: Math.max(0, Math.floor(num(fields[11]))),
  };
}

function parseSummary(raw: string): Omit<NilInstanceScan, "success" | "instances" | "scannedAt"> {
  const values = new Map<string, string>();
  for (const line of raw.split(/\r?\n/)) {
    if (!line) continue;
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    values.set(line.slice(0, tab), line.slice(tab + 1));
  }
  const sourcesRaw = decode(values.get("sourcesUsed"));
  return {
    foundNilInstances: Math.max(0, Math.floor(num(values.get("foundNilInstances")))),
    capturedRoots: Math.max(0, Math.floor(num(values.get("capturedRoots")))),
    capturedInstances: Math.max(0, Math.floor(num(values.get("capturedInstances")))),
    recoveredScripts: Math.max(0, Math.floor(num(values.get("recoveredScripts")))),
    capturedScripts: Math.max(0, Math.floor(num(values.get("capturedScripts")))),
    functionScans: Math.max(0, Math.floor(num(values.get("functionScans")))),
    tableScans: Math.max(0, Math.floor(num(values.get("tableScans")))),
    operations: Math.max(0, Math.floor(num(values.get("operations")))),
    maxTreeNodes: Math.max(0, Math.floor(num(values.get("maxTreeNodes")))),
    treeTruncated: bool(values.get("treeTruncated")),
    sourcesUsed: sourcesRaw ? sourcesRaw.split("\x1f").filter(Boolean) : ["getnilinstances"],
  };
}

export function takeCompletedNilInstanceScan(
  scanId: string,
  identity: NilInstanceScanIdentity
): NilInstanceScan | null {
  cleanup();
  const state = completed.get(scanId);
  if (!state || !sameIdentity(state.identity, identity)) return null;
  completed.delete(scanId);
  return state.scan;
}

export async function POST(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const clientId = url.searchParams.get("clientId") || "";
  const scanId = url.searchParams.get("scanId") || "";
  const phase = url.searchParams.get("phase") || "";

  if (!clientId) return text(res, 400, "clientId is required");
  if (!scanId) return text(res, 400, "scanId is required");
  if (phase !== "start" && phase !== "batch" && phase !== "finish") {
    return text(res, 400, "phase must be start, batch, or finish");
  }

  const identity = resolveIdentity(clientId);
  if (!identity) return text(res, 404, "Client not found");
  cleanup();

  if (phase === "start") {
    completed.delete(scanId);
    pending.set(scanId, { identity, instances: [], startedAt: Date.now() });
    cleanup();
    return text(res, 200, "OK");
  }

  const state = pending.get(scanId);
  if (!state || !sameIdentity(state.identity, identity)) {
    return text(res, 409, "Unknown or expired nil-instance scan");
  }

  let raw = "";
  try {
    raw = await readBody(req);
  } catch (error) {
    return text(res, 413, error instanceof Error ? error.message : "Request body too large");
  }

  if (phase === "batch") {
    const lines = raw ? raw.split(/\r?\n/).filter(Boolean) : [];
    if (lines.length > MAX_BATCH) return text(res, 413, `Batch exceeds ${MAX_BATCH} records`);
    if (state.instances.length + lines.length > MAX_INSTANCES) {
      pending.delete(scanId);
      return text(res, 413, `Scan exceeds ${MAX_INSTANCES} records`);
    }
    for (const line of lines) {
      const record = parseRecord(line);
      if (!record) return text(res, 400, "Malformed nil-instance record");
      state.instances.push(record);
    }
    return text(res, 200, "OK");
  }

  const summary = parseSummary(raw);
  const scan: NilInstanceScan = {
    success: true,
    ...summary,
    capturedInstances: state.instances.length,
    instances: state.instances,
    scannedAt: new Date().toISOString(),
  };
  pending.delete(scanId);
  completed.set(scanId, { identity, scan, completedAt: Date.now() });
  cleanup();
  text(res, 200, "OK");
}
