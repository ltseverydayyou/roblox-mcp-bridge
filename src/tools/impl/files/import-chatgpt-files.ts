import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { stageOpenAIFile } from "../../../files/chatgpt-file.js";
import { toolTextResponse } from "../../factory.js";
import { maxOutputCharsSchema } from "../../schemas.js";
import { openAIFileInputSchema } from "./file-schema.js";

export default function register(server: McpServer): void {
  server.registerTool(
    "import-chatgpt-files",
    {
      title: "Import files from ChatGPT",
      description:
        "Transfer complete ChatGPT attachments or generated files to this computer through authorized temporary download URLs. Use this instead of passing ChatGPT sandbox paths such as /mnt/data/file.lua. Returns safe local paths, sizes, MIME types, and SHA-256 hashes.",
      inputSchema: z.object({
        files: z
          .array(openAIFileInputSchema)
          .min(1)
          .max(10)
          .describe("Files selected or attached in ChatGPT. Maximum 10 files per call."),
        maxOutputChars: maxOutputCharsSchema,
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: {
        "openai/fileParams": ["files"],
      },
    },
    async ({ files, maxOutputChars }) => {
      try {
        const staged = [];
        for (const file of files) {
          staged.push(await stageOpenAIFile(file));
        }

        return toolTextResponse(
          `Imported ${staged.length} ChatGPT ${staged.length === 1 ? "file" : "files"}:\n` +
            staged
              .map(
                (file, index) =>
                  `${index + 1}. ${file.fileName}\n` +
                  `   localPath=${file.localPath}\n` +
                  `   bytes=${file.size} mime=${file.mimeType ?? "unknown"}\n` +
                  `   sha256=${file.sha256}`
              )
              .join("\n"),
          { maxOutputChars }
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return toolTextResponse(`Failed to import ChatGPT file: ${message}`, {}, true);
      }
    }
  );
}
