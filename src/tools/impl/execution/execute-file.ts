import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fs from "fs";
import path from "node:path";
import { z } from "zod";
import { sendFireAndForget, toolTextResponse } from "../../factory.js";
import { threadContextSchema } from "../../schemas.js";

const MAX_INLINE_SOURCE_BYTES = 8 * 1024 * 1024;

export default function register(server: McpServer): void {
  server.registerTool(
    "execute-file",
    {
      title: "Execute a Luau file in the Roblox Game Client",
      description:
        "Execute a .luau/.lua file in the active Roblox client without returning output. For files on the MCP host, pass filePath. ChatGPT sandbox paths such as /mnt/data are not mounted on the MCP host: ChatGPT must read the file itself and pass its complete contents in source, optionally preserving the original path/name in filePath or fileName. Use get-data-by-code instead when you need returned values.",
      inputSchema: z.object({
        filePath: z
          .string()
          .optional()
          .describe(
            "Optional file path/name for the file. When source is omitted, this must be an absolute path that exists on the MCP host. A ChatGPT /mnt/data path is only a label when source is also supplied."
          ),
        source: z
          .string()
          .optional()
          .describe(
            "Optional complete Luau source. Use this for ChatGPT /mnt/data files: read the sandbox file in ChatGPT, then pass its contents here. When provided, the MCP host does not read filePath."
          ),
        fileName: z
          .string()
          .optional()
          .describe("Optional display filename for inline source, such as TailSway.luau."),
        threadContext: threadContextSchema,
      }),
    },
    async ({ filePath, source, fileName, threadContext }) => {
      let code: string;
      let displayName: string;

      if (source !== undefined) {
        const sourceBytes = Buffer.byteLength(source, "utf8");
        if (sourceBytes > MAX_INLINE_SOURCE_BYTES) {
          return toolTextResponse(
            `Inline source exceeds the ${MAX_INLINE_SOURCE_BYTES}-byte limit.`,
            {},
            true
          );
        }

        code = source;
        displayName = fileName || (filePath ? path.basename(filePath) : "inline-source.luau");
      } else {
        if (!filePath) {
          return toolTextResponse(
            "Either filePath or source is required. For ChatGPT /mnt/data files, read the file in ChatGPT and pass its contents using source.",
            {},
            true
          );
        }

        if (!fs.existsSync(filePath)) {
          const sandboxHint = filePath.startsWith("/mnt/data/")
            ? " ChatGPT /mnt/data is a separate sandbox; read that file in ChatGPT and call execute-file again with source set to the file contents."
            : "";
          return toolTextResponse(`File not found: ${filePath}.${sandboxHint}`, {}, true);
        }

        code = fs.readFileSync(filePath, "utf-8");
        displayName = fileName || filePath;
      }

      console.error(`Executing file ${displayName} in thread ${threadContext}...`);

      return sendFireAndForget({
        type: "execute",
        data: { source: `setthreadidentity(${threadContext})\n${code}` },
        successMessage: `File executed: ${displayName} (thread context ${threadContext})`,
      });
    }
  );
}
