export const DEFAULT_BRIDGE_URL = "localhost:16384";
export const SERVER_PORT = 16384;

export function normalizeBridgeUrl(value) {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");
  if (!trimmed) return DEFAULT_BRIDGE_URL;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (!url.port) url.port = String(SERVER_PORT);
    return `${url.hostname}:${url.port}`;
  } catch {
    return DEFAULT_BRIDGE_URL;
  }
}

export function buildLoaderSnippet(bridgeUrl = DEFAULT_BRIDGE_URL) {
  const normalized = normalizeBridgeUrl(bridgeUrl);
  const loaderAddress = normalized === DEFAULT_BRIDGE_URL ? "127.0.0.1:16384" : normalized;
  return `getgenv().BridgeURL = "${loaderAddress}"

if getgenv().MCP_AutoReconnect then
    return
end

getgenv().MCP_AutoReconnect = true

while getgenv().MCP_AutoReconnect do
    local Success, Source = pcall(function()
        return game:HttpGet("http://" .. getgenv().BridgeURL .. "/script.luau")
    end)

    if not Success or type(Source) ~= "string" or Source == "" then
        task.wait(2)
        continue
    end

    local Bridge = loadstring(Source)

    if not Bridge then
        task.wait(2)
        continue
    end

    getgenv().MCP_Loaded = false

    pcall(Bridge)

    getgenv().MCP_Loaded = false

    task.wait(2)
end`;
}
