import {
  DECOMPILER_PROVIDER_IDS,
  DEFAULT_DECOMPILER_RUNTIME_SETTINGS,
  DEFAULT_PROVIDER_TIMEOUTS_MS,
  type DecompilerProviderId,
  type DecompilerProviderSettings,
  type DecompilerRuntimeSettings,
  type DecompilerSettings,
} from "./settings.js";
import {
  getDecompilerProviderStatus,
  recordDecompilerProviderFailure,
  recordDecompilerProviderSuccess,
  shouldSkipDecompilerProvider,
} from "./health.js";
import { WebSocket } from "ws";

export interface DecompileInput {
  bytecodeBase64: string;
  builtinAvailable?: boolean;
  builtinSource?: string;
  builtinLatencyMs?: number;
  clientId?: string;
  requestedProvider?: string;
  disabledProviders?: unknown[];
}

export interface DecompileResult {
  ok: boolean;
  source?: string;
  providerId?: DecompilerProviderId;
  attempts: string[];
  error?: string;
  needsBuiltin?: boolean;
}

interface ProviderRunResult {
  ok: boolean;
  result?: string;
  error?: string;
  statusCode?: number;
  timedOut?: boolean;
  latencyMs: number;
}

const ENDPOINT_BRIDGE_HOST_TOKEN = "{{BridgeHost}}";
const MAX_ERROR_BODY_CHARS = 600;
const LUA_EXPERT_MIN_INTERVAL_MS = 120;
const LOAD_IDLE_RESET_MS = 5000;
let luaExpertLastCallAt = 0;
let luaExpertQueue: Promise<void> = Promise.resolve();

interface ProviderLoadState {
  active: number;
  recentAssignments: number;
  lastAssignedAtMs: number;
}

const providerLoadById = new Map<DecompilerProviderId, ProviderLoadState>();

function providerDisplayName(id: DecompilerProviderId, provider: DecompilerProviderSettings): string {
  if (id === "luaexpert") return "lua.expert";
  if (id === "shiny") return provider.options.mode === "hosted" ? "Shiny hosted" : "Shiny";
  if (id === "luacid") return "Luacid";
  if (id === "oracle") return "Oracle";
  if (id === "konstant") return "Konstant";
  if (id === "fission") return "Fission";
  return "built-in";
}

function isProviderId(value: unknown): value is DecompilerProviderId {
  return (
    typeof value === "string" &&
    (DECOMPILER_PROVIDER_IDS as readonly string[]).includes(value)
  );
}

function providerLoad(id: DecompilerProviderId): ProviderLoadState {
  let load = providerLoadById.get(id);
  const now = Date.now();
  if (!load) {
    load = { active: 0, recentAssignments: 0, lastAssignedAtMs: 0 };
    providerLoadById.set(id, load);
  }
  if (load.active === 0 && now - load.lastAssignedAtMs > LOAD_IDLE_RESET_MS) {
    load.recentAssignments = 0;
  }
  return load;
}

function startProviderAttempt(id: DecompilerProviderId): () => void {
  const load = providerLoad(id);
  load.active += 1;
  load.recentAssignments += 1;
  load.lastAssignedAtMs = Date.now();

  return () => {
    const current = providerLoad(id);
    current.active = Math.max(0, current.active - 1);
  };
}

function providerLoadScore(id: DecompilerProviderId): number {
  const load = providerLoad(id);
  return load.active * 1000 + load.recentAssignments;
}

function cleanDisabledProviders(value: unknown[] | undefined): Set<DecompilerProviderId> {
  const disabled = new Set<DecompilerProviderId>();
  if (!Array.isArray(value)) return disabled;
  for (const item of value) {
    if (isProviderId(item)) disabled.add(item);
  }
  return disabled;
}

function orderProvidersForRequest(
  candidates: DecompilerProviderId[],
  runtime: DecompilerRuntimeSettings,
  requestedProvider: DecompilerProviderId | null
): DecompilerProviderId[] {
  if (requestedProvider && candidates.includes(requestedProvider)) {
    return [requestedProvider, ...candidates.filter((id) => id !== requestedProvider)];
  }

  const firstCandidate = candidates[0];
  if (
    runtime.loadBalanceSlowProviders === false ||
    !firstCandidate ||
    getDecompilerProviderStatus(firstCandidate) !== "slow"
  ) {
    return candidates;
  }

  // The configured provider order is a fallback contract. Slow-provider load
  // balancing may redistribute work between providers ahead of the built-in
  // executor fallback, but it must never promote built-in ahead of a provider
  // that the user explicitly placed before it.
  const builtinIndex = candidates.indexOf("builtin");
  const balanceEnd = builtinIndex >= 0 ? builtinIndex : candidates.length;
  if (balanceEnd <= 1) return candidates;

  const priorityIndex = new Map(candidates.map((id, index) => [id, index]));
  const balancedPrefix = candidates.slice(0, balanceEnd).sort((left, right) => {
    const leftScore = providerLoadScore(left);
    const rightScore = providerLoadScore(right);
    if (leftScore !== rightScore) return leftScore - rightScore;
    return (priorityIndex.get(left) ?? 0) - (priorityIndex.get(right) ?? 0);
  });

  return [...balancedPrefix, ...candidates.slice(balanceEnd)];
}

function resolveProviderEndpoint(endpoint: string): string {
  return endpoint.replaceAll(ENDPOINT_BRIDGE_HOST_TOKEN, "localhost");
}

function truncateErrorBody(body: string): string {
  return body.length > MAX_ERROR_BODY_CHARS
    ? `${body.slice(0, MAX_ERROR_BODY_CHARS)}...(truncated)`
    : body;
}

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  return bytes.buffer;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withLuaExpertRateLimit<T>(run: () => Promise<T>): Promise<T> {
  const previous = luaExpertQueue;
  let release: () => void = () => undefined;
  luaExpertQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    const waitMs = Math.max(0, LUA_EXPERT_MIN_INTERVAL_MS - (Date.now() - luaExpertLastCallAt));
    if (waitMs > 0) await delay(waitMs);
    return await run();
  } finally {
    luaExpertLastCallAt = Date.now();
    release();
  }
}

function withQuery(endpoint: string, params: Record<string, string | number | boolean | null | undefined>): string {
  try {
    const url = new URL(endpoint);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  } catch {
    const parts = Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    if (parts.length === 0) return endpoint;
    return `${endpoint}${endpoint.includes("?") ? "&" : "?"}${parts.join("&")}`;
  }
}

async function fetchText(
  url: string,
  init: Omit<RequestInit, "signal">,
  timeoutMs: number
): Promise<ProviderRunResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.text();
    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      return {
        ok: false,
        error: `HTTP ${response.status}: ${truncateErrorBody(body)}`,
        statusCode: response.status,
        latencyMs,
      };
    }

    return {
      ok: true,
      result: body.replaceAll(String.fromCharCode(0x00CD), " "),
      statusCode: response.status,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      error: timedOut
        ? `Timed out after ${Math.round(timeoutMs / 100) / 10}s.`
        : error instanceof Error
          ? error.message
          : String(error),
      timedOut,
      latencyMs,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runLuaExpert(
  provider: DecompilerProviderSettings,
  bytecodeBase64: string,
  timeoutMs: number
): Promise<ProviderRunResult> {
  return withLuaExpertRateLimit(() =>
    fetchText(
      resolveProviderEndpoint(provider.endpoint),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: bytecodeBase64 }),
      },
      timeoutMs
    )
  );
}

async function runPlainBase64(
  provider: DecompilerProviderSettings,
  bytecodeBase64: string,
  timeoutMs: number
): Promise<ProviderRunResult> {
  return fetchText(
    resolveProviderEndpoint(provider.endpoint),
    {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: bytecodeBase64,
    },
    timeoutMs
  );
}

async function runPlainBytecode(
  provider: DecompilerProviderSettings,
  bytecode: Buffer,
  timeoutMs: number
): Promise<ProviderRunResult> {
  return fetchText(
    resolveProviderEndpoint(provider.endpoint),
    {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: bufferToArrayBuffer(bytecode),
    },
    timeoutMs
  );
}

async function runOracle(
  provider: DecompilerProviderSettings,
  bytecodeBase64: string,
  timeoutMs: number
): Promise<ProviderRunResult> {
  if (!provider.apiKey) {
    return {
      ok: false,
      error: "Oracle API key is not configured.",
      latencyMs: 0,
    };
  }

  const url = withQuery(resolveProviderEndpoint(provider.endpoint), {
    key: provider.apiKey,
    version: provider.version,
  });

  return fetchText(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        script: bytecodeBase64,
        decompilerOptions: provider.options,
      }),
    },
    timeoutMs
  );
}

function luacidOptions(
  provider: DecompilerProviderSettings
): Record<string, string | number | boolean> {
  return Object.fromEntries(Object.entries(provider.options).filter(
    ([key, value]) =>
      !["transport", "transportExplicit"].includes(key) &&
      ["string", "number", "boolean"].includes(typeof value)
  )) as Record<string, string | number | boolean>;
}

async function runLuacid(
  provider: DecompilerProviderSettings,
  bytecode: Buffer,
  bytecodeBase64: string,
  timeoutMs: number
): Promise<ProviderRunResult> {
  const options = luacidOptions(provider);
  const explicitHttp =
    provider.options.transport === "http" && provider.options.transportExplicit === true;
  const useWebSocket =
    provider.options.transport === "websocket" || (!explicitHttp && Boolean(provider.apiKey));

  if (!useWebSocket) {
    const headers: Record<string, string> = { "Content-Type": "application/octet-stream" };
    if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
    return fetchText(
      withQuery(resolveProviderEndpoint(provider.endpoint), options),
      { method: "POST", headers, body: bufferToArrayBuffer(bytecode) },
      timeoutMs
    );
  }

  if (!provider.apiKey) {
    return { ok: false, error: "Luacid WebSocket requires a paid API key.", latencyMs: 0 };
  }

  const startedAt = Date.now();
  return new Promise((resolve) => {
    const websocketEndpoint = resolveProviderEndpoint(provider.endpoint)
      .replace(/^http/, "ws")
      .replace(/\/decompile\/?$/, "/decompile_ws");
    const socket = new WebSocket(withQuery(websocketEndpoint, options), {
      headers: { Authorization: `Bearer ${provider.apiKey}` },
    });
    let settled = false;
    const finish = (result: ProviderRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      resolve(result);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.terminate();
      resolve({
        ok: false,
        error: `Timed out after ${Math.round(timeoutMs / 100) / 10}s.`,
        timedOut: true,
        latencyMs: Date.now() - startedAt,
      });
    }, timeoutMs);

    socket.once("open", () => socket.send(JSON.stringify({
      id: "decompile",
      encoded_bytecode: bytecodeBase64,
      ...options,
    })));
    socket.once("message", (data) => {
      try {
        const response = JSON.parse(data.toString()) as {
          decompilation?: unknown;
          error?: { message?: unknown };
        };
        if (typeof response.decompilation === "string") {
          finish({ ok: true, result: response.decompilation, latencyMs: Date.now() - startedAt });
        } else {
          finish({
            ok: false,
            error: typeof response.error?.message === "string"
              ? response.error.message
              : "Invalid Luacid WebSocket response.",
            latencyMs: Date.now() - startedAt,
          });
        }
      } catch {
        finish({
          ok: false,
          error: "Invalid Luacid WebSocket response.",
          latencyMs: Date.now() - startedAt,
        });
      }
    });
    socket.once("error", (error) => finish({
      ok: false,
      error: error.message,
      latencyMs: Date.now() - startedAt,
    }));
  });
}

async function runProvider(options: {
  id: DecompilerProviderId;
  provider: DecompilerProviderSettings;
  bytecode: Buffer;
  bytecodeBase64: string;
  builtinSource?: string;
  builtinLatencyMs?: number;
  timeoutMs: number;
}): Promise<ProviderRunResult> {
  const startedAt = Date.now();

  if (options.id === "builtin") {
    if (!options.builtinSource) {
      return {
        ok: false,
        error: "Executor built-in decompile is unavailable or returned no source.",
        latencyMs: Date.now() - startedAt,
      };
    }
    return {
      ok: true,
      result: options.builtinSource,
      latencyMs: options.builtinLatencyMs ?? Date.now() - startedAt,
    };
  }

  if (options.id === "luaexpert") {
    return runLuaExpert(options.provider, options.bytecodeBase64, options.timeoutMs);
  }
  if (options.id === "shiny" || options.id === "fission") {
    return runPlainBase64(options.provider, options.bytecodeBase64, options.timeoutMs);
  }
  if (options.id === "luacid") {
    return runLuacid(options.provider, options.bytecode, options.bytecodeBase64, options.timeoutMs);
  }
  if (options.id === "konstant") {
    return runPlainBytecode(options.provider, options.bytecode, options.timeoutMs);
  }
  if (options.id === "oracle") {
    return runOracle(options.provider, options.bytecodeBase64, options.timeoutMs);
  }

  return {
    ok: false,
    error: `Unsupported decompiler provider: ${options.id}`,
    latencyMs: Date.now() - startedAt,
  };
}

function runtimeOrDefault(runtime: DecompilerSettings["runtime"]): DecompilerRuntimeSettings {
  return runtime ?? DEFAULT_DECOMPILER_RUNTIME_SETTINGS;
}

export async function decompileBytecode(
  settings: DecompilerSettings,
  input: DecompileInput
): Promise<DecompileResult> {
  const runtime = runtimeOrDefault(settings.runtime);
  const bytecode = Buffer.from(input.bytecodeBase64, "base64");
  const attempts: string[] = [];
  const deadline = Date.now() + (runtime.overallTimeoutMs || 12000);
  const disabledProviders = cleanDisabledProviders(input.disabledProviders);
  const requestedProvider = isProviderId(input.requestedProvider) ? input.requestedProvider : null;
  const candidates: DecompilerProviderId[] = [];

  for (const id of settings.providerOrder) {
    const provider = settings.providers[id];
    if (!provider?.enabled) continue;
    if (disabledProviders.has(id)) continue;

    const skip = shouldSkipDecompilerProvider(id, runtime);
    if (skip.skip) {
      attempts.push(`[${id}] skipped: ${skip.reason ?? "provider is temporarily unavailable"}`);
      continue;
    }

    candidates.push(id);
  }

  const orderedProviders = orderProvidersForRequest(candidates, runtime, requestedProvider);

  for (const id of orderedProviders) {
    const provider = settings.providers[id];
    if (!provider?.enabled) continue;

    if (id === "builtin" && !input.builtinSource) {
      if (input.builtinAvailable) {
        const releaseReservation = startProviderAttempt(id);
        releaseReservation();
        return {
          ok: false,
          providerId: "builtin",
          attempts,
          needsBuiltin: true,
        };
      }

      attempts.push("[builtin] Executor built-in decompile is unavailable or returned no source.");
      continue;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      attempts.push("Overall decompile deadline reached.");
      break;
    }

    const providerTimeoutMs = Math.min(
      runtime.providerTimeoutsMs?.[id] ?? DEFAULT_PROVIDER_TIMEOUTS_MS[id] ?? 6000,
      remainingMs
    );
    const displayName = providerDisplayName(id, provider);
    const finishProviderAttempt = startProviderAttempt(id);
    let result: ProviderRunResult;
    try {
      result = await runProvider({
        id,
        provider,
        bytecode,
        bytecodeBase64: input.bytecodeBase64,
        builtinSource: input.builtinSource,
        builtinLatencyMs: input.builtinLatencyMs,
        timeoutMs: providerTimeoutMs,
      });
    } finally {
      finishProviderAttempt();
    }

    if (result.ok && typeof result.result === "string" && result.result !== "") {
      recordDecompilerProviderSuccess(id, result.latencyMs, runtime, input.clientId);
      return {
        ok: true,
        providerId: id,
        source: `-- Decompiled with ${displayName}\n${result.result}`,
        attempts,
      };
    }

    const error = result.error || "Provider returned no source.";
    recordDecompilerProviderFailure({
      id,
      errorMessage: error,
      runtime,
      statusCode: result.statusCode,
      timedOut: result.timedOut,
      latencyMs: result.latencyMs,
      clientId: input.clientId,
    });
    attempts.push(`[${id}] ${error}`);
  }

  if (attempts.length === 0) {
    attempts.push("No decompiler providers are enabled.");
  }

  return {
    ok: false,
    attempts,
    error: attempts.join("\n\n"),
  };
}
