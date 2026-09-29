import fs from "node:fs/promises";
import path from "node:path";
import { getRobloxMcpConfigDir } from "../platform/config-dir.js";

export type SemanticProvider = "openai" | "ollama";

export interface SemanticSettings {
  enabled: boolean;
  provider: SemanticProvider;
  openaiApiKey: string;
  openaiBaseUrl: string;
  openaiModel: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  saveEmbeddingsToDisk: boolean;
}

export interface PublicSemanticSettings {
  enabled: boolean;
  provider: SemanticProvider;
  openaiApiKeySet: boolean;
  openaiApiKeyMasked: string;
  openaiBaseUrl: string;
  openaiModel: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  saveEmbeddingsToDisk: boolean;
}

export type SemanticSettingsInput = Partial<{
  enabled: unknown;
  provider: unknown;
  openaiApiKey: unknown;
  openaiBaseUrl: unknown;
  openaiModel: unknown;
  ollamaBaseUrl: unknown;
  ollamaModel: unknown;
  saveEmbeddingsToDisk: unknown;
}>;

export const SEMANTIC_CONFIG_DIR = getRobloxMcpConfigDir();
export const SEMANTIC_SETTINGS_PATH = path.join(SEMANTIC_CONFIG_DIR, "semantic-search.json");

export const DEFAULT_SEMANTIC_SETTINGS: SemanticSettings = {
  enabled: true,
  provider: "openai",
  openaiApiKey: "",
  openaiBaseUrl: "https://api.openai.com/v1",
  openaiModel: "text-embedding-3-small",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "embeddinggemma",
  saveEmbeddingsToDisk: false,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeProvider(value: unknown, fallback: SemanticProvider): SemanticProvider {
  return value === "openai" || value === "ollama" ? value : fallback;
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.trim() : fallback;
}

export function normalizeOllamaBaseUrl(value: unknown, fallback: string): string {
  const raw = normalizeString(value, fallback);
  if (!raw) return fallback;

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    return raw;
  }

  if (!url.port) {
    url.port = "11434";
  }

  return url.toString().replace(/\/+$/, "");
}

export function normalizeOpenAIBaseUrl(value: unknown, fallback: string): string {
  const raw = normalizeString(value, fallback);
  if (!raw) return fallback;

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withProtocol).toString().replace(/\/+$/, "").replace(/\/embeddings$/i, "");
  } catch {
    return raw.replace(/\/+$/, "").replace(/\/embeddings$/i, "");
  }
}

export async function loadSemanticSettings(): Promise<SemanticSettings> {
  try {
    const raw = await fs.readFile(SEMANTIC_SETTINGS_PATH, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed)) return { ...DEFAULT_SEMANTIC_SETTINGS };

    return {
      enabled:
        typeof parsed.enabled === "boolean"
          ? parsed.enabled
          : DEFAULT_SEMANTIC_SETTINGS.enabled,
      provider: normalizeProvider(parsed.provider, DEFAULT_SEMANTIC_SETTINGS.provider),
      openaiApiKey: normalizeString(parsed.openaiApiKey, DEFAULT_SEMANTIC_SETTINGS.openaiApiKey),
      openaiBaseUrl: normalizeOpenAIBaseUrl(
        parsed.openaiBaseUrl,
        DEFAULT_SEMANTIC_SETTINGS.openaiBaseUrl
      ),
      openaiModel: normalizeString(parsed.openaiModel, DEFAULT_SEMANTIC_SETTINGS.openaiModel),
      ollamaBaseUrl: normalizeOllamaBaseUrl(
        parsed.ollamaBaseUrl,
        DEFAULT_SEMANTIC_SETTINGS.ollamaBaseUrl
      ),
      ollamaModel: normalizeString(parsed.ollamaModel, DEFAULT_SEMANTIC_SETTINGS.ollamaModel),
      saveEmbeddingsToDisk:
        typeof parsed.saveEmbeddingsToDisk === "boolean"
          ? parsed.saveEmbeddingsToDisk
          : DEFAULT_SEMANTIC_SETTINGS.saveEmbeddingsToDisk,
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { ...DEFAULT_SEMANTIC_SETTINGS };
    throw error;
  }
}

export async function saveSemanticSettings(input: SemanticSettingsInput): Promise<SemanticSettings> {
  const existing = await loadSemanticSettings();
  const next: SemanticSettings = {
    enabled: typeof input.enabled === "boolean" ? input.enabled : existing.enabled,
    provider: normalizeProvider(input.provider, existing.provider),
    openaiApiKey:
      typeof input.openaiApiKey === "string" ? input.openaiApiKey.trim() : existing.openaiApiKey,
    openaiBaseUrl: normalizeOpenAIBaseUrl(input.openaiBaseUrl, existing.openaiBaseUrl),
    openaiModel: normalizeString(input.openaiModel, existing.openaiModel),
    ollamaBaseUrl: normalizeOllamaBaseUrl(input.ollamaBaseUrl, existing.ollamaBaseUrl),
    ollamaModel: normalizeString(input.ollamaModel, existing.ollamaModel),
    saveEmbeddingsToDisk:
      typeof input.saveEmbeddingsToDisk === "boolean"
        ? input.saveEmbeddingsToDisk
        : existing.saveEmbeddingsToDisk,
  };

  await fs.mkdir(SEMANTIC_CONFIG_DIR, { recursive: true });
  await fs.writeFile(SEMANTIC_SETTINGS_PATH, JSON.stringify(next, null, 2) + "\n", {
    mode: 0o600,
  });
  await fs.chmod(SEMANTIC_SETTINGS_PATH, 0o600).catch(() => undefined);

  return next;
}

export function toPublicSemanticSettings(settings: SemanticSettings): PublicSemanticSettings {
  const key = settings.openaiApiKey;
  return {
    enabled: settings.enabled,
    provider: settings.provider,
    openaiApiKeySet: key.length > 0,
    openaiApiKeyMasked: key ? `${key.slice(0, 3)}...${key.slice(-4)}` : "",
    openaiBaseUrl: settings.openaiBaseUrl,
    openaiModel: settings.openaiModel,
    ollamaBaseUrl: settings.ollamaBaseUrl,
    ollamaModel: settings.ollamaModel,
    saveEmbeddingsToDisk: settings.saveEmbeddingsToDisk,
  };
}

export function validateSemanticSettings(settings: SemanticSettings): string | null {
  if (!settings.enabled) return "Semantic search is disabled.";

  if (settings.provider === "openai") {
    if (!settings.openaiApiKey) return "OpenAI API key is not configured.";
    if (!settings.openaiBaseUrl) return "OpenAI-compatible base URL is not configured.";
    if (!settings.openaiModel) return "OpenAI embedding model is not configured.";
    return null;
  }

  if (!settings.ollamaBaseUrl) return "Ollama base URL is not configured.";
  if (!settings.ollamaModel) return "Ollama embedding model is not configured.";
  return null;
}

export function getSemanticProviderModel(settings: SemanticSettings): string {
  return settings.provider === "openai" ? settings.openaiModel : settings.ollamaModel;
}
