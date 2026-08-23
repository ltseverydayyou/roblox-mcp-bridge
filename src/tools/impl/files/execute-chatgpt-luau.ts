import fs from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { stageChatGptTextFile, stageOpenAIFile } from "../../../files/chatgpt-file.js";
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

export function isChatGptSandboxPathOnly(value: string): boolean {
  return /^\/mnt\/data\/[^\r\n]+$/.test(value.trim());
}

export default function register(server: McpServer): void {
  server.registerTool(
    "execute-chatgpt-luau",
    {
      title: "Execute a ChatGPT Luau file",
      description:
        "Execute a ChatGPT Luau attachment or generated file in the active Roblox client. The bridge stages it in a real writable MCP-host/Android file, reads it back from that path, and then executes it. Preferred: pass file as the complete ChatGPT-injected file object, never a /mnt/data pathname or bare file_id. Fallback: read the sandbox file and pass its complete text as source with fileName. Do not use LZ4, Base64, or chunked transfer workarounds. If the code calls potentially detectable executor introspection/hooking methods, ask the user for confirmation first and set userConfirmedRisk=true.",
      inputSchema: z
        .object({
          file: openAIFileInputSchema
            .optional()
            .describe(
              "Preferred complete ChatGPT file object with download_url and file_id. ChatGPT injects this object. Never pass a /mnt/data string or a bare file_id."
            ),
          source: z
            .string()
            .min(1)
            .optional()
            .describe(
              "Fallback complete Luau source text read from ChatGPT's sandbox. Never pass the /mnt/data pathname itself."
            ),
          fileName: z
            .string()
            .optional()
            .describe("Display filename for source fallback, such as patched-script.luau."),
          threadContext: threadContextSchema,
          userConfirmedRisk: z.boolean().optional().describe("Set true only after the user explicitly approves risky executor methods detected in the downloaded file."),
        })
        .refine((input) => Boolean(input.file) !== Boolean(input.source), {
          message: "Provide exactly one of file (the complete ChatGPT file object) or source (the complete Luau text).",
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
    async ({ file, source: inlineSource, fileName, threadContext, userConfirmedRisk }) => {
      try {
        if (inlineSource !== undefined && isChatGptSandboxPathOnly(inlineSource)) {
          return toolTextResponse(
            "The source field received only a ChatGPT sandbox pathname. Read that /mnt/data file in ChatGPT and call execute-chatgpt-luau again with its complete text in source. Do not compress, Base64-encode, or split it into chunks.",
            {},
            true
          );
        }

        const staged = file
          ? await stageOpenAIFile(file, MAX_EXECUTABLE_FILE_BYTES)
          : await stageChatGptTextFile(fileName, inlineSource!, MAX_EXECUTABLE_FILE_BYTES);
        const bytes = await fs.readFile(staged.localPath);
        const extension = path.extname(staged.fileName).toLowerCase();
        if (extension && !EXECUTABLE_EXTENSIONS.has(extension)) {
          return toolTextResponse(
            `Refusing to execute ${staged.fileName}: expected a .lua, .luau, or .txt file. ` +
              "Use import-chatgpt-files for non-code attachments.",
            {},
            true
          );
        }

        let decoded: DecodedChatGptLuauSource;
        try {
          decoded = decodeChatGptLuauSource(bytes);
        } catch {
          return toolTextResponse(
            `Refusing to execute ${staged.fileName}: its text encoding could not be decoded safely.`,
            {},
            true
          );
        }
        const source = normalizeChatGptLuauSource(decoded.source);
        if (source.includes("\0")) {
          return toolTextResponse(
            `Refusing to execute ${staged.fileName}: the source contains NUL bytes.`,
            {},
            true
          );
        }

        const riskyMethods = detectRiskyExecutorMethods(source);
        if (riskyMethods.length > 0 && userConfirmedRisk !== true) {
          return toolTextResponse(riskConfirmationMessage(riskyMethods), {}, true);
        }

        console.error(
          `[ChatGPT File] Executing ${staged.fileName} from ${staged.localPath} (${bytes.length} bytes, encoding=${decoded.encoding}, sha256=${staged.sha256}) in thread ${threadContext}...`
        );
        return sendFireAndForget({
          type: "execute",
          data: { source: `setthreadidentity(${threadContext})\n${source}`, userConfirmedRisk: userConfirmedRisk === true },
          successMessage:
            `Staged and executed file path: ${staged.localPath} (${staged.fileName}, ${bytes.length} bytes, ` +
            `source encoding ${decoded.encoding}, sha256=${staged.sha256}, thread context ${threadContext}).`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return toolTextResponse(`Failed to execute ChatGPT Luau file: ${message}`, {}, true);
      }
    }
  );
}
