import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SERVER_VERSION } from "../version.js";

const DEFAULT_MANIFEST_URL =
  "https://raw.githubusercontent.com/ltseverydayyou/roblox-mcp-bridge/main/package.json";
const REPOSITORY_URL = "https://github.com/ltseverydayyou/roblox-mcp-bridge";
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const UPDATE_CHECK_TIMEOUT_MS = 8_000;
const MAX_MANIFEST_BYTES = 256 * 1024;

export type UpdateState =
  | "disabled"
  | "checking"
  | "up-to-date"
  | "update-available"
  | "ahead"
  | "error";

export interface UpdateStatus {
  state: UpdateState;
  currentVersion: string;
  latestVersion?: string;
  checkedAt?: number;
  message: string;
  repositoryUrl: string;
  updateCommand: string;
  gitInstall: boolean;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(__dirname, "../..");
const updateChecksEnabled = !["0", "false", "off", "no"].includes(
  String(process.env.ROBLOX_MCP_UPDATE_CHECK ?? "true").toLowerCase()
);

let status: UpdateStatus = createStatus(
  updateChecksEnabled ? "checking" : "disabled",
  updateChecksEnabled ? "Waiting for the first update check." : "Automatic update checks are disabled."
);
let inFlight: Promise<UpdateStatus> | null = null;

function createStatus(state: UpdateState, message: string): UpdateStatus {
  return {
    state,
    currentVersion: SERVER_VERSION,
    message,
    repositoryUrl: REPOSITORY_URL,
    updateCommand: "npm run update",
    gitInstall: fs.existsSync(path.join(repositoryRoot, ".git")),
  };
}

function parseVersion(value: string): { core: number[]; prerelease?: string[] } | null {
  const match = value
    .trim()
    .match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  const prerelease = match[4]?.split(".");
  if (prerelease?.some((identifier) => identifier.length === 0)) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease,
  };
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error(`Cannot compare invalid versions: ${left}, ${right}`);

  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index]! > b.core[index]! ? 1 : -1;
  }
  if (!a.prerelease && !b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;

  const count = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < count; index += 1) {
    const aIdentifier = a.prerelease[index];
    const bIdentifier = b.prerelease[index];
    if (aIdentifier === undefined) return -1;
    if (bIdentifier === undefined) return 1;
    if (aIdentifier === bIdentifier) continue;

    const aNumeric = /^\d+$/.test(aIdentifier);
    const bNumeric = /^\d+$/.test(bIdentifier);
    if (aNumeric && bNumeric) return Number(aIdentifier) > Number(bIdentifier) ? 1 : -1;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return aIdentifier > bIdentifier ? 1 : -1;
  }
  return 0;
}

export function getUpdateStatus(): UpdateStatus {
  return { ...status };
}

async function readManifest(response: Response): Promise<{ version?: unknown }> {
  if (!response.body) throw new Error("update server returned an empty manifest");

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_MANIFEST_BYTES) {
      await reader.cancel();
      throw new Error("update manifest is unexpectedly large");
    }
    chunks.push(Buffer.from(value));
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as { version?: unknown };
  } catch {
    throw new Error("update server returned invalid JSON");
  }
}

async function performUpdateCheck(): Promise<UpdateStatus> {
  status = createStatus("checking", "Checking for updates...");

  try {
    const manifestUrl = new URL(process.env.ROBLOX_MCP_UPDATE_MANIFEST_URL || DEFAULT_MANIFEST_URL);
    if (manifestUrl.protocol !== "https:") {
      throw new Error("update manifest URL must use HTTPS");
    }
    const response = await fetch(manifestUrl, {
      signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS),
      headers: {
        Accept: "application/json",
        "User-Agent": `roblox-mcp-bridge/${SERVER_VERSION}`,
      },
    });
    if (!response.ok) {
      throw new Error(`update server returned HTTP ${response.status}`);
    }

    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_MANIFEST_BYTES) {
      throw new Error("update manifest is unexpectedly large");
    }
    const manifest = await readManifest(response);
    if (typeof manifest.version !== "string" || !parseVersion(manifest.version)) {
      throw new Error("update manifest does not contain a valid version");
    }

    const comparison = compareVersions(SERVER_VERSION, manifest.version);
    const checkedAt = Date.now();
    if (comparison < 0) {
      status = {
        ...createStatus(
          "update-available",
          `Version ${manifest.version} is available. Run npm run update from the repository folder, then restart the MCP tunnel.`
        ),
        latestVersion: manifest.version,
        checkedAt,
      };
    } else if (comparison > 0) {
      status = {
        ...createStatus("ahead", `This build (${SERVER_VERSION}) is newer than the published version (${manifest.version}).`),
        latestVersion: manifest.version,
        checkedAt,
      };
    } else {
      status = {
        ...createStatus("up-to-date", `Roblox MCP Bridge ${SERVER_VERSION} is up to date.`),
        latestVersion: manifest.version,
        checkedAt,
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    status = {
      ...createStatus("error", `Could not check for updates: ${message}`),
      checkedAt: Date.now(),
    };
  }

  return getUpdateStatus();
}

export async function checkForUpdates(force = false): Promise<UpdateStatus> {
  if (!updateChecksEnabled) return getUpdateStatus();
  if (inFlight) return inFlight;

  const age = status.checkedAt ? Date.now() - status.checkedAt : Infinity;
  if (!force && age < UPDATE_CHECK_INTERVAL_MS) return getUpdateStatus();

  inFlight = performUpdateCheck().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export function startAutomaticUpdateChecks(): void {
  if (!updateChecksEnabled) return;

  const initialTimer = setTimeout(() => {
    void checkForUpdates(true).then((result) => {
      if (result.state === "update-available") {
        console.error(`[Update] ${result.message}`);
      } else if (result.state === "error") {
        console.error(`[Update] ${result.message}`);
      }
    });
  }, 2_000);
  initialTimer.unref();

  const interval = setInterval(() => void checkForUpdates(true), UPDATE_CHECK_INTERVAL_MS);
  interval.unref();
}
