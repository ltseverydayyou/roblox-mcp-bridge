import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectRiskyExecutorMethods, describeResponse, riskConfirmationMessage, sendAndWait, toolTextResponse } from "../../factory.js";
import { maxOutputCharsSchema, threadContextSchema } from "../../schemas.js";

export default function register(server: McpServer): void {
  server.registerTool(
    "get-data-by-code",
    {
      title: "Get data by code",
      description:
        "Execute Luau in the active Roblox client and return serialized raw Lua values. If the probe calls potentially detectable executor introspection/hooking methods, ask the user for confirmation first and set userConfirmedRisk=true. Safe targeted probes do not need the flag. Prefer specialized inspection tools when possible.",
      inputSchema: z.object({
        code: z
          .string()
          .describe(
            "Code to run in the Roblox client (MUST return one or more values). Return small, specific values — never whole instances or large tables. Return raw Lua values; the connector serializes them (do NOT JSONEncode yourself)."
          ),
        threadContext: threadContextSchema,
        timeout: z
          .number()
          .describe(
            "Timeout in milliseconds for the response (default: 15000, max: 120000). Increase for long-running operations like decompiling many modules."
          )
          .optional()
          .default(15000),
        maxOutputChars: maxOutputCharsSchema,
        userConfirmedRisk: z.boolean().optional().describe("Set true only after the user explicitly approves risky executor methods detected in this probe."),
      }),
    },
    async ({ code, threadContext, timeout, maxOutputChars, userConfirmedRisk }) => {
      const riskyMethods = detectRiskyExecutorMethods(code);
      if (riskyMethods.length > 0 && userConfirmedRisk !== true) {
        return toolTextResponse(riskConfirmationMessage(riskyMethods), {}, true);
      }
      console.error(`Executing code in thread ${threadContext}...`);
      const clampedTimeout = Math.min(Math.max(timeout, 1000), 120000);

      return sendAndWait({
        type: "get-data-by-code",
        data: { source: `setthreadidentity(${threadContext});${code}`, userConfirmedRisk: userConfirmedRisk === true },
        timeoutMs: clampedTimeout,
        maxOutputChars,
        stampClient: true,
        truncationHint: "Rerun get-data-by-code with code that returns fewer fields or pass a smaller maxOutputChars.",
        failureMessage: (response) =>
          "Failed to get data by code: " + describeResponse(response),
      });
    }
  );
}
