import type { IncomingMessage } from "http";
import { MAX_HTTP_BODY_BYTES } from "../config.js";

export class HttpBodyTooLargeError extends Error {
  readonly statusCode = 413;

  constructor(readonly maxBytes: number) {
    super(`HTTP request body exceeds the ${maxBytes}-byte limit.`);
    this.name = "HttpBodyTooLargeError";
  }
}

export function readBody(
  req: IncomingMessage,
  maxBytes: number = MAX_HTTP_BODY_BYTES
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;

    req.on("data", (chunk: Buffer) => {
      if (settled) return;

      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > maxBytes) {
        settled = true;
        chunks.length = 0;
        reject(new HttpBodyTooLargeError(maxBytes));
        return;
      }
      chunks.push(buffer);
    });
    req.on("end", () => {
      if (!settled) resolve(Buffer.concat(chunks, totalBytes).toString("utf8"));
    });
    req.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

export async function readJsonBody<T>(
  req: IncomingMessage,
  maxBytes: number = MAX_HTTP_BODY_BYTES
): Promise<T> {
  const raw = await readBody(req, maxBytes);
  return raw ? (JSON.parse(raw) as T) : ({} as T);
}
