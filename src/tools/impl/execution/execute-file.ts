import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fs from "fs";
import path from "node:path";
import { z } from "zod";
import { stageChatGptTextFile } from "../../../files/chatgpt-file.js";
import { detectRiskyExecutorMethods, riskConfirmationMessage, sendFireAndForget, toolTextResponse } from "../../factory.js";
import { threadContextSchema } from "../../schemas.js";

const MAX_INLINE_SOURCE_BYTES = 8 * 1024 * 1024;

export default function register(server: McpServer): void {
  server.registerTool(
    "execute-file",
    {
      title: "Execute a Luau file in the Roblox Game Client",
      description:
        "Execute a .luau/.lua file in the active Roblox client without returning output. A physical MCP-host filePath is read directly. Inline source is first staged as a real file in the MCP host's writable ChatGPT cache, read back from that path, and then executed. For ChatGPT attachments, prefer execute-chatgpt-luau with its host-injected file object; never pass a sandbox path, Base64, LZ4, or chunks. If the source calls potentially detectable executor introspection/hooking methods, ask the user for confirmation first and set userConfirmedRisk=true.",
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
        userConfirmedRisk: z.boolean().optional().describe("Set true only after the user explicitly approves risky executor methods detected in this file."),
      }),
    },
    async ({ filePath, source, fileName, threadContext, userConfirmedRisk }) => {
      let code: string;
      let displayName: string;
      let executedPath: string;

      if (source !== undefined) {
        const sourceBytes = Buffer.byteLength(source, "utf8");
        if (sourceBytes > MAX_INLINE_SOURCE_BYTES) {
          return toolTextResponse(
            `Inline source exceeds the ${MAX_INLINE_SOURCE_BYTES}-byte limit.`,
            {},
            true
          );
        }

        displayName = fileName || (filePath ? path.basename(filePath) : "inline-source.luau");
        const staged = await stageChatGptTextFile(displayName, source, MAX_INLINE_SOURCE_BYTES);
        executedPath = staged.localPath;
        code = fs.readFileSync(executedPath, "utf-8");
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
        executedPath = filePath;
      }

      const riskyMethods = detectRiskyExecutorMethods(code);
      if (riskyMethods.length > 0 && userConfirmedRisk !== true) {
        return toolTextResponse(riskConfirmationMessage(riskyMethods), {}, true);
      }

      console.error(`Executing file ${displayName} from ${executedPath} in thread ${threadContext}...`);

      return sendFireAndForget({
        type: "execute",
        data: { source: `setthreadidentity(${threadContext})\n${code}`, userConfirmedRisk: userConfirmedRisk === true },
        successMessage: `Staged and executed file path: ${executedPath} (${displayName}, thread context ${threadContext})`,
      });
    }
  );
}
