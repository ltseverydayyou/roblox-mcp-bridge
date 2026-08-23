import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { downloadOpenAIFile } from "../../../files/chatgpt-file.js";
import { detectRiskyExecutorMethods, riskConfirmationMessage, sendFireAndForget, toolTextResponse } from "../../factory.js";
import { threadContextSchema } from "../../schemas.js";
import { openAIFileInputSchema } from "./file-schema.js";

const MAX_EXECUTABLE_FILE_BYTES = 8 * 1024 * 1024;
const EXECUTABLE_EXTENSIONS = new Set([".lua", ".luau", ".txt"]);

export interface DecodedChatGptLuauSource {
  source: string;
  encoding: "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";
}

function likelyBomlessUtf16(bytes: Uint8Array): "utf-16le" | "utf-16be" | undefined {
  const sampleLength = Math.min(bytes.length - (bytes.length % 2), 2048);
  if (sampleLength < 8) return undefined;
  let evenNuls = 0;
  let oddNuls = 0;
  for (let index = 0; index < sampleLength; index += 2) {
    if (bytes[index] === 0) evenNuls += 1;
    if (bytes[index + 1] === 0) oddNuls += 1;
  }
  const pairs = sampleLength / 2;
  if (oddNuls / pairs >= 0.3 && evenNuls / pairs <= 0.05) return "utf-16le";
  if (evenNuls / pairs >= 0.3 && oddNuls / pairs <= 0.05) return "utf-16be";
  return undefined;
}

export function decodeChatGptLuauSource(bytes: Uint8Array): DecodedChatGptLuauSource {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return {
      source: new TextDecoder("utf-16le", { fatal: true }).decode(bytes.subarray(2)),
      encoding: "utf-16le",
    };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return {
      source: new TextDecoder("utf-16be", { fatal: true }).decode(bytes.subarray(2)),
      encoding: "utf-16be",
    };
  }

  // BOM-less UTF-16 containing mostly ASCII is also valid UTF-8 with an
  // embedded NUL after every character, so detect that byte pattern first.
  const utf16 = likelyBomlessUtf16(bytes);
  if (utf16) {
    return {
      source: new TextDecoder(utf16, { fatal: true }).decode(bytes),
      encoding: utf16,
    };
  }

  try {
    return {
      source: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      encoding: "utf-8",
    };
  } catch {
    // Windows editors and PowerShell-generated scripts may contain legacy
    // punctuation bytes even when ChatGPT labels the attachment as text.
    return {
      source: new TextDecoder("windows-1252").decode(bytes),
      encoding: "windows-1252",
    };
  }
}

export function normalizeChatGptLuauSource(source: string): string {
  // Some ChatGPT attachments retain Windows line endings or a UTF-8 BOM.
  // Normalize both before prepending the thread identity so executor parsers
  // receive the same source that ChatGPT's direct-source fallback would send.
  return source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

export default function register(server: McpServer): void {
  server.registerTool(
    "execute-chatgpt-luau",
    {
      title: "Execute a ChatGPT Luau file",
      description:
        "Download one complete Luau file supplied by ChatGPT and execute it in the active Roblox client. If the file calls potentially detectable executor introspection/hooking methods, ask the user for confirmation first and set userConfirmedRisk=true. Safe files do not need the flag.",
      inputSchema: z.object({
        file: openAIFileInputSchema.describe("The ChatGPT file containing Luau source code."),
        threadContext: threadContextSchema,
        userConfirmedRisk: z.boolean().optional().describe("Set true only after the user explicitly approves risky executor methods detected in the downloaded file."),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      _meta: {
        "openai/fileParams": ["file"],
      },
    },
    async ({ file, threadContext, userConfirmedRisk }) => {
      try {
        const downloaded = await downloadOpenAIFile(file, MAX_EXECUTABLE_FILE_BYTES);
        const extension = path.extname(downloaded.fileName).toLowerCase();
        if (extension && !EXECUTABLE_EXTENSIONS.has(extension)) {
          return toolTextResponse(
            `Refusing to execute ${downloaded.fileName}: expected a .lua, .luau, or .txt file. ` +
              "Use import-chatgpt-files for non-code attachments.",
            {},
            true
          );
        }

        let decoded: DecodedChatGptLuauSource;
        try {
          decoded = decodeChatGptLuauSource(downloaded.bytes);
        } catch {
          return toolTextResponse(
            `Refusing to execute ${downloaded.fileName}: its text encoding could not be decoded safely.`,
            {},
            true
          );
        }
        const source = normalizeChatGptLuauSource(decoded.source);
        if (source.includes("\0")) {
          return toolTextResponse(
            `Refusing to execute ${downloaded.fileName}: the source contains NUL bytes.`,
            {},
            true
          );
        }

        const riskyMethods = detectRiskyExecutorMethods(source);
        if (riskyMethods.length > 0 && userConfirmedRisk !== true) {
          return toolTextResponse(riskConfirmationMessage(riskyMethods), {}, true);
        }

        console.error(
          `[ChatGPT File] Executing ${downloaded.fileName} (${downloaded.bytes.length} bytes, encoding=${decoded.encoding}, sha256=${downloaded.sha256}) in thread ${threadContext}...`
        );
        return sendFireAndForget({
          type: "execute",
          data: { source: `setthreadidentity(${threadContext})\n${source}`, userConfirmedRisk: userConfirmedRisk === true },
          successMessage:
            `Downloaded and executed ${downloaded.fileName} ` +
            `(${downloaded.bytes.length} bytes, source encoding ${decoded.encoding}, sha256=${downloaded.sha256}, thread context ${threadContext}).`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return toolTextResponse(`Failed to execute ChatGPT Luau file: ${message}`, {}, true);
      }
    }
  );
}
