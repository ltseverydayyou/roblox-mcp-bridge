import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { describeResponse, sendAndWait } from "../../factory.js";

export default function register(server: McpServer): void {
  server.registerTool(
    "type-text-box",
    {
      title: "Type into a TextBox",
      description:
        "Enter text into a Roblox TextBox by path. Can simulate keystrokes or set Text directly based on useKeyPress.",
      inputSchema: z.object({
        path: z.string().describe("The instance path to the TextBox").optional(),
        debugId: z.string().describe("Stable DebugId from search/GUI inspection; preferred when paths are ambiguous.").optional(),
        text: z.string().describe("The string to type into the TextBox"),
        enter: z
          .boolean()
          .describe("Whether to press Enter after typing")
          .optional()
          .default(false),
        useKeyPress: z
          .boolean()
          .describe(
            "If true, simulates real keystrokes using VirtualInputManager / keypress. If false, directly sets the Text property."
          )
          .optional()
          .default(true),
      }),
    },
    async ({ path, debugId, text, enter, useKeyPress }) =>
      sendAndWait({
        type: "type-text-box",
        data: { path, debugId, text, string: text, enter, useKeyPress },
        failureField: "error",
        failureMessage: (response) =>
          "Failed to type into TextBox: " + describeResponse(response),
        successMessage: (response) =>
          (response.output as string | undefined) || "Successfully typed into TextBox.",
      })
  );
}
