import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { describeResponse, sendAndWait } from "../../factory.js";
import { maxOutputCharsSchema } from "../../schemas.js";

const STRUCTURE_ROOTS = [
  "game.Workspace",
  "game.ReplicatedStorage",
  "game.ReplicatedFirst",
  "game.Players.LocalPlayer.PlayerScripts",
  "game.Players.LocalPlayer.PlayerGui",
  "game.Players.LocalPlayer.Backpack",
  "game.StarterPlayer",
];

const REMOTE_ROOTS = [
  "game.ReplicatedStorage",
  "game.Workspace",
  "game.ReplicatedFirst",
  "game.Players.LocalPlayer.PlayerScripts",
  "game.Players.LocalPlayer.PlayerGui",
  "game.Players.LocalPlayer.Backpack",
];

const INTERACTION_ROOTS = [
  "game.Workspace",
  "game.ReplicatedStorage",
  "game.Players.LocalPlayer.PlayerGui",
  "game.Players.LocalPlayer.Backpack",
];

const rootsSchema = z
  .array(
    z
      .string()
      .min(1)
      .max(300)
      .regex(/^game(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/, "Use a dot-separated Roblox path such as game.Workspace.Rooms.")
  )
  .max(12)
  .optional()
  .describe("Optional Roblox instance paths to scan. Omit to use high-value client-visible roots.");

const scanLimitsSchema = {
  limit: z.number().int().min(1).max(250).optional().default(40),
  maxNodes: z
    .number()
    .int()
    .min(100)
    .max(20000)
    .optional()
    .default(5000)
    .describe("Maximum instances to visit across all roots before stopping."),
  includeAttributes: z.boolean().optional().default(true),
  includeTags: z.boolean().optional().default(true),
  maxOutputChars: maxOutputCharsSchema,
};

function luauString(value: string): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")}"`;
}

function luauArray(values: readonly string[]): string {
  return `{${values.map(luauString).join(",")}}`;
}

function boundedRoots(roots: string[] | undefined, fallback: readonly string[]): string[] {
  return roots && roots.length > 0 ? roots.slice(0, 12) : [...fallback];
}

function commonProbePrelude(roots: readonly string[]): string {
  return `
local roots = ${luauArray(roots)}
local CollectionService = game:GetService("CollectionService")
local function resolve(path)
    local current = game
    local first = true
    for segment in string.gmatch(path, "[^%.]+") do
        if first then
            first = false
            if segment ~= "game" then return nil, "root path must begin with game" end
        else
            local ok, value = pcall(function() return current[segment] end)
            if not ok or typeof(value) ~= "Instance" then
                value = current:FindFirstChild(segment)
            end
            if typeof(value) ~= "Instance" then return nil, "segment not found: " .. segment end
            current = value
        end
    end
    return current
end
local function debugId(instance)
    local ok, value = pcall(instance.GetDebugId, instance)
    return ok and tostring(value) or nil
end
local function fullName(instance)
    local ok, value = pcall(instance.GetFullName, instance)
    return ok and tostring(value) or instance.Name
end
local function simple(value)
    local kind = typeof(value)
    if kind == "nil" or kind == "string" or kind == "number" or kind == "boolean" then return value end
    if kind == "Instance" then
        return { ClassName = value.ClassName, Name = value.Name, Path = fullName(value), DebugId = debugId(value) }
    end
    return tostring(value)
end
local function attributes(instance)
    local output = {}
    local ok, values = pcall(instance.GetAttributes, instance)
    if not ok or typeof(values) ~= "table" then return output end
    for key, value in pairs(values) do output[tostring(key)] = simple(value) end
    return output
end
local function tags(instance)
    local ok, values = pcall(CollectionService.GetTags, CollectionService, instance)
    if not ok or typeof(values) ~= "table" then return {} end
    return values
end
`;
}

function buildStructureProbe(
  roots: readonly string[],
  maxDepth: number,
  maxChildren: number,
  maxNodesPerRoot: number
): string {
  return `${commonProbePrelude(roots)}
local maxDepth = ${maxDepth}
local maxChildren = ${maxChildren}
local maxNodesPerRoot = ${maxNodesPerRoot}
local function describe(instance)
    local children = instance:GetChildren()
    return { Name = instance.Name, ClassName = instance.ClassName, Path = fullName(instance), DebugId = debugId(instance), ChildCount = #children }
end
local function summarize(root)
    local direct = root:GetChildren()
    local listed = {}
    for index, child in ipairs(direct) do
        if index > maxChildren then break end
        listed[#listed + 1] = describe(child)
    end
    local classCounts = {}
    local categories = { Scripts = 0, LocalScripts = 0, ModuleScripts = 0, Remotes = 0, Bindables = 0, Interactions = 0, Models = 0, Parts = 0, GuiObjects = 0, Values = 0, Tools = 0, Sounds = 0 }
    local queue = {}
    for _, child in ipairs(direct) do queue[#queue + 1] = { child, 1 } end
    local head, visited, deepest = 1, 0, 0
    while head <= #queue and visited < maxNodesPerRoot do
        local item = queue[head]
        head += 1
        local instance, depth = item[1], item[2]
        if depth > maxDepth then continue end
        visited += 1
        if depth > deepest then deepest = depth end
        local className = instance.ClassName
        classCounts[className] = (classCounts[className] or 0) + 1
        if instance:IsA("LuaSourceContainer") then categories.Scripts += 1 end
        if instance:IsA("LocalScript") then categories.LocalScripts += 1 end
        if instance:IsA("ModuleScript") then categories.ModuleScripts += 1 end
        if instance:IsA("RemoteEvent") or instance:IsA("RemoteFunction") or className == "UnreliableRemoteEvent" then categories.Remotes += 1 end
        if instance:IsA("BindableEvent") or instance:IsA("BindableFunction") then categories.Bindables += 1 end
        if instance:IsA("ProximityPrompt") or instance:IsA("ClickDetector") or className == "DragDetector" or className == "TouchTransmitter" then categories.Interactions += 1 end
        if instance:IsA("Model") then categories.Models += 1 end
        if instance:IsA("BasePart") then categories.Parts += 1 end
        if instance:IsA("GuiObject") then categories.GuiObjects += 1 end
        if instance:IsA("ValueBase") then categories.Values += 1 end
        if instance:IsA("Tool") then categories.Tools += 1 end
        if instance:IsA("Sound") then categories.Sounds += 1 end
        if depth < maxDepth then
            for _, child in ipairs(instance:GetChildren()) do queue[#queue + 1] = { child, depth + 1 } end
        end
    end
    local ranked = {}
    for className, count in pairs(classCounts) do ranked[#ranked + 1] = { ClassName = className, Count = count } end
    table.sort(ranked, function(a, b) if a.Count == b.Count then return a.ClassName < b.ClassName end return a.Count > b.Count end)
    while #ranked > 10 do table.remove(ranked) end
    return {
        Name = root.Name,
        ClassName = root.ClassName,
        Path = fullName(root),
        DebugId = debugId(root),
        ChildCount = #direct,
        ChildrenLimited = #direct > maxChildren,
        Children = listed,
        Categories = categories,
        TopClasses = ranked,
        VisitedDescendants = visited,
        DepthScanned = deepest,
        ScanTruncated = head <= #queue,
    }
end
local output = {
    Game = { PlaceId = tostring(game.PlaceId), GameId = tostring(game.GameId), PlaceVersion = game.PlaceVersion, JobId = game.JobId },
    Roots = {},
    Errors = {},
}
local player = game:GetService("Players").LocalPlayer
if player then
    output.LocalPlayer = { Name = player.Name, DisplayName = player.DisplayName, UserId = tostring(player.UserId), DebugId = debugId(player) }
    if player.Character then output.LocalPlayer.Character = describe(player.Character) end
end
for _, path in ipairs(roots) do
    local root, err = resolve(path)
    if root then output.Roots[#output.Roots + 1] = summarize(root) else output.Errors[#output.Errors + 1] = { Path = path, Error = err } end
end
if #output.Errors == 0 then output.Errors = nil end
return output`;
}

function buildEndpointProbe(
  roots: readonly string[],
  classes: readonly string[],
  properties: Record<string, readonly string[]>,
  limit: number,
  maxNodes: number,
  includeAttributes: boolean,
  includeTags: boolean
): string {
  const propertyEntries = Object.entries(properties)
    .map(([className, names]) => `[${luauString(className)}]=${luauArray(names)}`)
    .join(",");
  return `${commonProbePrelude(roots)}
local wanted = {}
for _, className in ipairs(${luauArray(classes)}) do wanted[className] = true end
local propertiesByClass = {${propertyEntries}}
local resultLimit = ${limit}
local maxNodes = ${maxNodes}
local includeAttributes = ${includeAttributes ? "true" : "false"}
local includeTags = ${includeTags ? "true" : "false"}
local function readProperties(instance)
    local output = {}
    local names = propertiesByClass[instance.ClassName] or {}
    for _, name in ipairs(names) do
        local ok, value = pcall(function() return instance[name] end)
        if ok then output[name] = simple(value) end
    end
    return output
end
local output = { Results = {}, Roots = {}, Errors = {}, ScannedNodes = 0 }
local seen = setmetatable({}, { __mode = "k" })
for _, path in ipairs(roots) do
    if #output.Results >= resultLimit or output.ScannedNodes >= maxNodes then break end
    local root, err = resolve(path)
    if not root then
        output.Errors[#output.Errors + 1] = { Path = path, Error = err }
        continue
    end
    output.Roots[#output.Roots + 1] = { Path = fullName(root), ClassName = root.ClassName, DebugId = debugId(root) }
    local stack = { root }
    while #stack > 0 and #output.Results < resultLimit and output.ScannedNodes < maxNodes do
        local instance = table.remove(stack)
        if not seen[instance] then
            seen[instance] = true
            output.ScannedNodes += 1
            if wanted[instance.ClassName] then
                local entry = {
                    Name = instance.Name,
                    ClassName = instance.ClassName,
                    Path = fullName(instance),
                    DebugId = debugId(instance),
                    ParentPath = instance.Parent and fullName(instance.Parent) or nil,
                    ParentDebugId = instance.Parent and debugId(instance.Parent) or nil,
                }
                local props = readProperties(instance)
                if next(props) then entry.Properties = props end
                if includeAttributes then
                    local attrs = attributes(instance)
                    if next(attrs) then entry.Attributes = attrs end
                end
                if includeTags then
                    local instanceTags = tags(instance)
                    if #instanceTags > 0 then entry.Tags = instanceTags end
                end
                output.Results[#output.Results + 1] = entry
            end
            for _, child in ipairs(instance:GetChildren()) do stack[#stack + 1] = child end
        end
    end
end
output.Returned = #output.Results
output.ResultLimitHit = #output.Results >= resultLimit
output.NodeLimitHit = output.ScannedNodes >= maxNodes
if #output.Errors == 0 then output.Errors = nil end
return output`;
}

export default function register(server: McpServer): void {
  server.registerTool(
    "get-game-structure",
    {
      title: "Get a compact Roblox game structure snapshot",
      description:
        "Get a bounded, read-only structural overview of high-value client-visible roots. Returns top children, class/category counts, paths, and DebugIds using GetChildren traversal only. Use this early when learning an unfamiliar game before narrower searches.",
      inputSchema: z.object({
        roots: rootsSchema,
        maxDepth: z.number().int().min(0).max(5).optional().default(3),
        maxChildren: z.number().int().min(1).max(40).optional().default(8),
        maxNodesPerRoot: z.number().int().min(50).max(3000).optional().default(300),
        maxOutputChars: maxOutputCharsSchema,
      }),
    },
    async ({ roots, maxDepth, maxChildren, maxNodesPerRoot, maxOutputChars }) =>
      sendAndWait({
        type: "get-data-by-code",
        data: {
          source: buildStructureProbe(
            boundedRoots(roots, STRUCTURE_ROOTS),
            maxDepth,
            maxChildren,
            maxNodesPerRoot
          ),
        },
        maxOutputChars,
        stampClient: true,
        truncationHint: "Rerun with fewer roots or lower maxDepth/maxChildren/maxNodesPerRoot.",
        failureMessage: (response) => "Failed to inspect game structure: " + describeResponse(response),
      })
  );

  server.registerTool(
    "inspect-remotes",
    {
      title: "Inspect static Roblox remotes",
      description:
        "Inventory client-visible RemoteEvent, RemoteFunction, and UnreliableRemoteEvent instances without starting Remote Spy or installing hooks. Returns paths, DebugIds, attributes, and tags for fast script reconnaissance.",
      inputSchema: z.object({ roots: rootsSchema, ...scanLimitsSchema }),
    },
    async ({ roots, limit, maxNodes, includeAttributes, includeTags, maxOutputChars }) =>
      sendAndWait({
        type: "get-data-by-code",
        data: {
          source: buildEndpointProbe(
            boundedRoots(roots, REMOTE_ROOTS),
            ["RemoteEvent", "RemoteFunction", "UnreliableRemoteEvent"],
            {},
            limit,
            maxNodes,
            includeAttributes,
            includeTags
          ),
        },
        maxOutputChars,
        stampClient: true,
        truncationHint: "Rerun with narrower roots or a lower result limit.",
        failureMessage: (response) => "Failed to inspect remotes: " + describeResponse(response),
      })
  );

  server.registerTool(
    "inspect-interactions",
    {
      title: "Inspect Roblox interaction points",
      description:
        "Inventory client-visible ProximityPrompt, ClickDetector, DragDetector, and TouchTransmitter instances without firing anything. Returns paths, DebugIds, useful activation properties, attributes, and tags for doors, pickups, buttons, tools, and world interactions.",
      inputSchema: z.object({ roots: rootsSchema, ...scanLimitsSchema }),
    },
    async ({ roots, limit, maxNodes, includeAttributes, includeTags, maxOutputChars }) =>
      sendAndWait({
        type: "get-data-by-code",
        data: {
          source: buildEndpointProbe(
            boundedRoots(roots, INTERACTION_ROOTS),
            ["ProximityPrompt", "ClickDetector", "DragDetector", "TouchTransmitter"],
            {
              ProximityPrompt: [
                "ActionText",
                "ObjectText",
                "Enabled",
                "HoldDuration",
                "MaxActivationDistance",
                "RequiresLineOfSight",
                "KeyboardKeyCode",
                "GamepadKeyCode",
                "ClickablePrompt",
              ],
              ClickDetector: ["MaxActivationDistance", "CursorIcon"],
              DragDetector: [
                "Enabled",
                "MaxActivationDistance",
                "ResponseStyle",
                "DragStyle",
                "PermissionPolicy",
                "RunLocally",
              ],
            },
            limit,
            maxNodes,
            includeAttributes,
            includeTags
          ),
        },
        maxOutputChars,
        stampClient: true,
        truncationHint: "Rerun with narrower roots or a lower result limit.",
        failureMessage: (response) => "Failed to inspect interactions: " + describeResponse(response),
      })
  );
}
