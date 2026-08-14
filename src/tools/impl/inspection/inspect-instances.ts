import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { describeResponse, sendAndWait } from "../../factory.js";
import { maxOutputCharsSchema } from "../../schemas.js";

export default function register(server: McpServer): void {
  server.registerTool(
    "inspect-instances",
    {
      title: "Inspect Roblox instances",
      description:
        "Inspect one or more Roblox instances in a single call. Returns stable debug IDs, selected readable properties, attributes, tags, and a bounded immediate-child summary. Prefer this over arbitrary Luau for ordinary instance inspection.",
      inputSchema: z.object({
        paths: z
          .array(z.string())
          .min(1)
          .max(25)
          .describe(
            "Instance paths to inspect, such as ['game.Workspace.Baseplate', 'game.Players.LocalPlayer']. Maximum 25 paths."
          ),
        properties: z
          .array(z.string())
          .max(50)
          .describe(
            "Optional property names to read from every instance. When omitted, a curated class-aware set of useful properties is returned."
          )
          .optional(),
        includeAttributes: z
          .boolean()
          .describe("Include custom attributes (default: true).")
          .optional()
          .default(true),
        includeTags: z
          .boolean()
          .describe("Include CollectionService tags (default: true).")
          .optional()
          .default(true),
        includeChildren: z
          .boolean()
          .describe("Include a bounded summary of immediate children (default: true).")
          .optional()
          .default(true),
        maxChildren: z
          .number()
          .describe("Maximum immediate children returned per instance (default: 20, max: 100).")
          .optional()
          .default(20),
        maxOutputChars: maxOutputCharsSchema,
      }),
    },
    async ({
      paths,
      properties,
      includeAttributes,
      includeTags,
      includeChildren,
      maxChildren,
      maxOutputChars,
    }) =>
      sendAndWait({
        type: "inspect-instances",
        data: {
          paths,
          ...(properties ? { properties } : {}),
          includeAttributes,
          includeTags,
          includeChildren,
          maxChildren,
        },
        maxOutputChars,
        stampClient: true,
        truncationHint:
          "Rerun inspect-instances with fewer paths, fewer properties, includeChildren=false, or a lower maxChildren.",
        failureMessage: (response) =>
          "Failed to inspect instances: " + describeResponse(response),
      })
  );
}
