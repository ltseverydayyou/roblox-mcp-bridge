#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { boot } from "./bridge/boot.js";
import { registerAllTools } from "./tools/index.js";
import { installServerLogCapture } from "./http/server-logs.js";
import { startAutomaticUpdateChecks } from "./update/checker.js";
import { SERVER_VERSION } from "./version.js";

// Install log capture early so all console.error calls are buffered.
installServerLogCapture();

// Import config for CLI arg parsing and startup logging.
import { SERVER_NAME } from "./config.js";

const server = new McpServer(
  {
    name: SERVER_NAME,
    version: SERVER_VERSION,
    description:
      "Expose MCP tools for inspecting, executing Luau in, and interacting with connected Roblox game clients. Dashboard: http://localhost:16384/.",
  },
  {
    instructions: [
      "Roblox executor MCP server. Recommended workflow to keep results small and accurate:",
      "1. If multiple clients may be connected, call list-clients then set-active-client before anything else.",
      "ChatGPT sandbox files: /mnt/data paths are not visible to the MCP host. Read the file in ChatGPT and call execute-file with its complete source plus optional filePath/fileName. For files physically on the MCP host, call execute-file with filePath only.",
      "2. Explore structure cheaply first: get-descendants-tree (summaryOnly) or search-instances with a tight selector and low limit; widen only when needed.",
      "3. Use inspect-instances to batch-read properties, attributes, tags, and immediate children after narrowing candidate paths.",
      "4. Find code with script-grep (exact identifiers/regex) or semantic-search-scripts (behavior); then read just the relevant range with get-script-content (use startLine/endLine).",
      "5. Use get-data-by-code only for small, targeted value probes — prefer the specialized inspection tools above, and have the returned code return compact values, never whole instances or large tables.",
      "6. After execute / execute-file, verify effects with a small get-console-output (low limit) or a targeted get-data-by-code probe.",
      "7. Keep tool outputs lean: prefer summaryOnly, filters, and low limits; only raise maxOutputChars when a single result truly needs it. Large/raw outputs degrade reasoning quality.",
      "8. For remote spying, use remote-spy with operation=list first. Start with summaryOnly=true and a low limit; narrow by name before requesting call arguments or changing block/ignore state.",
    ].join("\n"),
  }
);

registerAllTools(server);

const transport = new StdioServerTransport();
server.connect(transport);
console.error(`[MCP] Server v${SERVER_VERSION} started via stdio (PID ${process.pid}).`);

void boot();
startAutomaticUpdateChecks();
