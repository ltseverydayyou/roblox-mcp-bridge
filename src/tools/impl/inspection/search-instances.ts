import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { describeResponse, sendAndWait } from "../../factory.js";
import { maxOutputCharsSchema } from "../../schemas.js";

export default function register(server: McpServer): void {
  server.registerTool(
    "search-instances",
    {
      title: "Search for instances in the game",
      description:
        "Search Roblox instances with QueryDescendants selector syntax. Use for class, name, tag, property, and attribute queries against a chosen root.",
      inputSchema: z.object({
        selector: z
          .string()
          .describe(
            "QueryDescendants selector. Supports class (Part), tag (.Tagged), name (#HumanoidRootPart), property ([CanCollide = false]), attribute ([$QuestId]), combinators (> >>), OR (,), :not(), :has(). Chain for AND, e.g. Part.Tagged[Anchored = false]."
          ),
        rootDebugId: z.string().describe("Optional DebugId to use as the search root instead of root path.").optional(),
        root: z
          .string()
          .describe(
            "The root instance to search from (e.g., 'game.Workspace', 'game.ReplicatedStorage'). Defaults to 'game' if not specified."
          )
          .optional()
          .default("game"),
        limit: z
          .number()
          .describe("Maximum number of results to return (default: 20, to avoid overwhelming output)")
          .optional()
          .default(20),
        maxOutputChars: maxOutputCharsSchema,
      }),
    },
    async ({ selector, rootDebugId, root, limit, maxOutputChars }) =>
      sendAndWait({
        type: "search-instances",
        data: { selector, rootDebugId, root, limit },
        maxOutputChars,
        stampClient: true,
        truncationHint: "Rerun search-instances with a narrower selector, tighter root, or lower limit.",
        failureMessage: (response) =>
          "Failed to search instances: " + describeResponse(response),
      })
  );
}
