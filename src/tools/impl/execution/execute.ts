import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectRiskyExecutorMethods, riskConfirmationMessage, sendFireAndForget, toolTextResponse } from "../../factory.js";
import { threadContextSchema } from "../../schemas.js";

export default function register(server: McpServer): void {
  server.registerTool(
    "execute",
    {
      title: "Execute Code in the Roblox Game Client",
      description:
        "Execute Luau in the active Roblox client without returning output. If the source calls potentially detectable executor introspection/hooking methods (for example getgc, getnilinstances, getconnections, getloadedmodules, hookfunction, hookmetamethod, registry/debug closure APIs), ask the user for confirmation first and set userConfirmedRisk=true. Safe code does not need this flag.",
      inputSchema: z.object({
        code: z
          .string()
          .describe(
            "The code to execute in the Roblox Game Client. This tool does NOT return output - use get-data-by-code if you need to retrieve data."
          ),
        threadContext: threadContextSchema,
        userConfirmedRisk: z.boolean().optional().describe("Set true only after the user explicitly approves any risky executor methods detected in code."),
      }),
    },
    async ({ code, threadContext, userConfirmedRisk }) => {
      const riskyMethods = detectRiskyExecutorMethods(code);
      if (riskyMethods.length > 0 && userConfirmedRisk !== true) {
        return toolTextResponse(riskConfirmationMessage(riskyMethods), {}, true);
      }
      console.error(`Executing code in thread ${threadContext}...`);
      return sendFireAndForget({
        type: "execute",
        data: { source: `setthreadidentity(${threadContext})\n${code}`, userConfirmedRisk: userConfirmedRisk === true },
        successMessage: `Code has been scheduled to be run in thread context ${threadContext}.`,
      });
    }
  );
}
