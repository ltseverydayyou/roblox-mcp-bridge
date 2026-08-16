import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { describeResponse, sendAndWait } from "../../factory.js";
import { maxOutputCharsSchema, userConfirmedRiskSchema } from "../../schemas.js";

const directionSchema = z.enum(["Incoming", "Outgoing"]);

const inputSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("list"),
    userConfirmedRisk: userConfirmedRiskSchema,
    direction: z
      .enum(["Incoming", "Outgoing", "Both"])
      .describe("Call direction to inspect (default: Both)")
      .optional()
      .default("Both"),
    nameFilter: z
      .string()
      .describe("Case-insensitive substring filter for remote names")
      .optional(),
    limit: z
      .number()
      .describe("Maximum remote entries to return (default: 5, max: 100)")
      .optional()
      .default(5),
    maxCallsPerRemote: z
      .number()
      .describe("Recent calls to include per remote when summaryOnly is false (default: 1, max: 20)")
      .optional()
      .default(1),
    sinceCursor: z.string().describe("Optional cursor from operation=mark; only remotes with newer calls are returned.").optional(),
    summaryOnly: z
      .boolean()
      .describe("Return names, state, and call counts without argument payloads (default: true)")
      .optional()
      .default(true),
    maxOutputChars: maxOutputCharsSchema,
  }),
  z.object({ operation: z.literal("mark"), userConfirmedRisk: userConfirmedRiskSchema }),
  z.object({
    operation: z.literal("profile"),
    userConfirmedRisk: userConfirmedRiskSchema,
    direction: z.enum(["Incoming", "Outgoing", "Both"]).optional().default("Both"),
    nameFilter: z.string().optional(),
    sinceCursor: z.string().optional(),
    limit: z.number().optional().default(20),
    maxCallsPerRemote: z.number().optional().default(20),
    maxOutputChars: maxOutputCharsSchema,
  }),
  z.object({ operation: z.literal("clear"), userConfirmedRisk: userConfirmedRiskSchema }),
  z.object({ operation: z.literal("status") }),
  z.object({
    operation: z.enum(["block", "unblock", "ignore", "unignore"]),
    userConfirmedRisk: userConfirmedRiskSchema,
    remoteName: z.string().describe("Exact remote name; use operation=list to discover candidates first").optional(),
    remoteDebugId: z.string().describe("Preferred stable DebugId from operation=list; disambiguates duplicate remote names.").optional(),
    direction: directionSchema.describe("Direction of the captured remote"),
  }),
]);

export default function register(server: McpServer): void {
  server.registerTool(
    "remote-spy",
    {
      title: "Inspect and control Cobalt remote spy",
      description:
        "RISK-AWARE Cobalt remote spy. operation=status is safe and does NOT load Cobalt. Before any other operation, ask the user for confirmation because starting/using Cobalt may install executor hooks that could be detectable; then set userConfirmedRisk=true. If the user already approved Cobalt for the current workflow, reuse that approval for follow-ups. Use operation=list before changing a remote. block/unblock prevents or permits matching calls; ignore/unignore only changes whether matching calls are logged. State changes accept an exact remoteName or the preferred remoteDebugId; list.nameFilter is a case-insensitive substring filter. Start with summaryOnly=true and small limits, then request arguments only for a narrowed remote.",
      inputSchema,
    },
    async (input) => {
      const maxOutputChars = input.operation === "list" || input.operation === "profile" ? input.maxOutputChars : undefined;
      return sendAndWait({
        type: "remote-spy",
        data: input,
        maxOutputChars,
        stampClient: true,
        truncationHint:
          "Rerun remote-spy list with summaryOnly=true, a nameFilter, a lower limit, or fewer calls per remote.",
        failureMessage: (response) =>
          "Failed to use remote spy: " + describeResponse(response),
      });
    }
  );
}
