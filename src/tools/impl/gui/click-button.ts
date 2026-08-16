import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { describeResponse, sendAndWait } from "../../factory.js";

export default function register(server: McpServer): void {
  server.registerTool(
    "click-button",
    {
      title: "Click a GuiButton",
      description:
        "Click a Roblox TextButton or ImageButton by firing its GUI signals. Use when direct UI activation is needed inside the active client.",
      inputSchema: z.object({
        path: z.string().describe("The instance path to the Button").optional(),
        debugId: z.string().describe("Stable DebugId from search/GUI inspection; preferred when paths are ambiguous.").optional(),
        action: z
          .string()
          .describe(
            "The specific signal to fire (e.g., 'Activated', 'MouseButton1Click'). If omitted, fires all standard click signals."
          )
          .optional(),
      }),
    },
    async ({ path, debugId, action }) =>
      sendAndWait({
        type: "click-button",
        data: { path, debugId, action },
        failureField: "error",
        failureMessage: (response) =>
          "Failed to click Button: " + describeResponse(response),
        successMessage: (response) =>
          (response.output as string | undefined) || "Successfully fired click signals on Button.",
      })
  );
}
