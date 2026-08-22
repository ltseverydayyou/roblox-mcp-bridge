#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { boot } from "./bridge/boot.js";
import { installServerLogCapture } from "./http/server-logs.js";
import { createMcpServer } from "./mcp-server.js";
import { startAutomaticUpdateChecks } from "./update/checker.js";
import { SERVER_VERSION } from "./version.js";

// Install log capture early so all console.error calls are buffered.
installServerLogCapture();

const server = createMcpServer();

const transport = new StdioServerTransport();
server.connect(transport);
console.error(`[MCP] Server v${SERVER_VERSION} started via stdio (PID ${process.pid}).`);

void boot();
startAutomaticUpdateChecks();
