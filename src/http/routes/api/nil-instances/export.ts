import type { IncomingMessage, ServerResponse } from "http";
import {
  GetResponseOfIdFromClient,
  SendArbitraryDataToClient,
} from "../../../../bridge/handlers/shared/communication.js";
import { getActiveClients } from "../../../../bridge/handlers/shared/registry.js";
import {
  getNilInstanceScan,
  type NilInstanceRecord,
  type NilInstanceStoreIdentity,
} from "../../../../bridge/handlers/shared/nil-instance-store.js";
import {
  getScriptSourceIndex,
  type ScriptSourceStoreIdentity,
} from "../../../../bridge/handlers/shared/script-source-store.js";

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function safeFilenamePart(value: unknown, fallback: string): string {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/\.+$/g, "")
    .slice(0, 80);
  return cleaned || fallback;
}

function timestampForFilename(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function zipDosDateTime(date = new Date()): { date: number; time: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[i] = c >>> 0;
}

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  path: string;
  data: Buffer;
  modifiedAt?: Date;
}

function buildZip(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;
  const utf8Flag = 1 << 11;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8");
    const data = entry.data;
    const crc = crc32(data);
    const dos = zipDosDateTime(entry.modifiedAt);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(utf8Flag, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dos.time, 10);
    local.writeUInt16LE(dos.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(utf8Flag, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dos.time, 12);
    central.writeUInt16LE(dos.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0o100644 * 0x10000, 38);
    central.writeUInt32LE(offset, 42);
    centralChunks.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralOffset = offset;
  const centralSize = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, ...centralChunks, end]);
}

function uniquePath(basePath: string, used: Set<string>): string {
  if (!used.has(basePath)) {
    used.add(basePath);
    return basePath;
  }

  const dot = basePath.lastIndexOf(".");
  const slash = basePath.lastIndexOf("/");
  const hasExt = dot > slash;
  const stem = hasExt ? basePath.slice(0, dot) : basePath;
  const ext = hasExt ? basePath.slice(dot) : "";
  let n = 2;
  let candidate = `${stem}-${n}${ext}`;
  while (used.has(candidate)) {
    n += 1;
    candidate = `${stem}-${n}${ext}`;
  }
  used.add(candidate);
  return candidate;
}

function relativeSegments(record: NilInstanceRecord): string[] {
  const raw = String(record.RelativePath || record.Name || "script")
    .split(/[\\/]+/)
    .map((part) => safeFilenamePart(part, "instance"))
    .filter(Boolean);
  return raw.length > 0 ? raw : ["instance"];
}

function buildTreeText(instances: NilInstanceRecord[]): string {
  const roots = instances.filter((record) => record.IsNilRoot);
  const rootOrder = new Map<string, number>();
  roots.forEach((root, index) => {
    const rootKey = root.RootDebugId || root.DebugId;
    if (rootKey) rootOrder.set(rootKey, index);
  });

  const sorted = [...instances].sort((a, b) => {
    const ar = rootOrder.get(a.RootDebugId || a.DebugId || "") ?? Number.MAX_SAFE_INTEGER;
    const br = rootOrder.get(b.RootDebugId || b.DebugId || "") ?? Number.MAX_SAFE_INTEGER;
    if (ar !== br) return ar - br;
    return String(a.RelativePath || a.Name).localeCompare(String(b.RelativePath || b.Name));
  });

  return sorted.map((record) => {
    const depth = Math.max(0, Number(record.Depth) || 0);
    const marker = record.IsScript ? "[script]" : `[${record.ClassName}]`;
    const id = record.DebugId ? ` <${record.DebugId}>` : "";
    return `${"  ".repeat(depth)}${record.Name} ${marker}${id}`;
  }).join("\n");
}

async function ensureScriptSource(
  clientId: string,
  identity: ScriptSourceStoreIdentity,
  debugId: string
): Promise<{ source?: string; path?: string; error?: string }> {
  let index = getScriptSourceIndex(identity);
  let stored = index.scripts.find((script) => script.debugId === debugId);
  if (stored?.sourceAvailable) return { source: stored.source, path: stored.path };

  const callId = SendArbitraryDataToClient(
    "get-script-content",
    { debugId, startLine: 1, endLine: 1, maxLines: 1 },
    undefined,
    clientId
  );
  if (!callId) return { error: "Failed to dispatch decompile request" };
  if (callId === "INVALID_CLIENT") return { error: "Client disconnected" };

  const response = await GetResponseOfIdFromClient(callId, 90_000);
  if (response.error) return { error: response.error };

  index = getScriptSourceIndex(identity);
  stored = index.scripts.find((script) => script.debugId === debugId);
  if (!stored?.sourceAvailable) {
    return { error: stored?.sourceError || "Decompiler returned without storing source" };
  }
  return { source: stored.source, path: stored.path };
}

export async function GET(_req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const clientId = url.searchParams.get("clientId");
  if (!clientId) return json(res, 400, { error: "clientId is required" });

  const client = getActiveClients().find((entry) => entry.clientId === clientId);
  if (!client) return json(res, 404, { error: "Client not found" });

  const nilIdentity: NilInstanceStoreIdentity = {
    clientId: client.clientId,
    placeId: client.placeId,
    jobId: client.jobId,
  };
  const scan = getNilInstanceScan(nilIdentity);
  if (!scan) {
    return json(res, 409, {
      error: "No nil-instance scan is cached. Run Scan Nil Instances manually first.",
    });
  }

  const instances = Array.isArray(scan.instances) ? scan.instances : [];
  if (instances.length === 0) {
    return json(res, 409, { error: "The cached nil-instance scan contains no instances" });
  }

  const scriptIdentity: ScriptSourceStoreIdentity = {
    clientId: client.clientId,
    placeId: client.placeId,
    jobId: client.jobId,
  };
  const scripts = instances.filter(
    (record) => record.IsScript && typeof record.DebugId === "string" && record.DebugId.length > 0
  );
  const scriptResults = new Map<string, { source?: string; path?: string; error?: string }>();
  let nextScript = 0;
  const workerCount = Math.min(2, scripts.length);

  async function worker(): Promise<void> {
    while (true) {
      const index = nextScript++;
      if (index >= scripts.length) return;
      const record = scripts[index]!;
      const debugId = record.DebugId!;
      if (scriptResults.has(debugId)) continue;
      scriptResults.set(debugId, await ensureScriptSource(client.clientId, scriptIdentity, debugId));
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const exportedAt = new Date();
  const place = safeFilenamePart(client.placeName || client.placeId, "place");
  const clientName = safeFilenamePart(client.username || client.clientId, "client");
  const rootFolder = `nil-instances-${place}-${clientName}-${timestampForFilename(exportedAt)}`;
  const usedPaths = new Set<string>();
  const entries: ZipEntry[] = [];
  const roots = instances.filter((record) => record.IsNilRoot);
  const rootFolderByDebugId = new Map<string, string>();

  roots.forEach((root, index) => {
    const rootKey = root.RootDebugId || root.DebugId || `unresolved:${index + 1}`;
    const suffix = safeFilenamePart((root.DebugId || rootKey || String(index + 1)).slice(0, 8), String(index + 1));
    const folder = `${String(index + 1).padStart(3, "0")}-${safeFilenamePart(root.Name, "nil")}-${suffix}`;
    rootFolderByDebugId.set(rootKey, folder);
  });

  const scriptManifest: Array<Record<string, unknown>> = [];
  for (const record of scripts) {
    const debugId = record.DebugId!;
    const result = scriptResults.get(debugId) || { error: "Source was not requested" };
    const rootId = record.RootDebugId || (record.IsNilRoot ? record.DebugId : undefined) || "";
    const rootFolderName = rootFolderByDebugId.get(rootId) || "unresolved-root";
    const segments = relativeSegments(record);
    if (segments.length > 1) segments.shift();
    const last = segments.pop() || safeFilenamePart(record.Name, "script");
    const fileName = /\.(lua|luau)$/i.test(last) ? last : `${last}.luau`;
    const folder = segments.length > 0 ? `${segments.join("/")}/` : "";
    const sourcePath = uniquePath(`${rootFolder}/roots/${rootFolderName}/scripts/${folder}${fileName}`, usedPaths);

    if (typeof result.source === "string") {
      entries.push({
        path: sourcePath,
        data: Buffer.from(result.source, "utf8"),
        modifiedAt: exportedAt,
      });
      scriptManifest.push({
        debugId,
        name: record.Name,
        className: record.ClassName,
        relativePath: record.RelativePath,
        file: sourcePath.slice(rootFolder.length + 1),
        sourceAvailable: true,
      });
    } else {
      const errorPath = uniquePath(sourcePath.replace(/\.luau$/i, ".source-error.txt"), usedPaths);
      entries.push({
        path: errorPath,
        data: Buffer.from(result.error || "Source unavailable", "utf8"),
        modifiedAt: exportedAt,
      });
      scriptManifest.push({
        debugId,
        name: record.Name,
        className: record.ClassName,
        relativePath: record.RelativePath,
        file: errorPath.slice(rootFolder.length + 1),
        sourceAvailable: false,
        sourceError: result.error || "Source unavailable",
      });
    }
  }

  const manifest = {
    exportVersion: 1,
    exportedAt: exportedAt.toISOString(),
    client: {
      clientId: client.clientId,
      username: client.username,
      userId: client.userId,
      placeId: client.placeId,
      placeName: client.placeName,
      jobId: client.jobId,
      transport: client.transport,
    },
    scan: {
      scannedAt: scan.scannedAt,
      foundNilInstances: scan.foundNilInstances,
      capturedRoots: scan.capturedRoots,
      capturedInstances: scan.capturedInstances,
      containedInstances: scan.containedInstances,
      recoveredScripts: scan.recoveredScripts,
      capturedScripts: scan.capturedScripts,
      treeTruncated: scan.treeTruncated,
      maxTreeNodes: scan.maxTreeNodes,
      sourcesUsed: scan.sourcesUsed,
    },
    instances,
    scripts: scriptManifest,
  };

  entries.unshift(
    {
      path: `${rootFolder}/manifest.json`,
      data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8"),
      modifiedAt: exportedAt,
    },
    {
      path: `${rootFolder}/tree.txt`,
      data: Buffer.from(buildTreeText(instances), "utf8"),
      modifiedAt: exportedAt,
    }
  );

  const zip = buildZip(entries);
  const filename = `${rootFolder}.zip`;
  res.writeHead(200, {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Length": zip.length,
  });
  res.end(zip);
}
