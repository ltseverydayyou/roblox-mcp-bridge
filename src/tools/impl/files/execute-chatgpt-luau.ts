import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { downloadOpenAIFile } from "../../../files/chatgpt-file.js";
import { detectRiskyExecutorMethods, riskConfirmationMessage, sendFireAndForget, toolTextResponse } from "../../factory.js";
import { threadContextSchema } from "../../schemas.js";
import { openAIFileInputSchema } from "./file-schema.js";

const MAX_EXECUTABLE_FILE_BYTES = 8 * 1024 * 1024;
const EXECUTABLE_EXTENSIONS = new Set([".lua", ".luau", ".txt"]);

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

        let source: string;
        try {
          source = new TextDecoder("utf-8", { fatal: true }).decode(downloaded.bytes);
        } catch {
          return toolTextResponse(
            `Refusing to execute ${downloaded.fileName}: the file is not valid UTF-8 text.`,
            {},
            true
          );
        }
        source = normalizeChatGptLuauSource(source);
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
          `[ChatGPT File] Executing ${downloaded.fileName} (${downloaded.bytes.length} bytes, sha256=${downloaded.sha256}) in thread ${threadContext}...`
        );
        return sendFireAndForget({
          type: "execute",
          data: { source: `setthreadidentity(${threadContext})\n${source}`, userConfirmedRisk: userConfirmedRisk === true },
          successMessage:
            `Downloaded and executed ${downloaded.fileName} ` +
            `(${downloaded.bytes.length} bytes, sha256=${downloaded.sha256}, thread context ${threadContext}).`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return toolTextResponse(`Failed to execute ChatGPT Luau file: ${message}`, {}, true);
      }
    }
  );
}
