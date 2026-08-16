import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { describeResponse, sendAndWait } from "../../factory.js";
import { maxOutputCharsSchema, userConfirmedRiskSchema } from "../../schemas.js";

const targetSchema = z.object({
  path: z.string().optional(),
  debugId: z.string().optional(),
  properties: z.array(z.string()).max(50).optional(),
});

function tool(server: McpServer, name: string, title: string, description: string, inputSchema: any, type = name) {
  server.registerTool(name, { title, description, inputSchema }, async (input: any) =>
    sendAndWait({
      type,
      data: input,
      maxOutputChars: input.maxOutputChars,
      stampClient: true,
      truncationHint: `Rerun ${name} with narrower filters or a lower limit.`,
      failureMessage: (response) => `Failed to use ${name}: ${describeResponse(response)}`,
    })
  );
}

export default function register(server: McpServer): void {
  tool(server, "get-executor-capabilities", "Get executor capabilities", "Detect executor APIs so the model can choose compatible inspection techniques instead of guessing.", z.object({ maxOutputChars: maxOutputCharsSchema }));
  tool(server, "create-console-cursor", "Create console cursor", "Mark the current developer-console position. Pass the returned cursor to get-console-output to fetch only newer entries.", z.object({ maxOutputChars: maxOutputCharsSchema }));
  tool(server, "recover-nil-scripts", "Recover nil scripts", "RISKY / EXPLICIT ONLY. Before calling, ask the user for confirmation because this invokes getnilinstances and may also invoke getloadedmodules, getgc(false), getreg/getregistry, debug.getregistry, and bounded debug.getupvalue traversal. It returns the original nil LuaSourceContainers by DebugId; it does NOT clone or reparent them. Never runs at startup or during ordinary inspection.", z.object({ userConfirmedRisk: userConfirmedRiskSchema, maxOutputChars: maxOutputCharsSchema }));
  tool(server, "search-runtime-objects", "Search runtime objects", "RISKY / EXPLICIT ONLY. Before calling, ask the user for confirmation because this invokes getgc. Bounded search returns opaque handles rather than dumping the GC. Do not call merely because it is available.", z.object({
    userConfirmedRisk: userConfirmedRiskSchema,
    objectType: z.enum(["Any", "function", "table"]).optional().default("Any"),
    constantContains: z.string().optional(), sourceContains: z.string().optional(), upvalueName: z.string().optional(),
    key: z.string().optional(), limit: z.number().optional().default(20),
    maxScanned: z.number().optional().default(5000), maxOutputChars: maxOutputCharsSchema,
  }));
  tool(server, "inspect-runtime-object", "Inspect runtime object", "Inspect a runtime handle returned by search-runtime-objects. Table-only inspection is lightweight; inspecting a function can invoke getconstants/getupvalues/getprotos. Before function introspection, ask the user for confirmation and set userConfirmedRisk=true. Reuse an existing confirmation for the same current workflow rather than repeatedly prompting.", z.object({
    handle: z.string(), userConfirmedRisk: z.boolean().optional(), includeConstants: z.boolean().optional().default(true), includeUpvalues: z.boolean().optional().default(true),
    includeProtos: z.boolean().optional().default(false), maxEntries: z.number().optional().default(40), maxOutputChars: maxOutputCharsSchema,
  }));
  tool(server, "inspect-function", "Inspect runtime function", "RISKY function introspection. Before calling, ask the user for confirmation because enabled fields may invoke getconstants/getupvalues/getprotos. Reuse an existing confirmation for the same current workflow rather than repeatedly prompting.", z.object({
    handle: z.string(), userConfirmedRisk: userConfirmedRiskSchema, includeConstants: z.boolean().optional().default(true), includeUpvalues: z.boolean().optional().default(true),
    includeProtos: z.boolean().optional().default(false), maxEntries: z.number().optional().default(40), maxOutputChars: maxOutputCharsSchema,
  }), "inspect-runtime-object");
  tool(server, "inspect-connections", "Inspect signal connections", "operation=list is RISKY because it invokes getconnections; ask the user before listing and set userConfirmedRisk=true. operation=set-state only acts on an already returned handle and does not call getconnections again.", z.discriminatedUnion("operation", [
    z.object({ operation: z.literal("list"), userConfirmedRisk: userConfirmedRiskSchema, path: z.string().optional(), debugId: z.string().optional(), signal: z.string(), limit: z.number().optional().default(20), maxOutputChars: maxOutputCharsSchema }),
    z.object({ operation: z.literal("set-state"), handle: z.string(), enabled: z.boolean(), maxOutputChars: maxOutputCharsSchema }),
  ]));
  tool(server, "inspect-module", "Inspect loaded ModuleScript", "Inspect a ModuleScript by path or DebugId and return its cached export type/keys; values are opt-in and bounded.", z.object({
    path: z.string().optional(), debugId: z.string().optional(), includeValues: z.boolean().optional().default(false),
    maxKeys: z.number().optional().default(50), maxOutputChars: maxOutputCharsSchema,
  }));
  tool(server, "search-loaded-modules", "Search loaded modules", "RISKY / EXPLICIT ONLY. Before calling, ask the user for confirmation because this invokes getloadedmodules().", z.object({
    userConfirmedRisk: userConfirmedRiskSchema,
    filter: z.string().optional(), includeExports: z.boolean().optional().default(false), limit: z.number().optional().default(20), maxOutputChars: maxOutputCharsSchema,
  }), "inspect-loaded-modules");
  tool(server, "inspect-loaded-modules", "Inspect loaded modules", "RISKY / EXPLICIT ONLY. Before calling, ask the user for confirmation because this invokes getloadedmodules().", z.object({
    userConfirmedRisk: userConfirmedRiskSchema,
    filter: z.string().optional(), includeExports: z.boolean().optional().default(false), limit: z.number().optional().default(20), maxOutputChars: maxOutputCharsSchema,
  }));
  tool(server, "inspect-visible-gui", "Inspect visible GUI", "Return visible GuiObjects from PlayerGui/CoreGui with DebugIds, text and screen rectangles for screenshot-to-instance correlation.", z.object({
    textFilter: z.string().optional(), limit: z.number().optional().default(50), maxOutputChars: maxOutputCharsSchema,
  }));
  tool(server, "get-player-state", "Get LocalPlayer state", "Compact LocalPlayer/Character/Humanoid/camera/tool state without arbitrary Luau.", z.object({ maxOutputChars: maxOutputCharsSchema }));
  tool(server, "inspect-animations", "Inspect playing animations", "Inspect playing LocalPlayer AnimationTracks with IDs, priority, timing, weights and animator paths.", z.object({ limit: z.number().optional().default(30), maxOutputChars: maxOutputCharsSchema }));
  tool(server, "inspect-sounds", "Inspect sounds", "Inspect active or all Sound instances with IDs, volume, timing, rolloff and DebugIds.", z.object({ playingOnly: z.boolean().optional().default(true), limit: z.number().optional().default(30), maxOutputChars: maxOutputCharsSchema }));
  tool(server, "get-performance-stats", "Get client performance stats", "Sample client FPS and return bounded memory/network/object-count diagnostics.", z.object({ sampleSeconds: z.number().optional().default(0.5), maxOutputChars: maxOutputCharsSchema }));
  tool(server, "state-observation", "Snapshot or diff client state", "Create a bounded state snapshot/diff. Remote capture is OFF by default. If includeRemotes=true would load Cobalt, first ask the user because Cobalt may install remote-spy hooks, then set userConfirmedRisk=true. Non-remote observation needs no risky confirmation.", z.discriminatedUnion("operation", [
    z.object({ operation: z.enum(["snapshot", "begin"]), userConfirmedRisk: z.boolean().optional(), targets: z.array(targetSchema).max(25).optional(), includePlayer: z.boolean().optional().default(true), includeConsole: z.boolean().optional().default(true), includeRemotes: z.boolean().optional().default(false), includeGui: z.boolean().optional().default(false), includeSounds: z.boolean().optional().default(false), includeAnimations: z.boolean().optional().default(false), maxOutputChars: maxOutputCharsSchema }),
    z.object({ operation: z.enum(["diff", "end"]), userConfirmedRisk: z.boolean().optional(), snapshotId: z.string(), targets: z.array(targetSchema).max(25).optional(), includePlayer: z.boolean().optional(), includeConsole: z.boolean().optional(), includeRemotes: z.boolean().optional(), includeGui: z.boolean().optional(), includeSounds: z.boolean().optional(), includeAnimations: z.boolean().optional(), maxOutputChars: maxOutputCharsSchema }),
    z.object({ operation: z.literal("delete"), snapshotId: z.string(), maxOutputChars: maxOutputCharsSchema }),
  ]));
  tool(server, "observe-action", "Observe an action", "Begin/end an action observation and return deltas. Remote capture is OFF by default. If includeRemotes=true would load Cobalt, ask the user first because Cobalt may install remote-spy hooks, then set userConfirmedRisk=true. GUI/sound/animation/console/player observation remains available without it.", z.discriminatedUnion("operation", [
    z.object({ operation: z.literal("begin"), userConfirmedRisk: z.boolean().optional(), targets: z.array(targetSchema).max(25).optional(), includePlayer: z.boolean().optional().default(true), includeConsole: z.boolean().optional().default(true), includeRemotes: z.boolean().optional().default(false), includeGui: z.boolean().optional().default(true), includeSounds: z.boolean().optional().default(true), includeAnimations: z.boolean().optional().default(true), maxOutputChars: maxOutputCharsSchema }),
    z.object({ operation: z.literal("end"), userConfirmedRisk: z.boolean().optional(), snapshotId: z.string(), targets: z.array(targetSchema).max(25).optional(), includePlayer: z.boolean().optional(), includeConsole: z.boolean().optional(), includeRemotes: z.boolean().optional(), includeGui: z.boolean().optional(), includeSounds: z.boolean().optional(), includeAnimations: z.boolean().optional(), maxOutputChars: maxOutputCharsSchema }),
  ]), "state-observation");

}
