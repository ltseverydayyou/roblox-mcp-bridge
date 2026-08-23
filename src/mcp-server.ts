import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { SERVER_NAME } from "./config.js";
import { registerAllTools } from "./tools/index.js";
import { SERVER_VERSION } from "./version.js";

export function createMcpServer(): McpServer {
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
        "CHATGPT FILE ROUTING: For an attached or generated Luau file, call execute-chatgpt-luau with the complete host-injected file object. Never pass a /mnt/data path or bare file_id as file. If ChatGPT cannot inject that object, read the sandbox file and pass its complete text in execute-chatgpt-luau.source with fileName. Never invent LZ4, Base64, or chunked transfer workarounds.",
        "1. If multiple clients may be connected, call list-clients then set-active-client before anything else.",
        "ChatGPT sandbox paths are not visible to the MCP host. For files physically on the MCP host, call execute-file with filePath only.",
        "2. Explore structure cheaply first: get-descendants-tree (summaryOnly) or search-instances with a tight selector and low limit; widen only when needed. Prefer returned DebugIds for exact follow-up targeting.",
        "3. Use inspect-instances to batch-read properties, attributes, tags, and immediate children after narrowing candidates. Use inspect-visible-gui/get-player-state/inspect-animations/inspect-sounds for their specialized domains.",
        "4. Find code with script-grep (exact identifiers/regex) or semantic-search-scripts (behavior); then read just the relevant range with get-script-content (use startLine/endLine).",
        "5. Use get-data-by-code only for small, targeted value probes — prefer the specialized inspection tools above, and have the returned code return compact values, never whole instances or large tables.",
        "6. Before/after behavioral debugging should use observe-action begin/end or state-observation snapshot/diff; this can correlate selected properties, player state, console, remotes, GUI, sounds, and animations.",
        "7. After execute / execute-file, verify effects with create-console-cursor + get-console-output(sinceCursor), observe-action, or a targeted value probe.",
        "8. Call get-executor-capabilities before relying on executor-specific APIs. If the API you need is not in its fixed list, use search-executor-functions with a narrow query (for example websocket, file, crypt, request, drawing) to discover callable paths in getgenv/getfenv/_G without invoking them. Heavy executor enumeration is on-demand only; none of getgc/getnilinstances/getconnections/getloadedmodules/registry scans or Cobalt remote spying run merely because the bridge connected.",
        "9. SAFETY CONFIRMATION: before invoking a tool or executing Luau that will call potentially detectable executor introspection/hooking primitives (including getgc, getnilinstances, getconnections, getloadedmodules, getreg/getregistry/debug registry APIs, getconstants/getupvalues/getprotos, hookfunction/hookmetamethod, or starting Cobalt), ask the user first. Use wording like: 'This step would use potentially detectable executor methods: <methods>. Would you like me to continue?' Only set userConfirmedRisk=true after explicit approval. If the same methods were already approved for the current contiguous workflow, do not repeatedly ask for every follow-up call.",
        "10. Keep tool outputs lean: prefer summaryOnly, filters, cursors, and low limits; only raise maxOutputChars when a single result truly needs it. Large/raw outputs degrade reasoning quality.",
        "11. For remote spying, use remote-spy list first. Use mark + sinceCursor around an action, or profile for argument-shape summaries; narrow by name before requesting payloads or changing block/ignore state.",
        "12. ROBLOX API REFERENCES: before guessing a Roblox class/member, enum, security/thread-safety tag, Luau builtin, Open Cloud endpoint, or API-version change, call get-roblox-api-resources. Prefer official Creator Hub/Luau sources first. Use fetch-roblox-api-reference to read a vetted reference URL directly through MCP; for engine history/diffs, cross-check robloxapi.github.io and MaximumADHD API History/Client Tracker. Prefer narrow class/enum/domain pages over multi-megabyte raw dumps.",
      ].join("\n"),
    }
  );

  registerAllTools(server);
  return server;
}
