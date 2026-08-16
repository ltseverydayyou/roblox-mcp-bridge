import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sendAndWait } from "../../factory.js";
import { maxOutputCharsSchema } from "../../schemas.js";

export default function register(server: McpServer): void {
  server.registerTool(
    "get-console-output",
    {
      title: "Get the roblox developer console output from the Roblox Game Client",
      description:
        "Read recent Roblox developer console logs from the active client. Use limit and logsOrder to control volume and ordering.",
      inputSchema: z.object({
        limit: z
          .number()
          .describe("Maximum number of results to return (default: 10, to avoid overwhelming output)")
          .optional()
          .default(10),
        logsOrder: z
          .enum(["NewestFirst", "OldestFirst"])
          .describe("The order of the logs to return (default: NewestFirst)")
          .optional()
          .default("NewestFirst"),
        sinceCursor: z.string().describe("Cursor returned by create-console-cursor; when set, only newer log entries are considered.").optional(),
        filter: z
          .string()
          .describe("Optional string filter; only logs containing this text are returned")
          .optional(),
        summaryOnly: z
          .boolean()
          .describe("When true, return log counts by level instead of individual log lines.")
          .optional()
          .default(false),
        maxOutputChars: maxOutputCharsSchema,
      }),
    },
    async ({ limit, logsOrder, sinceCursor, filter, summaryOnly, maxOutputChars }) =>
      sendAndWait({
        type: "get-console-output",
        data: { limit, logsOrder, sinceCursor, filter, summaryOnly },
        maxOutputChars,
        stampClient: true,
        truncationHint: "Rerun get-console-output with a filter, lower limit, or summaryOnly=true.",
        failureMessage: () => "Failed to get console output.",
      })
  );
}
