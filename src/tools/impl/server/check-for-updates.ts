import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { checkForUpdates } from "../../../update/checker.js";
import { toolTextResponse } from "../../factory.js";

export default function register(server: McpServer): void {
  server.registerTool(
    "check-for-updates",
    {
      title: "Check Roblox MCP Bridge for updates",
      description:
        "Check whether a newer published Roblox MCP Bridge version is available. This never installs code automatically. When an update is available, report the version and ask the user before suggesting the update command.",
      inputSchema: z.object({
        refresh: z
          .boolean()
          .describe("Bypass the cached result and contact the update manifest now (default: false).")
          .optional()
          .default(false),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ refresh }) => {
      const result = await checkForUpdates(refresh);
      const installNote = result.gitInstall
        ? `Update command: ${result.updateCommand}`
        : `This checkout has no .git directory. Download the latest build from ${result.repositoryUrl}.`;
      return toolTextResponse(
        `${result.message}\nCurrent: ${result.currentVersion}` +
          (result.latestVersion ? `\nPublished: ${result.latestVersion}` : "") +
          `\n${installNote}`
      );
    }
  );
}
