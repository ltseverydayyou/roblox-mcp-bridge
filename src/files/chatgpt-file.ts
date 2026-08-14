import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {
  CHATGPT_FILE_DOWNLOAD_TIMEOUT_MS,
  MAX_CHATGPT_FILE_BYTES,
} from "../config.js";

export interface OpenAIFileInput {
  download_url: string;
  file_id: string;
  mime_type?: string;
  file_name?: string;
}

export interface DownloadedOpenAIFile {
  bytes: Buffer;
  fileId: string;
  fileName: string;
  mimeType?: string;
  sha256: string;
}

export interface StagedOpenAIFile extends Omit<DownloadedOpenAIFile, "bytes"> {
  localPath: string;
  size: number;
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a === 0
  );
}

function isPrivateIpv6(hostname: string): boolean {
  const value = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    value === "::" ||
    value === "::1" ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    value.startsWith("fe8") ||
    value.startsWith("fe9") ||
    value.startsWith("fea") ||
    value.startsWith("feb")
  );
}

export function validateChatGptDownloadUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("ChatGPT supplied an invalid file download URL.");
  }

  if (url.protocol !== "https:") {
    throw new Error("ChatGPT file downloads must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("ChatGPT file download URLs cannot contain embedded credentials.");
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    (net.isIP(hostname) === 4 && isPrivateIpv4(hostname)) ||
    (net.isIP(hostname.replace(/^\[|\]$/g, "")) === 6 && isPrivateIpv6(hostname))
  ) {
    throw new Error("ChatGPT file download URLs cannot target local or private network addresses.");
  }

  return url;
}

export function sanitizeUploadedFileName(fileName: string | undefined, fileId: string): string {
  const fallback = `${fileId || "chatgpt-file"}.bin`;
  const base = path.basename((fileName || fallback).trim()) || fallback;
  const cleaned = base
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 160);
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : fallback;
}

export async function downloadOpenAIFile(
  input: OpenAIFileInput,
  maxBytes: number = MAX_CHATGPT_FILE_BYTES
): Promise<DownloadedOpenAIFile> {
  let currentUrl = validateChatGptDownloadUrl(input.download_url);
  const signal = AbortSignal.timeout(CHATGPT_FILE_DOWNLOAD_TIMEOUT_MS);
  let response: Response | undefined;

  // Follow redirects manually so every hop is validated before the request is
  // made. Automatic redirects could otherwise turn a public HTTPS URL into an
  // SSRF request against a local service.
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    response = await fetch(currentUrl, {
      redirect: "manual",
      signal,
      headers: { Accept: "*/*" },
    });

    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get("location");
    if (!location) {
      throw new Error(`ChatGPT file download returned redirect HTTP ${response.status} without a location.`);
    }
    if (redirectCount === 5) {
      throw new Error("ChatGPT file download exceeded the redirect limit.");
    }
    await response.body?.cancel();
    currentUrl = validateChatGptDownloadUrl(new URL(location, currentUrl).toString());
  }

  if (!response) {
    throw new Error("ChatGPT file download did not produce a response.");
  }

  if (!response.ok) {
    throw new Error(`ChatGPT file download failed with HTTP ${response.status}.`);
  }

  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`ChatGPT file exceeds the ${maxBytes}-byte limit.`);
  }
  if (!response.body) {
    throw new Error("ChatGPT file download returned no response body.");
  }

  const chunks: Buffer[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      size += chunk.length;
      if (size > maxBytes) {
        await reader.cancel("file size limit exceeded");
        throw new Error(`ChatGPT file exceeds the ${maxBytes}-byte limit.`);
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = Buffer.concat(chunks, size);
  return {
    bytes,
    fileId: input.file_id,
    fileName: sanitizeUploadedFileName(input.file_name, input.file_id),
    mimeType: input.mime_type || response.headers.get("content-type") || undefined,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

export function getChatGptUploadDirectory(): string {
  return path.resolve(
    process.env.ROBLOX_MCP_UPLOAD_DIR ||
      path.join(os.tmpdir(), "roblox-mcp-bridge", "chatgpt-files")
  );
}

export async function stageOpenAIFile(
  input: OpenAIFileInput,
  maxBytes: number = MAX_CHATGPT_FILE_BYTES
): Promise<StagedOpenAIFile> {
  const downloaded = await downloadOpenAIFile(input, maxBytes);
  const uploadDir = getChatGptUploadDirectory();
  await fs.mkdir(uploadDir, { recursive: true });

  const parsed = path.parse(downloaded.fileName);
  const idSuffix = crypto.createHash("sha256").update(downloaded.fileId).digest("hex").slice(0, 10);
  const stagedName = `${parsed.name.slice(0, 120)}-${idSuffix}${parsed.ext.slice(0, 20)}`;
  const localPath = path.join(uploadDir, stagedName);

  await fs.writeFile(localPath, downloaded.bytes, { flag: "wx" }).catch(async (error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await fs.readFile(localPath);
    const existingHash = crypto.createHash("sha256").update(existing).digest("hex");
    if (existingHash !== downloaded.sha256) {
      throw new Error(`A different staged file already exists at ${localPath}.`);
    }
  });

  return {
    localPath,
    size: downloaded.bytes.length,
    fileId: downloaded.fileId,
    fileName: downloaded.fileName,
    mimeType: downloaded.mimeType,
    sha256: downloaded.sha256,
  };
}
