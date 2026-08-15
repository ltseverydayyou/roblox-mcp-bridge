import crypto from "crypto";
import { WebSocket } from "ws";
import { HTTP_POLL_TIMEOUT } from "../../../config.js";
import type { RobloxClient } from "../../types.js";
import { clearScriptSourceIndex } from "./script-source-store.js";
import { SERVER_VERSION } from "../../../version.js";

const clientRegistry: Map<string, RobloxClient> = new Map();
const wsToClientId: Map<WebSocket, string> = new Map();

let activeClientId: string | undefined = undefined;
let activeClientIsRemote = false;

function isClientActive(entry: RobloxClient): boolean {
  if (entry.transport === "ws") {
    return Boolean(entry.ws && entry.ws.readyState === WebSocket.OPEN);
  }
  return Date.now() - entry.lastHttpPoll < HTTP_POLL_TIMEOUT;
}

function findClientBySessionId(sessionId: string): RobloxClient | undefined {
  for (const entry of clientRegistry.values()) {
    if (entry.sessionId === sessionId) return entry;
  }
  return undefined;
}

function findUniqueClientByIdOrPrefix(clientId: string): RobloxClient | undefined {
  const normalized = clientId.trim();
  if (!normalized) return undefined;

  const exact = clientRegistry.get(normalized);
  if (exact) return exact;

  const matches = getActiveClients().filter((entry) => entry.clientId.startsWith(normalized));
  return matches.length === 1 ? matches[0] : undefined;
}

export function getActiveClientId(): string | undefined {
  if (!activeClientId) return undefined;
  if (activeClientIsRemote) return activeClientId;
  const active = clientRegistry.get(activeClientId);
  if (!active || !isClientActive(active)) {
    activeClientId = undefined;
    activeClientIsRemote = false;
    return undefined;
  }
  return activeClientId;
}

export function setActiveClientId(clientId: string, options: { remote?: boolean } = {}): void {
  activeClientId = clientId;
  activeClientIsRemote = options.remote === true;
}

export function resetRegistry(): void {
  clientRegistry.clear();
  wsToClientId.clear();
  activeClientId = undefined;
  activeClientIsRemote = false;
}

function cleanMeta(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "Unknown";
}

function formatExecutor(name?: string, version?: string): string {
  const cleanName = cleanMeta(name);
  const cleanVersion = cleanMeta(version);
  if (cleanVersion === "Unknown") return cleanName;
  if (cleanName === "Unknown") return cleanVersion;
  if (cleanName.toLowerCase().includes(cleanVersion.toLowerCase())) return cleanName;
  return `${cleanName} ${cleanVersion}`;
}

function logClientRegistration(action: "registered" | "refreshed", clientId: string, info: {
  username: string;
  userId: number;
  displayName?: string;
  placeId: number;
  gameId?: number;
  jobId: string;
  placeName: string;
  executorName?: string;
  executorVersion?: string;
  robloxVersion?: string;
  platform?: string;
  sessionId?: string;
  transport: "ws" | "http";
}): void {
  const player = info.displayName && info.displayName !== info.username
    ? `${info.displayName} (@${info.username})`
    : `@${info.username}`;
  const transport = info.transport === "ws" ? "WebSocket" : "HTTP Polling";
  const lines = [
    `[Registry] Client ${action}:`,
    `  Client ID : ${clientId}`,
    `  Player    : ${player} (UserId ${info.userId})`,
    `  Experience: ${info.placeName} (PlaceId ${info.placeId}${info.gameId ? `, UniverseId ${info.gameId}` : ""})`,
    `  Job ID    : ${info.jobId || "Unknown"}`,
    `  Executor  : ${formatExecutor(info.executorName, info.executorVersion)}`,
    `  Roblox    : ${cleanMeta(info.robloxVersion)}`,
    `  Platform  : ${cleanMeta(info.platform)}`,
    `  Transport : ${transport}`,
    `  MCP       : v${SERVER_VERSION}`,
  ];
  console.error(lines.join("\n"));
}

export function registerClient(info: {
  username: string;
  userId: number;
  displayName?: string;
  placeId: number;
  gameId?: number;
  jobId: string;
  placeName: string;
  executorName?: string;
  executorVersion?: string;
  robloxVersion?: string;
  platform?: string;
  sessionId?: string;
  transport: "ws" | "http";
  ws?: WebSocket;
}): string {
  const existing = info.sessionId ? findClientBySessionId(info.sessionId) : undefined;
  if (existing) {
    if (existing.ws && existing.ws !== info.ws) {
      wsToClientId.delete(existing.ws);
      try {
        existing.ws.close();
      } catch {
        // Best effort cleanup; the new transport below is authoritative.
      }
    }

    existing.pendingPollResolve?.([]);
    existing.username = info.username;
    existing.userId = info.userId;
    existing.displayName = info.displayName;
    existing.placeId = info.placeId;
    existing.gameId = info.gameId;
    existing.jobId = info.jobId;
    existing.placeName = info.placeName;
    existing.executorName = info.executorName;
    existing.executorVersion = info.executorVersion;
    existing.robloxVersion = info.robloxVersion;
    existing.platform = info.platform;
    existing.sessionId = info.sessionId;
    existing.transport = info.transport;
    existing.ws = info.ws;
    existing.lastHttpPoll = Date.now();
    existing.pendingPollResolve = null;

    if (info.ws) {
      wsToClientId.set(info.ws, existing.clientId);
    }

    logClientRegistration("refreshed", existing.clientId, info);
    return existing.clientId;
  }

  const clientId = crypto.randomUUID();
  const entry: RobloxClient = {
    clientId,
    sessionId: info.sessionId,
    username: info.username,
    userId: info.userId,
    displayName: info.displayName,
    placeId: info.placeId,
    gameId: info.gameId,
    jobId: info.jobId,
    placeName: info.placeName,
    executorName: info.executorName,
    executorVersion: info.executorVersion,
    robloxVersion: info.robloxVersion,
    platform: info.platform,
    transport: info.transport,
    ws: info.ws,
    lastHttpPoll: Date.now(),
    pendingHttpCommands: [],
    pendingPollResolve: null,
  };
  clientRegistry.set(clientId, entry);
  if (info.ws) {
    wsToClientId.set(info.ws, clientId);
  }
  logClientRegistration("registered", clientId, info);
  return clientId;
}

export function unregisterClient(clientId: string): void {
  const entry = clientRegistry.get(clientId);
  if (entry?.ws) {
    wsToClientId.delete(entry.ws);
  }
  entry?.pendingPollResolve?.([]);
  clientRegistry.delete(clientId);
  if (!activeClientIsRemote && activeClientId === clientId) activeClientId = undefined;
  clearScriptSourceIndex(clientId);
  const identity = entry ? `@${entry.username} / ${formatExecutor(entry.executorName, entry.executorVersion)}` : "Unknown client";
  console.error(`[Registry] Client unregistered: ${clientId} (${identity})`);
}

export function getClientById(clientId: string): RobloxClient | undefined {
  return clientRegistry.get(clientId);
}

export function getClientIdByWs(ws: WebSocket): string | undefined {
  return wsToClientId.get(ws);
}

export function getActiveClients(): RobloxClient[] {
  const active: RobloxClient[] = [];
  for (const entry of clientRegistry.values()) {
    if (isClientActive(entry)) {
      active.push(entry);
    }
  }
  return active;
}

export function formatActiveClientListForTool(): string {
  const active = getActiveClients();
  if (active.length === 0) {
    return "No Roblox clients are currently connected.";
  }

  // Compact one-line-per-client format to minimize tokens vs pretty JSON.
  const selectedClientId = getActiveClientId();

  return active
    .map((c) => {
      const marker = c.clientId === selectedClientId ? "* " : "  ";
      const executor = formatExecutor(c.executorName, c.executorVersion);
      const platform = cleanMeta(c.platform);
      return (
        `${marker}${c.clientId} | ${c.username ?? "?"} @ ${c.placeName ?? c.placeId} ` +
        `(place=${c.placeId} job=${c.jobId} ${c.transport} executor=${executor} platform=${platform})`
      );
    })
    .join("\n");
}

export function resolveTargetClient(clientId?: string): RobloxClient | null {
  if (clientId) {
    const entry = findUniqueClientByIdOrPrefix(clientId);
    if (!entry) return null;
    if (!isClientActive(entry)) return null;
    return entry;
  }

  const active = getActiveClients();
  if (active.length === 0) return null;

  const wsCl = active.filter((c) => c.transport === "ws");
  if (wsCl.length > 0) return wsCl[wsCl.length - 1]!;
  return active.sort((a, b) => b.lastHttpPoll - a.lastHttpPoll)[0]!;
}
