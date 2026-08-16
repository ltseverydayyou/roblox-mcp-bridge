import {
  GetResponseOfIdFromClient,
  SendArbitraryDataToClient,
  getInstanceRole,
} from "../bridge/handlers/shared/communication.js";
import { getActiveClientId, resolveTargetClient } from "../bridge/handlers/shared/registry.js";
import { RobloxResponse } from "../bridge/types.js";
import { BASE_URL, WS_PORT } from "../config.js";
import { INVALID_CLIENT_ERROR, NO_CLIENT_ERROR } from "./errors.js";

export const DEFAULT_TOOL_OUTPUT_CHAR_LIMIT = 6000;
export const HARD_TOOL_OUTPUT_CHAR_LIMIT = 32000;
export const MAX_ERROR_RESPONSE_CHARS = 500;

const RISKY_EXECUTOR_METHOD_PATTERNS: Array<[string, RegExp]> = [
  ["getgc", /\bgetgc\s*\(/i],
  ["getnilinstances", /\bgetnilinstances\s*\(/i],
  ["getconnections", /\bgetconnections\s*\(/i],
  ["getloadedmodules", /\bgetloadedmodules\s*\(/i],
  ["getreg", /\bgetreg\s*\(/i],
  ["getregistry", /\bgetregistry\s*\(/i],
  ["hookfunction", /\bhookfunction\s*\(/i],
  ["hookmetamethod", /\bhookmetamethod\s*\(/i],
  ["getrawmetatable", /\bgetrawmetatable\s*\(/i],
  ["setreadonly", /\bsetreadonly\s*\(/i],
  ["newcclosure", /\bnewcclosure\s*\(/i],
  ["clonefunction", /\bclonefunction\s*\(/i],
  ["replaceclosure", /\breplaceclosure\s*\(/i],
  ["getscriptclosure", /\bgetscriptclosure\s*\(/i],
  ["getconstants", /\bgetconstants\s*\(/i],
  ["getupvalues", /\bgetupvalues\s*\(/i],
  ["getprotos", /\bgetprotos\s*\(/i],
  ["debug.getregistry", /\bdebug\s*\.\s*getregistry\s*\(/i],
  ["debug.getupvalue", /\bdebug\s*\.\s*getupvalue\s*\(/i],
  ["debug.getupvalues", /\bdebug\s*\.\s*getupvalues\s*\(/i],
  ["debug.getconstants", /\bdebug\s*\.\s*getconstants\s*\(/i],
  ["debug.getprotos", /\bdebug\s*\.\s*getprotos\s*\(/i],
];

export function detectRiskyExecutorMethods(source: string): string[] {
  const found: string[] = [];
  for (const [name, pattern] of RISKY_EXECUTOR_METHOD_PATTERNS) {
    if (pattern.test(source) && !found.includes(name)) found.push(name);
  }
  return found;
}

export function riskConfirmationMessage(methods: string[]): string {
  return (
    `User confirmation required before using potentially detectable executor methods: ${methods.join(", ")}. ` +
    'Ask the user first, for example: "This step would use potentially detectable executor introspection/hooking methods: ' +
    `${methods.join(", ")}. Would you like me to continue?"`
  );
}

/**
 * Check if the current instance is a secondary relay.
 * Secondaries can be created either via --baseurl or automatically when
 * the port is already in use (EADDRINUSE fallback).
 */
export function isSecondaryRelay(): boolean {
  return getInstanceRole() === "secondary";
}

/**
 * Get the base URL of the primary server.
 * If --baseurl was specified, use that. Otherwise fall back to localhost.
 */
function getPrimaryBaseUrl(): string {
  if (BASE_URL) return BASE_URL.replace(/\/$/, "");
  return `http://localhost:${WS_PORT}`;
}

/**
 * Relay a tool call to the primary's /api/tool HTTP endpoint.
 * Handles both immediate results and progress-job-based async responses
 * (polls /api/tool-progress until done).
 */
export async function relayToolToApi(
  type: string,
  params: Record<string, unknown>,
  timeoutMs: number = 60000,
  outputOptions: ToolOutputOptions = {}
): Promise<ToolTextResponse> {
  const primaryBase = getPrimaryBaseUrl();
  const toolUrl = primaryBase + "/api/tool";
  const activeClientId = getActiveClientId();

  try {
    const resp = await fetch(toolUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        ...(activeClientId ? { clientId: activeClientId } : {}),
        ...params,
      }),
    });

    const data = (await resp.json()) as Record<string, unknown>;

    if (data.error) {
      return toolTextResponse(data.error as string, outputOptions, true);
    }

    // Immediate result
    if (data.result !== undefined) {
      return toolTextResponse(String(data.result), outputOptions);
    }

    // Progress-job based (semantic search/index)
    if (data.jobId && data.progressUrl) {
      const progressUrl = primaryBase + (data.progressUrl as string);
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1000));

        const progressResp = await fetch(progressUrl);
        const job = (await progressResp.json()) as Record<string, unknown>;

        if (job.status === "done") {
          return toolTextResponse(String(job.result ?? "Done."), outputOptions);
        }
        if (job.status === "failed") {
          return toolTextResponse(`Failed: ${(job.error as string) ?? "Unknown error"}`, outputOptions, true);
        }
      }

      return toolTextResponse("Timed out waiting for primary to complete.", outputOptions, true);
    }

    return toolTextResponse(JSON.stringify(data), outputOptions);
  } catch (err) {
    return toolTextResponse(`Failed to relay to primary: ${(err as Error).message || err}`, outputOptions, true);
  }
}

export interface ToolTextResponse {
  [x: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface ToolOutputOptions {
  maxOutputChars?: number;
  defaultMaxOutputChars?: number;
  truncationHint?: string;
}

export function normalizeMaxOutputChars(
  value: unknown,
  fallback: number = DEFAULT_TOOL_OUTPUT_CHAR_LIMIT
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(HARD_TOOL_OUTPUT_CHAR_LIMIT, Math.max(1000, Math.floor(parsed)));
}

export function formatToolText(text: string, options: ToolOutputOptions = {}): string {
  const maxOutputChars = normalizeMaxOutputChars(
    options.maxOutputChars,
    options.defaultMaxOutputChars ?? DEFAULT_TOOL_OUTPUT_CHAR_LIMIT
  );

  if (text.length <= maxOutputChars) return text;

  const omitted = text.length - maxOutputChars;
  const hint =
    options.truncationHint ??
    "Rerun with narrower filters, line ranges, or a smaller maxOutputChars value.";

  // Head+tail truncation: keep the start (typically headers/most relevant)
  // AND the end (footers, continuation hints, last results) so tail-critical
  // information is not silently discarded (mitigates lost-in-the-middle).
  const marker = `\n\n[... ${omitted} characters omitted in the middle. ${hint} ...]\n\n`;
  const budget = maxOutputChars - marker.length;
  if (budget <= 0) {
    return text.slice(0, maxOutputChars);
  }
  const headChars = Math.ceil(budget * 0.7);
  const tailChars = budget - headChars;
  return text.slice(0, headChars) + marker + text.slice(text.length - tailChars);
}

export function toolTextResponse(
  text: string,
  options: ToolOutputOptions = {},
  isError = false
): ToolTextResponse {
  return {
    content: [{ type: "text", text: formatToolText(text, options) }],
    ...(isError ? { isError: true } : {}),
  };
}

/**
 * Build a compact one-line stamp identifying the client a result came from,
 * so the model does not blend stale results across clients (context poisoning).
 * Returns "" when it can't be resolved (e.g. secondary relay).
 */
export function clientStampPrefix(): string {
  try {
    const clientId = getActiveClientId();
    const target = resolveTargetClient(clientId);
    if (!target) return "";
    const place = target.placeName || target.placeId || "?";
    return `[client=${target.clientId} place=${place} job=${target.jobId ?? "?"}]\n`;
  } catch {
    return "";
  }
}

/**
 * Summarize a Roblox response for an error message without dumping the entire
 * (potentially large) object into the model context.
 */
export function describeResponse(response: RobloxResponse | undefined): string {
  if (response === undefined) return "no response (timed out).";
  if (response.error !== undefined) {
    return String(response.error).slice(0, MAX_ERROR_RESPONSE_CHARS);
  }
  const serialized = JSON.stringify(response);
  return serialized.length > MAX_ERROR_RESPONSE_CHARS
    ? serialized.slice(0, MAX_ERROR_RESPONSE_CHARS) + " …(truncated)"
    : serialized;
}

export interface SendAndWaitOptions {
  type: string;
  data: Record<string, unknown>;
  timeoutMs?: number;
  maxOutputChars?: number;
  truncationHint?: string;
  failureField?: "output" | "error";
  failureMessage?: (response: RobloxResponse | undefined) => string;
  successMessage?: (response: RobloxResponse) => string;
  /** When true, prepend a one-line client identity stamp to successful output. */
  stampClient?: boolean;
}

/**
 * Dispatch a request to the Roblox client and wait for the response.
 * Handles the no-client / invalid-client / timeout boilerplate that every
 * tool used to repeat.
 */
export async function sendAndWait(options: SendAndWaitOptions): Promise<ToolTextResponse> {
  const callId = SendArbitraryDataToClient(
    options.type,
    options.data,
    undefined,
    getActiveClientId()
  );

  if (callId === null) return NO_CLIENT_ERROR;
  if (callId === "INVALID_CLIENT") return INVALID_CLIENT_ERROR;

  const response = await GetResponseOfIdFromClient(callId, options.timeoutMs);

  const failureField = options.failureField ?? "output";

  const isFailure =
    response === undefined ||
    (failureField === "error"
      ? response.error !== undefined
      : response.output === undefined);

  if (isFailure) {
    const text =
      options.failureMessage?.(response) ??
      `Failed to ${options.type}. Response: ${JSON.stringify(response)}`;
    return toolTextResponse(
      text,
      {
        maxOutputChars: options.maxOutputChars,
        truncationHint: options.truncationHint,
      },
      true
    );
  }

  const text =
    options.successMessage?.(response) ?? (response.output as string);
  const stamped = options.stampClient ? clientStampPrefix() + text : text;
  return toolTextResponse(stamped, {
    maxOutputChars: options.maxOutputChars,
    truncationHint: options.truncationHint,
  });
}

export interface FireAndForgetOptions {
  type: string;
  data: Record<string, unknown>;
  successMessage: string;
}

/**
 * Dispatch a request without waiting for a response.
 * Returns a success message once the request has been queued/sent.
 */
export function sendFireAndForget(options: FireAndForgetOptions): ToolTextResponse {
  const callId = SendArbitraryDataToClient(
    options.type,
    options.data,
    undefined,
    getActiveClientId()
  );

  if (callId === null) return NO_CLIENT_ERROR;
  if (callId === "INVALID_CLIENT") return INVALID_CLIENT_ERROR;

  return { content: [{ type: "text", text: options.successMessage }] };
}
