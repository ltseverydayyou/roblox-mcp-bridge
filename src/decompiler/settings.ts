import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const DECOMPILER_PROVIDER_IDS = [
  "builtin",
  "luaexpert",
  "shiny",
  "luacid",
  "oracle",
  "konstant",
  "fission",
] as const;

export type DecompilerProviderId = (typeof DECOMPILER_PROVIDER_IDS)[number];

export interface DecompilerProviderInfo {
  id: DecompilerProviderId;
  label: string;
  description: string;
  local: boolean;
  requiresApiKey: boolean;
  bodyFormat: "builtin" | "json-script" | "plain-base64" | "plain-bytecode" | "luacid" | "oracle-json";
}

export interface DecompilerProviderSettings {
  enabled: boolean;
  endpoint: string;
  apiKey: string;
  version: number | null;
  options: Record<string, unknown>;
}

export interface DecompilerRuntimeSettings {
  adaptiveFallback: boolean;
  loadBalanceSlowProviders: boolean;
  overallTimeoutMs: number;
  slowAfterMs: number;
  cooldownMs: number;
  slowSuccessLimit: number;
  timeoutLimit: number;
  providerTimeoutsMs: Record<DecompilerProviderId, number>;
}

export interface DecompilerSettings {
  providerOrder: DecompilerProviderId[];
  providers: Record<DecompilerProviderId, DecompilerProviderSettings>;
  runtime: DecompilerRuntimeSettings;
}

export interface PublicDecompilerProviderSettings
  extends Omit<DecompilerProviderSettings, "apiKey"> {
  apiKeySet: boolean;
  apiKeyMasked: string;
}

export interface PublicDecompilerSettings {
  providerOrder: DecompilerProviderId[];
  providers: Record<DecompilerProviderId, PublicDecompilerProviderSettings>;
  providerInfo: DecompilerProviderInfo[];
  runtime: DecompilerRuntimeSettings;
  health?: unknown;
}

export type DecompilerSettingsInput = Partial<{
  providerOrder: unknown;
  providers: unknown;
  runtime: unknown;
}>;

export const DECOMPILER_CONFIG_DIR = path.join(os.homedir(), ".roblox-mcp");
export const DECOMPILER_SETTINGS_PATH = path.join(
  DECOMPILER_CONFIG_DIR,
  "decompiler-settings.json"
);
export const SHINY_LOCAL_ENDPOINT = "http://localhost:3000/luau/decompile";
export const SHINY_HOSTED_ENDPOINT = "https://medal.upio.dev/decompile";
export const LUACID_DEFAULT_OPTIONS: Record<string, unknown> = {
  transport: "auto",
  transportExplicit: false,
  indent: "tab",
  type_annotations: "functions",
  discard_names: "named",
  generated_names: "readable",
  inferred_name_case: "preserve",
  prefer_const: false,
  if_expressions: true,
  early_return: true,
  early_continue: true,
  interpolated_strings: true,
  math_constants: true,
  fold_single_use_temps: true,
  uninline_local_functions: true,
  reroll_unrolled_loops: true,
  unfold_module_tables: false,
  keep_dead_functions: true,
  unicode_strings: true,
  upvalue_comments: false,
};

export const DECOMPILER_PROVIDER_INFO: DecompilerProviderInfo[] = [
  {
    id: "builtin",
    label: "Built-in",
    description: "Executor-provided decompile() function. Tried before network decompilers by default.",
    local: true,
    requiresApiKey: false,
    bodyFormat: "builtin",
  },
  {
    id: "luaexpert",
    label: "lua.expert",
    description: "Remote lua.expert decompiler.",
    local: false,
    requiresApiKey: false,
    bodyFormat: "json-script",
  },
  {
    id: "shiny",
    label: "Shiny",
    description: "Shiny decompiler using either a local server or the hosted Medal Server endpoint.",
    local: false,
    requiresApiKey: false,
    bodyFormat: "plain-base64",
  },
  {
    id: "luacid",
    label: "Luacid",
    description: "Luacid HTTP or WebSocket decompiler with an optional paid API key.",
    local: false,
    requiresApiKey: false,
    bodyFormat: "luacid",
  },
  {
    id: "oracle",
    label: "Oracle",
    description: "Oracle API decompiler. Requires your Oracle key.",
    local: false,
    requiresApiKey: true,
    bodyFormat: "oracle-json",
  },
  {
    id: "konstant",
    label: "Konstant",
    description: "Existing Konstant endpoint.",
    local: false,
    requiresApiKey: false,
    bodyFormat: "plain-bytecode",
  },
  {
    id: "fission",
    label: "Fission",
    description: "Local Fission HTTP server endpoint.",
    local: true,
    requiresApiKey: false,
    bodyFormat: "plain-base64",
  },
];

const DEFAULT_PROVIDERS: Record<DecompilerProviderId, DecompilerProviderSettings> = {
  builtin: {
    enabled: true,
    endpoint: "",
    apiKey: "",
    version: null,
    options: {},
  },
  luaexpert: {
    enabled: true,
    endpoint: "https://api.lua.expert/decompile",
    apiKey: "",
    version: null,
    options: {},
  },
  shiny: {
    enabled: true,
    endpoint: SHINY_HOSTED_ENDPOINT,
    apiKey: "",
    version: null,
    options: { mode: "hosted" },
  },
  luacid: {
    enabled: false,
    endpoint: "https://api.luacid.dev/decompile",
    apiKey: "",
    version: null,
    options: LUACID_DEFAULT_OPTIONS,
  },
  oracle: {
    enabled: false,
    endpoint: "https://oracle.mshq.dev/decompile",
    apiKey: "",
    version: null,
    options: {},
  },
  konstant: {
    enabled: true,
    endpoint: "http://api.plusgiant5.com/konstant/decompile",
    apiKey: "",
    version: null,
    options: {},
  },
  fission: {
    enabled: false,
    endpoint: "http://localhost:3001/luau/decompile",
    apiKey: "",
    version: null,
    options: {},
  },
};

export const DEFAULT_PROVIDER_TIMEOUTS_MS: Record<DecompilerProviderId, number> = {
  builtin: 8000,
  luaexpert: 10000,
  shiny: 6000,
  luacid: 15000,
  oracle: 15000,
  konstant: 10000,
  fission: 6000,
};

export const DEFAULT_DECOMPILER_RUNTIME_SETTINGS: DecompilerRuntimeSettings = {
  adaptiveFallback: true,
  loadBalanceSlowProviders: true,
  overallTimeoutMs: 12000,
  slowAfterMs: 6000,
  cooldownMs: 60000,
  slowSuccessLimit: 3,
  timeoutLimit: 2,
  providerTimeoutsMs: DEFAULT_PROVIDER_TIMEOUTS_MS,
};

export const DEFAULT_DECOMPILER_SETTINGS: DecompilerSettings = {
  providerOrder: ["builtin", "luaexpert", "shiny", "luacid", "oracle", "konstant", "fission"],
  providers: DEFAULT_PROVIDERS,
  runtime: DEFAULT_DECOMPILER_RUNTIME_SETTINGS,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProviderId(value: unknown): value is DecompilerProviderId {
  return (
    typeof value === "string" &&
    (DECOMPILER_PROVIDER_IDS as readonly string[]).includes(value)
  );
}

function toProviderId(value: unknown): DecompilerProviderId | null {
  if (isProviderId(value)) return value;
  if (value === "medal") return "shiny";
  return null;
}

function cloneProvider(provider: DecompilerProviderSettings): DecompilerProviderSettings {
  return {
    enabled: provider.enabled,
    endpoint: provider.endpoint,
    apiKey: provider.apiKey,
    version: provider.version,
    options: { ...provider.options },
  };
}

function cloneSettings(settings: DecompilerSettings): DecompilerSettings {
  return {
    providerOrder: [...settings.providerOrder],
    providers: Object.fromEntries(
      DECOMPILER_PROVIDER_IDS.map((id) => [id, cloneProvider(settings.providers[id])])
    ) as Record<DecompilerProviderId, DecompilerProviderSettings>,
    runtime: cloneRuntimeSettings(settings.runtime),
  };
}

function cloneRuntimeSettings(settings: DecompilerRuntimeSettings): DecompilerRuntimeSettings {
  return {
    adaptiveFallback: settings.adaptiveFallback,
    loadBalanceSlowProviders: settings.loadBalanceSlowProviders,
    overallTimeoutMs: settings.overallTimeoutMs,
    slowAfterMs: settings.slowAfterMs,
    cooldownMs: settings.cooldownMs,
    slowSuccessLimit: settings.slowSuccessLimit,
    timeoutLimit: settings.timeoutLimit,
    providerTimeoutsMs: { ...settings.providerTimeoutsMs },
  };
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizeEndpoint(value: unknown, fallback: string): string {
  const raw = normalizeString(value, fallback);
  if (!raw) return fallback;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const url = new URL(withProtocol);
    return url.toString().replace(/\/+$/, "");
  } catch {
    return raw.replace(/\/+$/, "");
  }
}

function normalizeApiKey(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const key = value.trim();
  return key.startsWith("••") ? fallback : key;
}

function normalizeVersion(value: unknown, fallback: number | null): number | null {
  if (value === null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return fallback;
}

function normalizeOptions(value: unknown, fallback: Record<string, unknown>): Record<string, unknown> {
  if (!isObject(value)) return { ...fallback };
  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  } catch {
    return { ...fallback };
  }
}

function normalizeNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function normalizeRuntimeSettings(
  value: unknown,
  fallback: DecompilerRuntimeSettings
): DecompilerRuntimeSettings {
  const input = isObject(value) ? value : {};
  const inputTimeouts = isObject(input.providerTimeoutsMs) ? input.providerTimeoutsMs : {};
  const fallbackTimeouts = fallback.providerTimeoutsMs ?? DEFAULT_PROVIDER_TIMEOUTS_MS;

  return {
    adaptiveFallback:
      typeof input.adaptiveFallback === "boolean"
        ? input.adaptiveFallback
        : fallback.adaptiveFallback,
    loadBalanceSlowProviders:
      typeof input.loadBalanceSlowProviders === "boolean"
        ? input.loadBalanceSlowProviders
        : fallback.loadBalanceSlowProviders,
    overallTimeoutMs: normalizeNumber(
      input.overallTimeoutMs,
      fallback.overallTimeoutMs,
      3000,
      60000
    ),
    slowAfterMs: normalizeNumber(input.slowAfterMs, fallback.slowAfterMs, 500, 60000),
    cooldownMs: normalizeNumber(input.cooldownMs, fallback.cooldownMs, 5000, 600000),
    slowSuccessLimit: normalizeNumber(
      input.slowSuccessLimit,
      fallback.slowSuccessLimit,
      1,
      20
    ),
    timeoutLimit: normalizeNumber(input.timeoutLimit, fallback.timeoutLimit, 1, 20),
    providerTimeoutsMs: Object.fromEntries(
      DECOMPILER_PROVIDER_IDS.map((id) => [
        id,
        normalizeNumber(
          inputTimeouts[id],
          fallbackTimeouts[id] ?? DEFAULT_PROVIDER_TIMEOUTS_MS[id],
          500,
          60000
        ),
      ])
    ) as Record<DecompilerProviderId, number>,
  };
}

function normalizeProviderOrderSource(
  value: unknown,
  fallback: DecompilerProviderId[]
): unknown[] {
  if (typeof value === "string") return value.split(",").map((part) => part.trim());
  if (Array.isArray(value)) return value;
  return fallback;
}

function normalizeProviderOrder(
  value: unknown,
  fallback: DecompilerProviderId[]
): DecompilerProviderId[] {
  const source = normalizeProviderOrderSource(value, fallback);

  const order: DecompilerProviderId[] = [];
  for (const id of source) {
    const providerId = toProviderId(id);
    if (providerId && !order.includes(providerId)) order.push(providerId);
  }
  if (!order.includes("builtin")) {
    order.unshift("builtin");
  }
  for (const id of DECOMPILER_PROVIDER_IDS) {
    if (!order.includes(id)) order.push(id);
  }
  return order;
}

function normalizeShinyMode(provider: DecompilerProviderSettings): "local" | "hosted" {
  const mode = provider.options.mode;
  if (mode === "local" || mode === "hosted") return mode;
  return provider.endpoint.includes("medal.upio.dev") ? "hosted" : "local";
}

function withShinyMode(
  provider: DecompilerProviderSettings,
  mode = normalizeShinyMode(provider)
): DecompilerProviderSettings {
  const endpoint = provider.endpoint || (mode === "hosted" ? SHINY_HOSTED_ENDPOINT : SHINY_LOCAL_ENDPOINT);
  return {
    ...provider,
    endpoint,
    options: {
      ...provider.options,
      mode,
    },
  };
}

function normalizeProvider(
  id: DecompilerProviderId,
  value: unknown,
  fallback: DecompilerProviderSettings
): DecompilerProviderSettings {
  const input = isObject(value) ? value : {};
  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : fallback.enabled,
    endpoint: normalizeEndpoint(input.endpoint, fallback.endpoint),
    apiKey: normalizeApiKey(input.apiKey, fallback.apiKey),
    version: normalizeVersion(input.version, fallback.version),
    options: normalizeOptions(input.options, fallback.options),
  };
}

function normalizeSettings(value: unknown, fallback: DecompilerSettings): DecompilerSettings {
  const input = isObject(value) ? value : {};
  const inputProviders = isObject(input.providers) ? input.providers : {};

  const providers = Object.fromEntries(
    DECOMPILER_PROVIDER_IDS.map((id) => {
      const fallbackProvider = fallback.providers[id] ?? DEFAULT_PROVIDERS[id];
      return [id, normalizeProvider(id, inputProviders[id], fallbackProvider)];
    })
  ) as Record<DecompilerProviderId, DecompilerProviderSettings>;
  providers.shiny = withShinyMode(providers.shiny);

  if (isObject(inputProviders.medal)) {
    const hasExplicitShiny = isObject(inputProviders.shiny);
    const legacyMedal = withShinyMode(
      normalizeProvider("shiny", inputProviders.medal, {
        ...DEFAULT_PROVIDERS.shiny,
        endpoint: SHINY_HOSTED_ENDPOINT,
        options: { mode: "hosted" },
      }),
      "hosted"
    );
    const sourceOrder = normalizeProviderOrderSource(input.providerOrder, fallback.providerOrder);
    const medalIndex = sourceOrder.indexOf("medal");
    const shinyIndex = sourceOrder.indexOf("shiny");
    const medalBeforeShiny = medalIndex !== -1 && (shinyIndex === -1 || medalIndex < shinyIndex);

    if (legacyMedal.enabled && (!hasExplicitShiny || !providers.shiny.enabled || medalBeforeShiny)) {
      providers.shiny = legacyMedal;
    }
  }

  return {
    providerOrder: normalizeProviderOrder(input.providerOrder, fallback.providerOrder),
    providers,
    runtime: normalizeRuntimeSettings(input.runtime, fallback.runtime),
  };
}

function providerLabel(id: DecompilerProviderId): string {
  return DECOMPILER_PROVIDER_INFO.find((provider) => provider.id === id)?.label ?? id;
}

export function decompilerSettingsIssues(settings: DecompilerSettings): string[] {
  const issues: string[] = [];
  for (const id of settings.providerOrder) {
    const provider = settings.providers[id];
    if (!provider?.enabled) continue;
    const label = providerLabel(id);

    if (id === "oracle" && !provider.apiKey) {
      issues.push(`${label}: Authorization required. Add an Oracle API key before this provider can run.`);
    }
    if (id === "luacid" && provider.options.transport === "websocket" && !provider.apiKey) {
      issues.push(`${label}: A paid API key is required for WebSocket decompilation.`);
    }

    if (id !== "builtin" && !provider.endpoint.trim()) {
      issues.push(`${label}: Endpoint required. Open provider settings and add a URL.`);
    }
  }
  return issues;
}

export async function loadDecompilerSettings(): Promise<DecompilerSettings> {
  try {
    const raw = await fs.readFile(DECOMPILER_SETTINGS_PATH, "utf8");
    return normalizeSettings(JSON.parse(raw), DEFAULT_DECOMPILER_SETTINGS);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return cloneSettings(DEFAULT_DECOMPILER_SETTINGS);
    throw error;
  }
}

export async function saveDecompilerSettings(
  input: DecompilerSettingsInput
): Promise<DecompilerSettings> {
  const existing = await loadDecompilerSettings();
  const next = normalizeSettings(input, existing);
  const issues = decompilerSettingsIssues(next);
  if (issues.length) {
    throw new Error(`Fix decompiler provider issues before saving: ${issues.join(" ")}`);
  }

  await fs.mkdir(DECOMPILER_CONFIG_DIR, { recursive: true });
  await fs.writeFile(DECOMPILER_SETTINGS_PATH, JSON.stringify(next, null, 2) + "\n", {
    mode: 0o600,
  });
  await fs.chmod(DECOMPILER_SETTINGS_PATH, 0o600).catch(() => undefined);

  return next;
}

export function toPublicDecompilerSettings(
  settings: DecompilerSettings,
  health?: unknown
): PublicDecompilerSettings {
  const providers = Object.fromEntries(
    DECOMPILER_PROVIDER_IDS.map((id) => {
      const provider = settings.providers[id];
      const key = provider.apiKey;
      return [
        id,
        {
          enabled: provider.enabled,
          endpoint: provider.endpoint,
          version: provider.version,
          options: provider.options,
          apiKeySet: key.length > 0,
          apiKeyMasked: key ? `${key.slice(0, 3)}...${key.slice(-4)}` : "",
        },
      ];
    })
  ) as Record<DecompilerProviderId, PublicDecompilerProviderSettings>;

  return {
    providerOrder: settings.providerOrder,
    providers,
    providerInfo: DECOMPILER_PROVIDER_INFO,
    runtime: cloneRuntimeSettings(settings.runtime),
    ...(health ? { health } : {}),
  };
}

export function toConnectorDecompilerSettings(settings: DecompilerSettings): DecompilerSettings {
  const connectorSettings = cloneSettings(settings);
  if (!connectorSettings.providers.oracle.apiKey) {
    connectorSettings.providers.oracle.enabled = false;
  }
  if (
    connectorSettings.providers.luacid.options.transport === "websocket" &&
    !connectorSettings.providers.luacid.apiKey
  ) {
    connectorSettings.providers.luacid.enabled = false;
  }
  return connectorSettings;
}
