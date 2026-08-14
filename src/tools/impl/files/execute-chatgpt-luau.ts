import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { downloadOpenAIFile } from "../../../files/chatgpt-file.js";
import { sendFireAndForget, toolTextResponse } from "../../factory.js";
import { threadContextSchema } from "../../schemas.js";
import { openAIFileInputSchema } from "./file-schema.js";

const MAX_EXECUTABLE_FILE_BYTES = 8 * 1024 * 1024;
const EXECUTABLE_EXTENSIONS = new Set([".lua", ".luau", ".txt"]);

export default function register(server: McpServer): void {
  server.registerTool(
    "execute-chatgpt-luau",
    {
      title: "Execute a ChatGPT Luau file",
      description:
        "Download one complete Luau file supplied by ChatGPT and execute it in the active Roblox client. Use this for attached or generated /mnt/data files instead of copying code in chunks. Accepts .lua, .luau, and plain-text source files up to 8 MiB.",
      inputSchema: z.object({
        file: openAIFileInputSchema.describe("The ChatGPT file containing Luau source code."),
        threadContext: threadContextSchema,
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
    async ({ file, threadContext }) => {
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
        if (source.includes("\0")) {
          return toolTextResponse(
            `Refusing to execute ${downloaded.fileName}: the source contains NUL bytes.`,
            {},
            true
          );
        }

        console.error(
          `[ChatGPT File] Executing ${downloaded.fileName} (${downloaded.bytes.length} bytes, sha256=${downloaded.sha256}) in thread ${threadContext}...`
        );
        return sendFireAndForget({
          type: "execute",
          data: { source: `setthreadidentity(${threadContext})\n${source}` },
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
