--// Variables \\--
if getgenv().MCP_Loaded == true then
    return
end

getgenv().MCP_Loaded = true

local BridgeURL = getgenv().BridgeURL or getgenv().bridgeurl or ... or "localhost:16384"
getgenv().BridgeURL = BridgeURL
getgenv().bridgeurl = BridgeURL

--// Wait for game to load \\--
if not game:IsLoaded() then
    game.Loaded:Wait()
end

--// Services \\--
local SR = loadstring(game:HttpGet("https://raw.githubusercontent.com/ltseverydayyou/ltseverydayyou.github.io/refs/heads/main/ServiceResolver.luau"))()

local RobloxReplicatedStorage: RobloxReplicatedStorage = SR.cs("RobloxReplicatedStorage", cloneref)
local VirtualInputManager: VirtualInputManager = SR.cs("VirtualInputManager", cloneref)
local MarketplaceService: MarketplaceService = SR.cs("MarketplaceService", cloneref)
local CoreGui: CoreGui = SR.cs("CoreGui", cloneref)
local CorePackages: CorePackages = SR.cs("CorePackages", cloneref)
local ScriptContext: ScriptContext = SR.cs("ScriptContext", cloneref)
local HttpService: HttpService = SR.cs("HttpService", cloneref)
local LogService: LogService = SR.cs("LogService", cloneref)
local Players: Players = SR.cs("Players", cloneref)
local CollectionService: CollectionService = SR.cs("CollectionService", cloneref)
local UserInputService: UserInputService = SR.cs("UserInputService", cloneref)
local RunService: RunService = SR.cs("RunService", cloneref)
local Stats: Stats = SR.cs("Stats", cloneref)

--// Executor HTTP compatibility \\--
local ExecutorRequest = request
if typeof(ExecutorRequest) ~= "function" then ExecutorRequest = http_request end
if typeof(ExecutorRequest) ~= "function" then ExecutorRequest = httprequest end
if typeof(ExecutorRequest) ~= "function" and typeof(syn) == "table" then ExecutorRequest = syn.request end
if typeof(ExecutorRequest) ~= "function" and typeof(http) == "table" then ExecutorRequest = http.request end
if typeof(ExecutorRequest) ~= "function" and typeof(fluxus) == "table" then ExecutorRequest = fluxus.request end

local function GetResponseStatus(response)
    if typeof(response) ~= "table" then return nil end
    return tonumber(response.StatusCode or response.Status or response.status_code or response.status)
end

local function GetResponseBody(response)
    if typeof(response) ~= "table" then return nil end
    return response.Body or response.body
end

--// Libraries \\--

local base64_encode
do
    -- Lua 5.1+ base64 v3.0 (c) 2009 by Alex Kloss <alexthkloss@web.de>
    -- licensed under the terms of the LGPL2
    
    -- character table string
    local b='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    
    -- encoding
    base64_encode = base64encode or function(data)
        return ((data:gsub('.', function(x) 
            local r,b='',x:byte()
            for i=8,1,-1 do r=r..(b%2^i-b%2^(i-1)>0 and '1' or '0') end
            return r;
        end)..'0000'):gsub('%d%d%d?%d?%d?%d?', function(x)
            if (#x < 6) then return '' end
            local c=0
            for i=1,6 do c=c+(x:sub(i,i)=='1' and 2^(6-i) or 0) end
            return b:sub(c+1,c+1)
        end)..({ '', '==', '=' })[#data%3+1])
    end
end

--// Functions \\--
local getscriptbytecode = getscriptbytecode or function(_) error("Unable to get script bytecode.") end
local GetScriptHash = type(getscripthash) == "function" and getscripthash or nil
local BuiltInDecompile = type(decompile) == "function" and decompile or nil

local LuaEncode = loadstring(game:HttpGet("https://raw.githubusercontent.com/chadhyatt/LuaEncode/refs/heads/master/src/LuaEncode.lua"))()

--// Bounded serialization: cap depth / entries / string length and render
--// Instances as their path so structured tool responses can't flood the
--// model context with raw dumps before the server-side char limit applies. \\--
local SANITIZE_MAX_DEPTH = 8
local SANITIZE_MAX_ENTRIES = 60
local SANITIZE_MAX_STRING = 500

local function SanitizeForOutput(value, depth, seen)
    depth = depth or 0
    local valueType = typeof(value)

    if valueType == "Instance" then
        local ok, full = pcall(function() return value:GetFullName() end)
        return ok and full or tostring(value)
    elseif valueType == "string" then
        if #value > SANITIZE_MAX_STRING then
            return string.sub(value, 1, SANITIZE_MAX_STRING)
                .. "…(+" .. (#value - SANITIZE_MAX_STRING) .. " chars omitted)"
        end
        return value
    elseif valueType == "number" or valueType == "boolean" or valueType == "nil" then
        return value
    elseif valueType ~= "table" then
        -- functions, userdata, threads, Vector3, CFrame, etc.
        return tostring(value)
    end

    if depth >= SANITIZE_MAX_DEPTH then
        return "<table: max depth reached>"
    end

    seen = seen or {}
    if seen[value] then
        return "<cyclic table>"
    end
    seen[value] = true

    local result = {}
    local count = 0
    local omitted = 0
    for k, v in pairs(value) do
        if count >= SANITIZE_MAX_ENTRIES then
            omitted += 1
            continue
        end
        count += 1
        local key = k
        if typeof(k) ~= "string" and typeof(k) ~= "number" then
            key = tostring(k)
        end
        result[key] = SanitizeForOutput(v, depth + 1, seen)
    end
    if omitted > 0 then
        result["__omitted"] = omitted .. " more entries omitted"
    end

    seen[value] = nil
    return result
end

--// Strip the decompiler banner line (e.g. "-- Decompiled with lua.expert")
--// so it doesn't repeat as noise across every script read/grep/search. \\--
local function StripDecompilerBanner(source)
    if typeof(source) ~= "string" then return source end
    return (string.gsub(source, "^%s*%-%-[^\n]*[Dd]ecompiled[^\n]*\n", "", 1))
end

local InstanceByDebugId = setmetatable({}, { __mode = "v" })
local RuntimeHandles = setmetatable({}, { __mode = "v" })
local RuntimeHandleCounter = 0
local ConnectionHandles = setmetatable({}, { __mode = "v" })
local ConnectionHandleCounter = 0
local ConsoleCursors = {}
local ConsoleCursorCounter = 0
local RemoteSpyCursors = {}
local RemoteSpyCursorCounter = 0
local StateSnapshots = {}
local StateSnapshotCounter = 0

local function SafeFullName(instance)
    local ok, value = pcall(function() return instance:GetFullName() end)
    return ok and value or tostring(instance)
end

local function GetInstanceByDebugId(debugId)
    if typeof(debugId) ~= "string" or debugId == "" then return nil end
    local cached = InstanceByDebugId[debugId]
    if cached then return cached end

    local ok, descendants = pcall(function() return game:GetDescendants() end)
    if ok then
        for _, instance in ipairs(descendants) do
            local idOk, id = pcall(function() return instance:GetDebugId() end)
            if idOk and id == debugId then
                InstanceByDebugId[debugId] = instance
                return instance
            end
        end
    end

    return nil
end

local function ResolveInstanceTarget(data, pathKey, debugIdKey)
    pathKey = pathKey or "path"
    debugIdKey = debugIdKey or "debugId"
    local debugId = data and data[debugIdKey]
    if typeof(debugId) == "string" and debugId ~= "" then
        local instance = GetInstanceByDebugId(debugId)
        assert(instance, "DebugId did not resolve to a live Instance: " .. debugId)
        return instance
    end

    local path = data and data[pathKey]
    assert(typeof(path) == "string" and path ~= "", "Provide either path or debugId.")
    local instance = loadstring("return " .. path)()
    assert(typeof(instance) == "Instance", "Path did not resolve to a valid Instance.")
    InstanceByDebugId[instance:GetDebugId()] = instance
    return instance
end

local function StoreRuntimeHandle(value, prefix)
    RuntimeHandleCounter += 1
    local handle = (prefix or "runtime") .. ":" .. tostring(RuntimeHandleCounter)
    RuntimeHandles[handle] = value
    return handle
end

local function ResolveCallable(name)
    local envs = {}
    if typeof(getgenv) == "function" then
        local ok, env = pcall(getgenv)
        if ok and typeof(env) == "table" then table.insert(envs, env) end
    end
    if typeof(getfenv) == "function" then
        local ok, env = pcall(getfenv, 0)
        if ok and typeof(env) == "table" then table.insert(envs, env) end
    end
    if typeof(_G) == "table" then table.insert(envs, _G) end
    for _, env in ipairs(envs) do
        if typeof(env[name]) == "function" then return env[name] end
    end
    return nil
end

local function GetDebugFunction(name)
    if typeof(debug) == "table" and typeof(debug[name]) == "function" then return debug[name] end
    return ResolveCallable(name)
end

local RiskySourceMethods = {
    "getgc", "getnilinstances", "getconnections", "getloadedmodules", "getreg", "getregistry",
    "hookfunction", "hookmetamethod", "getrawmetatable", "setreadonly", "newcclosure",
    "clonefunction", "replaceclosure", "getscriptclosure", "getconstants", "getupvalues", "getprotos",
}

local function FindRiskyMethodsInSource(source)
    if typeof(source) ~= "string" then return {} end
    local lowered = string.lower(source)
    local found = {}
    for _, method in ipairs(RiskySourceMethods) do
        if string.find(lowered, "%f[%w_]" .. method .. "%s*%(") then
            found[#found + 1] = method
        end
    end
    local debugMethods = { "getregistry", "getupvalue", "getupvalues", "getconstants", "getprotos" }
    for _, method in ipairs(debugMethods) do
        if string.find(lowered, "debug%s*%.%s*" .. method .. "%s*%(") then
            found[#found + 1] = "debug." .. method
        end
    end
    return found
end

local function AssertRiskConfirmed(data, methods)
    if data and data.userConfirmedRisk == true then return end
    local methodText = typeof(methods) == "table" and table.concat(methods, ", ") or tostring(methods)
    error("Risk confirmation required before using potentially detectable executor methods: " .. methodText .. ". Ask the user before continuing.")
end

local RiskyFunctionNames = {}
for _, name in ipairs(RiskySourceMethods) do
    RiskyFunctionNames[string.lower(name)] = true
end
for _, name in ipairs({ "getupvalue", "getregistry" }) do
    RiskyFunctionNames[string.lower(name)] = true
end

local function AppendExecutorPath(base, key)
    local keyType = typeof(key)
    if keyType == "string" then
        if string.match(key, "^[%a_][%w_]*$") then
            return base == "" and key or (base .. "." .. key)
        end
        return base .. "[" .. string.format("%q", key) .. "]"
    elseif keyType == "number" then
        return base .. "[" .. tostring(key) .. "]"
    end
    return base .. "[" .. string.format("%q", tostring(key)) .. "]"
end

local function SearchExecutorFunctions(data)
    data = data or {}

    local query = typeof(data.query) == "string" and string.lower(data.query) or ""
    local limit = math.clamp(tonumber(data.limit) or 100, 1, 500)
    local maxDepth = math.clamp(tonumber(data.maxDepth) or 6, 0, 12)
    local maxTables = math.clamp(tonumber(data.maxTables) or 400, 1, 2000)
    local maxEntriesPerTable = math.clamp(tonumber(data.maxEntriesPerTable) or 250, 1, 1000)
    local includeAliases = data.includeAliases == true

    local roots = {}
    local rootTables = {}

    local function addRoot(source, value)
        if typeof(value) ~= "table" or rootTables[value] then return end
        rootTables[value] = true
        roots[#roots + 1] = { value = value, path = "", depth = 0, source = source }
    end

    if typeof(getgenv) == "function" then
        local ok, env = pcall(getgenv)
        if ok then addRoot("getgenv", env) end
    end
    if typeof(getfenv) == "function" then
        local ok, env = pcall(getfenv, 0)
        if ok then addRoot("getfenv", env) end
    end
    if typeof(_G) == "table" then
        addRoot("_G", _G)
    end

    local visitedTables = {}
    local seenFunctions = {}
    local results = {}
    local queue = {}
    local queueIndex = 1
    local scannedTables = 0
    local scannedEntries = 0
    local matchedPaths = 0
    local uniqueFunctions = 0
    local truncated = false

    for _, root in ipairs(roots) do
        queue[#queue + 1] = root
    end

    while queueIndex <= #queue and scannedTables < maxTables and #results < limit do
        local item = queue[queueIndex]
        queueIndex += 1

        local tbl = item.value
        if visitedTables[tbl] then
            continue
        end
        visitedTables[tbl] = true
        scannedTables += 1

        local key = nil
        local entriesInTable = 0
        while entriesInTable < maxEntriesPerTable and #results < limit do
            local ok, nextKey, value = pcall(next, tbl, key)
            if not ok or nextKey == nil then
                break
            end
            key = nextKey
            entriesInTable += 1
            scannedEntries += 1

            local path = AppendExecutorPath(item.path, nextKey)
            local valueType = typeof(value)

            if valueType == "function" then
                local loweredPath = string.lower(path)
                if query == "" or string.find(loweredPath, query, 1, true) then
                    matchedPaths += 1
                    local firstSeen = not seenFunctions[value]
                    if firstSeen then
                        seenFunctions[value] = true
                        uniqueFunctions += 1
                    end

                    if firstSeen or includeAliases then
                        local leaf = typeof(nextKey) == "string" and string.lower(nextKey)
                            or string.match(loweredPath, "([%w_]+)$")
                            or loweredPath
                        results[#results + 1] = {
                            path = path,
                            source = item.source,
                            alias = not firstSeen,
                            riskConfirmationRequired = RiskyFunctionNames[leaf] == true
                                or string.find(loweredPath, "debug.get", 1, true) ~= nil,
                        }
                    end
                end
            elseif valueType == "table" and item.depth < maxDepth and not visitedTables[value] then
                queue[#queue + 1] = {
                    value = value,
                    path = path,
                    depth = item.depth + 1,
                    source = item.source,
                }
            end

            if scannedEntries % 400 == 0 then
                task.wait()
            end
        end

        if entriesInTable >= maxEntriesPerTable then
            truncated = true
        end
    end

    if queueIndex <= #queue or scannedTables >= maxTables or #results >= limit then
        truncated = true
    end

    table.sort(results, function(a, b)
        return a.path < b.path
    end)

    return {
        query = query ~= "" and data.query or nil,
        resultCount = #results,
        matchedPaths = matchedPaths,
        uniqueFunctions = uniqueFunctions,
        scannedTables = scannedTables,
        scannedEntries = scannedEntries,
        truncated = truncated,
        functions = results,
        hint = truncated and "Narrow query or raise bounded limits if you need more results." or nil,
    }
end

local function StableValue(value)
    local t = typeof(value)
    if t == "Instance" then return SafeFullName(value) end
    if t == "string" or t == "number" or t == "boolean" or t == "nil" then return tostring(value) end
    if t == "table" then
        local ok, encoded = pcall(function() return HttpService:JSONEncode(SanitizeForOutput(value)) end)
        if ok then return encoded end
    end
    return tostring(value)
end

--// Compatibility Check \\--
local WebSocketAvailable = (
    typeof(WebSocket) ~= "nil" and
    typeof(WebSocket.connect) == "function"
) and (getgenv().DisableWebSocket ~= true)

--// Registration Info \\--
local function GenerateSessionGuid()
    local success, guid = pcall(function()
        return HttpService:GenerateGUID(false)
    end)
    if success and type(guid) == "string" and guid ~= "" then
        return guid
    end
    return tostring(os.clock()) .. "-" .. tostring(math.random(1, 1000000000))
end

local function GetClientIdentityKey()
    local player = Players.LocalPlayer
    return table.concat({
        tostring(game.PlaceId or 0),
        tostring(game.JobId or ""),
        tostring(player and player.UserId or 0),
    }, ":")
end

local function GetStableClientSessionId()
    local identityKey = GetClientIdentityKey()
    if type(getgenv().MCP_ClientSessionId) ~= "string" or getgenv().MCP_ClientIdentityKey ~= identityKey then
        getgenv().MCP_ClientSessionId = GenerateSessionGuid()
        getgenv().MCP_ClientIdentityKey = identityKey
    end
    return getgenv().MCP_ClientSessionId
end

local function GetExecutorInfo()
    local executorName = "Unknown"
    local executorVersion = "Unknown"

    if typeof(identifyexecutor) == "function" then
        pcall(function()
            local name, versionValue = identifyexecutor()
            if type(name) == "string" and name ~= "" then
                executorName = name
            end
            if versionValue ~= nil then
                local text = tostring(versionValue)
                if text ~= "" then
                    executorVersion = text
                end
            end
        end)
    elseif typeof(getexecutorname) == "function" then
        pcall(function()
            local name = getexecutorname()
            if type(name) == "string" and name ~= "" then
                executorName = name
            end
        end)
    end

    if executorVersion == "Unknown" and typeof(getexecutorversion) == "function" then
        pcall(function()
            local versionValue = getexecutorversion()
            if versionValue ~= nil then
                local text = tostring(versionValue)
                if text ~= "" then
                    executorVersion = text
                end
            end
        end)
    end

    return executorName, executorVersion
end

local function GetRobloxVersion()
    local robloxVersion = "Unknown"
    if typeof(version) == "function" then
        pcall(function()
            local value = version()
            if type(value) == "string" and value ~= "" then
                robloxVersion = value
            end
        end)
    end
    return robloxVersion
end

local function GetPlatformName()
    local platform = "Unknown"
    pcall(function()
        local value = UserInputService:GetPlatform()
        local text = tostring(value)
        platform = string.gsub(text, "^Enum%.Platform%.", "")
    end)
    return platform
end

local function GetRegistrationInfo()
    local player = Players.LocalPlayer
    local placeName = "Unknown"
    pcall(function()
        local productInfo = MarketplaceService:GetProductInfo(game.PlaceId)
        placeName = productInfo.Name
    end)

    local executorName, executorVersion = GetExecutorInfo()

    return {
        type = "register",
        username = player and player.Name or "Unknown",
        userId = player and player.UserId or 0,
        displayName = player and player.DisplayName or "Unknown",
        placeId = game.PlaceId,
        gameId = game.GameId,
        jobId = game.JobId,
        placeName = placeName,
        executorName = executorName,
        executorVersion = executorVersion,
        robloxVersion = GetRobloxVersion(),
        platform = GetPlatformName(),
        sessionId = GetStableClientSessionId(),
    }
end

--// Base Bridge Class \\--
local BaseBridge = {}; do
    BaseBridge.__index = BaseBridge
    
    function BaseBridge:BindToType(type, callback)
        self.Callbacks[type] = callback
    end

    function BaseBridge:BindToTypeRaw(type, callback)
        self.Callbacks[type] = callback
        self.RawCallbacks = self.RawCallbacks or {}
        self.RawCallbacks[type] = true
    end

    function BaseBridge:CreateAlias(type, aliases)
        for _, alias in aliases do
            self.Callbacks[alias] = self.Callbacks[type]
            if self.RawCallbacks and self.RawCallbacks[type] then
                self.RawCallbacks[alias] = true
            end
        end
    end

    function BaseBridge:HandleMessage(data)
        if self.Callbacks[data.type] then
            local success, result = pcall(function()
                return self.Callbacks[data.type](data)
            end)

            if success and result == nil then
                return nil
            end

            if not success then
                return self:FormatResponse(result, data.id, true)
            end

            if self.RawCallbacks and self.RawCallbacks[data.type] then
                return {
                    output = tostring(result),
                    success = true,
                    id = data.id
                }
            end

            return self:FormatResponse(result, data.id, false)
        end
        return nil
    end
    
    function BaseBridge:FormatResponse(message, id, isError)
        if isError then
            return {
                error = tostring(message),
                success = false,
                id = id
            }
        end
        
        local output = SanitizeForOutput(message)
        if typeof(output) ~= "table" then
            output = { output }
        end
    
        return {
            output = LuaEncode(output, {
                Prettify = false
            }),
            success = true,
            id = id
        }
    end
    
    function BaseBridge:IsAlive()
        local success, result = pcall(function()
            local response
            local thread = task.spawn(function()
                local success, data = pcall(ExecutorRequest, {
                    Url = "http://" .. BridgeURL,
                    Method = "GET"
                })

                if success then
                    response = data
                end
            end)

            local start = os.clock()
            repeat task.wait(0.05) until response ~= nil or os.clock() - start > 5

            if response == nil then
                task.cancel(thread)
                return false
            end
    
            -- 426 = Upgrade Required (WebSocket), 200 = HTTP mode
            local status = GetResponseStatus(response)
            if status == 426 or status == 200 then
                return true
            end
    
            return false
        end)
    
        if not success then
            return false
        end
    
        return result
    end
end

--// WebSocket Bridge \\--
local WebSocketBridge = setmetatable({}, {__index = BaseBridge}); do
    WebSocketBridge.__index = WebSocketBridge
    
    function WebSocketBridge.new()
        local self = setmetatable({}, WebSocketBridge)
    
        --// Yield until the server is alive with exponential backoff \\--
        local retryDelay = 0.5
        local maxRetryDelay = 5
        local maxAttempts = 10
        local attempts = 0
        
        while not self:IsAlive() do
            attempts += 1
            if attempts >= maxAttempts then
                error("Failed to connect to bridge server after " .. maxAttempts .. " attempts")
            end
            task.wait(retryDelay)
            retryDelay = math.min(retryDelay * 1.5, maxRetryDelay)
        end
    
        --// Connect to the server with timeout \\--
        local wsConnection = nil
        local connectionThread = task.spawn(function()
            local success, result = pcall(function()
                return WebSocket.connect("ws://" .. BridgeURL)
            end)
            if success then
                wsConnection = result
            end
        end)
        
        local connectionStart = os.clock()
        repeat task.wait(0.05) until wsConnection ~= nil or os.clock() - connectionStart > 5
        
        if wsConnection == nil then
            task.cancel(connectionThread)
            error("WebSocket connection timed out after 5 seconds")
        end
        
        self.WebSocket = wsConnection
        self.Connected = true
        self.Callbacks = {}
        self.ClientId = nil

        --// Send registration \\--
        self.WebSocket:Send(HttpService:JSONEncode(GetRegistrationInfo()))

        self.AliveThread = task.spawn(function()
            local consecutiveFailures = 0
            while task.wait(1) do
                if not self.Connected then
                    continue
                end

                if self:IsAlive() then
                    consecutiveFailures = 0
                    continue
                end

                consecutiveFailures += 1
                if consecutiveFailures < 3 then
                    continue
                end
                
                self.Connected = false
                break
            end
    
            pcall(function()
                self.WebSocket:Close()
            end)
        end)
    
        --// On Message \\--
        self.WebSocket.OnMessage:Connect(function(message)
            local data = HttpService:JSONDecode(message)

            --// Handle registration response \\--
            if data.type == "registered" then
                self.ClientId = data.clientId
                return
            end

            local response = self:HandleMessage(data)
            if response then
                self.WebSocket:Send(HttpService:JSONEncode(response))
            end
        end)
    
        --// On Close \\--
        self.WebSocket.OnClose:Connect(function()
            self.Connected = false
        end)
    
        return self
    end
    
    function WebSocketBridge:WaitForDisconnect()
        while self.Connected do
            task.wait(0.1)
        end
    end
end

--// HTTP Polling Bridge \\--
local HTTPBridge = setmetatable({}, {__index = BaseBridge}); do
    HTTPBridge.__index = HTTPBridge
    
    function HTTPBridge.new()
        local self = setmetatable({}, HTTPBridge)
    
        --// Yield until the server is alive with exponential backoff \\--
        local retryDelay = 0.5
        local maxRetryDelay = 5
        local maxAttempts = 10
        local attempts = 0
        
        while not self:IsAlive() do
            attempts += 1
            if attempts >= maxAttempts then
                error("Failed to connect to bridge server after " .. maxAttempts .. " attempts")
            end
            task.wait(retryDelay)
            retryDelay = math.min(retryDelay * 1.5, maxRetryDelay)
        end
    
        self.Connected = true
        self.Callbacks = {}
        self.PollInterval = 0.1
        self.ClientId = nil

        --// Register with the server \\--
        local registered, registrationError = pcall(function()
            local regResponse = ExecutorRequest({
                Url = "http://" .. BridgeURL .. "/register",
                Method = "POST",
                Headers = { ["Content-Type"] = "application/json" },
                Body = HttpService:JSONEncode(GetRegistrationInfo()),
            })
            local status = GetResponseStatus(regResponse)
            local body = GetResponseBody(regResponse)
            if status ~= 200 then
                error("bridge returned HTTP " .. tostring(status or "unknown"))
            end
            if type(body) ~= "string" or body == "" then
                error("bridge returned no registration body")
            end
            local regData = HttpService:JSONDecode(body)
            if type(regData.clientId) ~= "string" or regData.clientId == "" then
                error("bridge returned no clientId")
            end
            self.ClientId = regData.clientId
        end)
        if not registered then
            error("HTTP bridge registration failed: " .. tostring(registrationError))
        end
    
        --// Start polling thread \\--
        self.PollThread = task.spawn(function()
            local consecutiveFailures = 0
            
            while self.Connected do
                local gotCommands = false
                local success, _ = pcall(function()
                    local pollUrl = "http://" .. BridgeURL .. "/poll"
                    if self.ClientId then
                        pollUrl = pollUrl .. "?clientId=" .. self.ClientId
                    end
                    local response = ExecutorRequest({
                        Url = pollUrl,
                        Method = "GET"
                    })

                    --// Server might be down \\--
                    local status = GetResponseStatus(response)
                    if status ~= 204 and status ~= 200 then
                        consecutiveFailures += 1
                        if consecutiveFailures >= 3 then
                            self.Connected = false
                        end

                        return
                    end
                    
                    consecutiveFailures = 0
    
                    --// Handle response \\--
                    local responseBody = GetResponseBody(response)
                    if responseBody and responseBody ~= "" then
                        local data = HttpService:JSONDecode(responseBody)
                        local commands = {}
                        if typeof(data) == "table" and data.type == nil and #data > 0 then
                            commands = data
                        elseif typeof(data) == "table" and data.type ~= nil then
                            commands = { data }
                        end

                        for _, command in ipairs(commands) do
                            gotCommands = true
                            task.spawn(function()
                                local result = self:HandleMessage(command)
                                if result == nil then return end

                                --// Send response back \\--
                                ExecutorRequest({
                                    Url = "http://" .. BridgeURL .. "/respond",
                                    Method = "POST",
                                    Headers = {
                                        ["Content-Type"] = "application/json"
                                    },
                                    Body = HttpService:JSONEncode(result)
                                })
                            end)
                        end
                    end
                end)
    
                if not success then
                    consecutiveFailures += 1
                    if consecutiveFailures >= 3 then
                        self.Connected = false
                    end
                end
    
                if not gotCommands then
                    task.wait(self.PollInterval)
                end
            end
        end)
    
        return self
    end
    
    function HTTPBridge:WaitForDisconnect()
        while self.Connected do
            task.wait(0.1)
        end
    end
end

--// Create Bridge \\--
local function CreateBridge()
    if typeof(ExecutorRequest) ~= "function" then
        error("Executor HTTP request API unavailable; expected request, http_request, httprequest, syn.request, or http.request")
    end

    if WebSocketAvailable then
        local success, bridge = pcall(function()
            return WebSocketBridge.new()
        end)
        
        if success then
            return bridge
        end
    end

    return HTTPBridge.new()
end

--// Ratelimiter \\--

local Ratelimiter = {}
do
    type RatelimiterOptions = {
        Burst: {
            Time: number,
            Max: number
        },
    
        PeriodicInterval: number?,
        MainCallback: ((...any) -> ...any),
    }

    Ratelimiter.__index = Ratelimiter

    Ratelimiter.new = function(options: RatelimiterOptions)
        local self = setmetatable(options, Ratelimiter)
        self.Bucket = {}
        self.Queue = {}

        self.IsDestroyed = false
        self.ManagerThread = nil
        self.PeriodicThread = nil

        self:SetupManagerThread()

        return self
    end

    Ratelimiter.QueueOperation = function(self, ...: any)
        if self.IsDestroyed then return end
        table.insert(self.Queue, table.pack(...))
    end

    Ratelimiter.SetupManagerThread = function(self)
        if self.IsDestroyed then return end

        self.Bucket = {}
        self.Queue = {}

        if self.ManagerThread then
            task.cancel(self.ManagerThread)
            self.ManagerThread = nil
        end

        if self.PeriodicThread then
            task.cancel(self.PeriodicThread)
            self.PeriodicThread = nil
        end

        self.ManagerThread = task.spawn(function()
            while not self.IsDestroyed do
                local currentTime = tick()

                --// Clean bucket (efficient rebuild instead of O(n) removal) \\--
                if #self.Bucket > 0 then
                    local newBucket = {}
                    for _, time in self.Bucket do
                        if currentTime - time < self.Burst.Time then
                            table.insert(newBucket, time)
                        end
                    end

                    self.Bucket = newBucket
                end

                --// Process queue \\--
                while #self.Bucket < self.Burst.Max and #self.Queue > 0 do
                    local taskData = table.remove(self.Queue, 1)
                    if taskData then
                        table.insert(self.Bucket, tick())

                        task.defer(function()
                            if self.IsDestroyed then return end
                            self.MainCallback(table.unpack(taskData, 1, taskData.n))
                        end)
                    end
                end

                task.wait()
            end
        end)

        if not self.PeriodicInterval then return end
        self.PeriodicThread = task.spawn(function()
            while not self.IsDestroyed do
                self:QueueOperation()

                task.wait(self.PeriodicInterval)
            end
        end)
    end

    Ratelimiter.Destroy = function(self)
        if self.IsDestroyed then return end
        self.IsDestroyed = true

        if self.ManagerThread then
            task.cancel(self.ManagerThread)
            self.ManagerThread = nil
        end

        if self.PeriodicThread then
            task.cancel(self.PeriodicThread)
            self.PeriodicThread = nil
        end

        table.clear(self.Bucket)
        table.clear(self.Queue)
    end

    Ratelimiter.Stop = Ratelimiter.Destroy
end

--// Script Source Mapping \\--
local MappedScriptIds = {}
local QueuedScriptIds = {}
local ScriptInstanceMap = setmetatable({}, { __mode = "v" })
local SourcesToMap, SourcesProcessed, MappedSources = 0, 0, 0
local HasStartedMapping = false
local ScriptMappingFinished = false
local ScriptSourceUploadClientId = nil
local MappedSourceLimiter
local ScriptDescendantAddedConnection = nil
local UploadQueue = {}
local UploadQueueDebugIds = {}
local UploadQueueThread = nil
local UploadBatchMax = 8
local UploadFlushInterval = 0.5
local UploadMaxAttempts = 3
local SourceCacheLookupBatchMax = 64
local ScriptHashTimeoutSeconds = 2
local BytecodeTimeoutSeconds = 3
local BuiltInDecompileTimeoutSeconds = 8
local ServerDecompileTimeoutSeconds = 65
local MarkScriptProcessed
local ActiveBridge = nil
local ScriptSourceCacheByHash = {}
local ScriptHashByDebugId = {}
local ScriptMappingRetryCountByDebugId = {}
local ScriptMappingRetryScheduledByDebugId = {}
local MaxImmediateScriptMappingRetries = 3
local ReconcileScriptHierarchyMetadata
local QueueScriptForMapping

local function IsScriptMappingTransportReady(clientId)
    return (
        ActiveBridge ~= nil and
        ActiveBridge.Connected == true and
        ActiveBridge.ClientId ~= nil and
        ActiveBridge.ClientId == clientId
    )
end

local function UploadScriptSourceBatch(clientId, scripts, hasFinishedMapping)
    if not clientId then return false end
    if not IsScriptMappingTransportReady(clientId) then return false end

    local ok, response = pcall(ExecutorRequest, {
        Url = "http://" .. BridgeURL .. "/script-sources",
        Method = "POST",
        Headers = {
            ["Content-Type"] = "application/json"
        },
        Body = HttpService:JSONEncode({
            clientId = clientId,
            scripts = scripts or {},
            hasFinishedMapping = hasFinishedMapping,
            sourcesToMap = SourcesToMap,
            processedSources = SourcesProcessed,
            skippedSources = math.max(0, SourcesProcessed - MappedSources),
        })
    })

    return ok and response and GetResponseStatus(response) == 200
end

local function PublishScriptMappingStatus(hasFinishedMapping)
    if hasFinishedMapping ~= nil then
        ScriptMappingFinished = hasFinishedMapping
    end

    return UploadScriptSourceBatch(ScriptSourceUploadClientId, {}, ScriptMappingFinished)
end

local function StartUploadQueue()
    if UploadQueueThread then return end

    UploadQueueThread = task.spawn(function()
        while true do
            if #UploadQueue == 0 or not IsScriptMappingTransportReady(ScriptSourceUploadClientId) then
                task.wait(UploadFlushInterval)
                continue
            end

            local batch = {}
            local uploadedItems = {}
            while #UploadQueue > 0 and #batch < UploadBatchMax do
                local item = table.remove(UploadQueue, 1)
                table.insert(batch, item)
                table.insert(uploadedItems, item)
                UploadQueueDebugIds[item.debugId] = nil
            end

            local uploaded = UploadScriptSourceBatch(ScriptSourceUploadClientId, batch, false)
            if uploaded then
                for _, item in uploadedItems do
                    MarkScriptProcessed(item.debugId, item.sourceAvailable ~= false)
                end
            else
                for idx = #batch, 1, -1 do
                    local item = batch[idx]
                    item.attempts = (item.attempts or 0) + 1
                    if item.attempts >= UploadMaxAttempts then
                        MarkScriptProcessed(item.debugId, false)
                    else
                        UploadQueueDebugIds[item.debugId] = item.debugId
                        table.insert(UploadQueue, 1, item)
                    end
                end
                task.wait(1)
            end

            task.wait()
        end
    end)
end

local function RunWithTimeout(timeoutSeconds, callback)
    local completed = false
    local success = false
    local result = nil

    local worker = task.spawn(function()
        success, result = pcall(callback)
        completed = true
    end)

    local deadline = os.clock() + timeoutSeconds
    while not completed and os.clock() < deadline do
        task.wait(0.05)
    end

    if not completed then
        pcall(task.cancel, worker)
        return false, "Timed out after " .. tostring(timeoutSeconds) .. "s."
    end

    if not success then
        return false, result
    end

    return true, result
end

local function RememberScriptSourceForHash(scriptHash, source)
    if type(scriptHash) ~= "string" or scriptHash == "" then return false end
    if type(source) ~= "string" or source == "" then return false end

    ScriptSourceCacheByHash[scriptHash] = source
    return true
end

local function ReadScriptHash(script)
    if type(GetScriptHash) ~= "function" then return nil end

    local success, result = RunWithTimeout(ScriptHashTimeoutSeconds, function()
        return GetScriptHash(script)
    end)

    if not success or type(result) ~= "string" or result == "" then
        return nil
    end

    return result
end

local function GetScriptHashForInstance(script)
    local debugId = script:GetDebugId()
    if ScriptHashByDebugId[debugId] ~= nil then
        return ScriptHashByDebugId[debugId] or nil
    end

    local scriptHash = ReadScriptHash(script)
    ScriptHashByDebugId[debugId] = scriptHash or false
    return scriptHash
end

local function FetchCachedScriptSourceBatch(clientId, hashesToFetch)
    if #hashesToFetch == 0 then return end

    local ok, response = pcall(ExecutorRequest, {
        Url = "http://" .. BridgeURL .. "/script-source-cache",
        Method = "POST",
        Headers = {
            ["Content-Type"] = "application/json",
            ["Accept"] = "application/json",
        },
        Body = HttpService:JSONEncode({
            clientId = clientId,
            hashes = hashesToFetch,
        }),
    })

    local responseBody = GetResponseBody(response)
    if not ok or type(response) ~= "table" or GetResponseStatus(response) ~= 200 or type(responseBody) ~= "string" then
        return
    end

    local decodedOk, decoded = pcall(function()
        return HttpService:JSONDecode(responseBody)
    end)
    if not decodedOk or type(decoded) ~= "table" or type(decoded.sources) ~= "table" then
        return
    end

    for _, item in ipairs(decoded.sources) do
        if type(item) == "table" then
            RememberScriptSourceForHash(item.scriptHash, item.source)
        end
    end
end

local function FetchCachedScriptSources(clientId, scriptHashes)
    if type(ExecutorRequest) ~= "function" then return end
    if type(clientId) ~= "string" or clientId == "" then return end
    if type(scriptHashes) ~= "table" then return end

    local hashesToFetch = {}
    local seen = {}
    local function flush()
        FetchCachedScriptSourceBatch(clientId, hashesToFetch)
        table.clear(hashesToFetch)
    end

    for _, scriptHash in ipairs(scriptHashes) do
        if type(scriptHash) == "string" and scriptHash ~= "" and not ScriptSourceCacheByHash[scriptHash] and not seen[scriptHash] then
            seen[scriptHash] = true
            table.insert(hashesToFetch, scriptHash)
            if #hashesToFetch >= SourceCacheLookupBatchMax then
                flush()
            end
        end
    end

    flush()
end

local function ReadScriptBytecode(script)
    local success, bytecode = RunWithTimeout(BytecodeTimeoutSeconds, function()
        return getscriptbytecode(script)
    end)
    if not success or bytecode == nil then
        return false, bytecode or "Failed to read script bytecode."
    end
    return true, bytecode
end

local function TryBuiltInDecompile(script)
    if type(BuiltInDecompile) ~= "function" then return nil end

    local startedAt = os.clock()
    local success, source = RunWithTimeout(BuiltInDecompileTimeoutSeconds, function()
        return BuiltInDecompile(script)
    end)
    local latencyMs = math.floor((os.clock() - startedAt) * 1000)
    if not success or type(source) ~= "string" or source == "" then
        return nil
    end

    return StripDecompilerBanner(source), latencyMs
end

local function RequestServerDecompile(bytecode, options)
    if type(ExecutorRequest) ~= "function" then
        return nil, "executor HTTP request function is unavailable"
    end

    options = if type(options) == "table" then options else {}
    local body = {
        clientId = ScriptSourceUploadClientId,
        bytecode = base64_encode(bytecode),
        builtinAvailable = type(BuiltInDecompile) == "function",
    }
    if type(options.builtinSource) == "string" then
        body.builtinSource = options.builtinSource
    end
    if type(options.builtinLatencyMs) == "number" then
        body.builtinLatencyMs = options.builtinLatencyMs
    end
    if type(options.requestedProvider) == "string" then
        body.requestedProvider = options.requestedProvider
    end
    if type(options.disabledProviders) == "table" then
        body.disabledProviders = options.disabledProviders
    end

    local success, response = RunWithTimeout(ServerDecompileTimeoutSeconds, function()
        return ExecutorRequest({
            Url = "http://" .. BridgeURL .. "/decompile",
            Method = "POST",
            Headers = {
                ["Content-Type"] = "application/json",
                ["Accept"] = "application/json",
            },
            Body = HttpService:JSONEncode(body),
        })
    end)
    if not success then
        return nil, tostring(response)
    end

    local responseBody = GetResponseBody(response)
    if type(response) ~= "table" or type(responseBody) ~= "string" then
        return nil, "Decompile server returned no response body."
    end

    local decodedOk, decoded = pcall(function()
        return HttpService:JSONDecode(responseBody)
    end)
    if not decodedOk or type(decoded) ~= "table" then
        return nil, "Decompile server returned invalid JSON."
    end

    if decoded.ok == true and type(decoded.source) == "string" and decoded.source ~= "" then
        return StripDecompilerBanner(decoded.source)
    end
    if decoded.needsBuiltin == true and decoded.providerId == "builtin" then
        return nil, nil, true
    end

    if type(decoded.error) == "string" and decoded.error ~= "" then
        return nil, decoded.error
    end
    if type(decoded.attempts) == "table" then
        return nil, table.concat(decoded.attempts, "\n\n")
    end

    return nil, "Decompile server failed without a detailed error."
end

local function PrepareScriptForMapping(script, fetchCache)
    local debugId = script:GetDebugId()
    local scriptHash = GetScriptHashForInstance(script)
    if fetchCache and scriptHash then
        FetchCachedScriptSources(ScriptSourceUploadClientId, { scriptHash })
    end

    local cachedSource = scriptHash and ScriptSourceCacheByHash[scriptHash] or nil
    if cachedSource then
        return {
            debugId = debugId,
            scriptHash = scriptHash,
            source = cachedSource,
        }
    end

    local okBytecode, bytecodeOrError = ReadScriptBytecode(script)
    if not okBytecode then
        return nil, bytecodeOrError
    end

    return {
        debugId = debugId,
        scriptHash = scriptHash,
        bytecode = bytecodeOrError,
    }
end

local function DecompileScriptSource(script, prepared)
    local prepareError
    if not prepared then
        prepared, prepareError = PrepareScriptForMapping(script, true)
    end
    if not prepared then
        local builtinSource = TryBuiltInDecompile(script)
        if builtinSource then
            return builtinSource, nil, GetScriptHashForInstance(script)
        end
        return nil, prepareError or "Failed to prepare script for decompile."
    end

    if type(prepared.source) == "string" and prepared.source ~= "" then
        return prepared.source, nil, prepared.scriptHash
    end
    if type(prepared.bytecode) ~= "string" then
        return nil, "Prepared script is missing bytecode.", prepared.scriptHash
    end

    local source, errorMessage, needsBuiltin = RequestServerDecompile(prepared.bytecode)
    if not source then
        local builtinSource, builtinLatencyMs = TryBuiltInDecompile(script)
        if builtinSource then
            local normalizedSource = RequestServerDecompile(prepared.bytecode, {
                requestedProvider = "builtin",
                builtinSource = builtinSource,
                builtinLatencyMs = builtinLatencyMs,
            })
            source = normalizedSource or builtinSource
            errorMessage = nil
        elseif needsBuiltin then
            source, errorMessage = RequestServerDecompile(prepared.bytecode, {
                disabledProviders = { "builtin" },
            })
        end
    end
    if not source then
        return nil, errorMessage, prepared.scriptHash
    end

    if prepared.scriptHash then
        RememberScriptSourceForHash(prepared.scriptHash, source)
    end
    return source, nil, prepared.scriptHash
end

MarkScriptProcessed = function(debugId, uploaded)
    if MappedScriptIds[debugId] then return end

    QueuedScriptIds[debugId] = nil
    SourcesProcessed += 1

    if uploaded then
        MappedScriptIds[debugId] = true
        ScriptMappingRetryCountByDebugId[debugId] = nil
        ScriptMappingRetryScheduledByDebugId[debugId] = nil
        MappedSources += 1
    else
        local retryCount = (ScriptMappingRetryCountByDebugId[debugId] or 0) + 1
        ScriptMappingRetryCountByDebugId[debugId] = retryCount

        if retryCount <= MaxImmediateScriptMappingRetries and not ScriptMappingRetryScheduledByDebugId[debugId] then
            ScriptMappingRetryScheduledByDebugId[debugId] = true
            local retryDelay = math.min(8, 2 ^ (retryCount - 1))
            task.delay(retryDelay, function()
                ScriptMappingRetryScheduledByDebugId[debugId] = nil
                if MappedScriptIds[debugId] or QueuedScriptIds[debugId] then return end
                if not IsScriptMappingTransportReady(ScriptSourceUploadClientId) then return end

                local script = ScriptInstanceMap[debugId]
                if not script then return end

                local ok, isScript = pcall(function()
                    return script:IsA("LuaSourceContainer")
                end)
                if not ok or not isScript then return end

                QueueScriptForMapping(script)
            end)
        end
    end

    if SourcesProcessed >= SourcesToMap then
        PublishScriptMappingStatus(true)
        if ReconcileScriptHierarchyMetadata then
            task.delay(0.5, ReconcileScriptHierarchyMetadata, ScriptSourceUploadClientId)
        end
    end
end

local function MapScriptSource(script, prepared)
    local debugId = script:GetDebugId()
    if MappedScriptIds[debugId] then return end
    if not IsScriptMappingTransportReady(ScriptSourceUploadClientId) then return end

    local source, sourceError, scriptHash = DecompileScriptSource(script, prepared)

    ScriptInstanceMap[debugId] = script
    script.Destroying:Once(function()
        ScriptInstanceMap[debugId] = nil
    end)

    if UploadQueueDebugIds[debugId] then return end
    UploadQueueDebugIds[debugId] = debugId
    table.insert(UploadQueue, {
        debugId = debugId,
        path = script:GetFullName(),
        className = script.ClassName,
        source = source or "",
        sourceAvailable = source ~= nil,
        sourceError = source and nil or tostring(sourceError or "Source could not be decompiled."),
        scriptHash = scriptHash,
        attempts = 0,
    })
end

MappedSourceLimiter = Ratelimiter.new({
    Burst = {
        Time = 0.5,
        Max = 4,
    },

    MainCallback = MapScriptSource
})
MappedSourceLimiter:SetupManagerThread()

local function GetScriptByDebugId(debugId)
    local CachedInstance = ScriptInstanceMap[debugId]
    if CachedInstance then
        return CachedInstance
    end

    local CachedByDebugId = InstanceByDebugId[debugId]
    if CachedByDebugId then
        local ok, isScript = pcall(function() return CachedByDebugId:IsA("LuaSourceContainer") end)
        if ok and isScript then
            ScriptInstanceMap[debugId] = CachedByDebugId
            return CachedByDebugId
        end
    end

    for _, script in game:QueryDescendants("LuaSourceContainer") do
        if script:IsA("Script") and script.RunContext == Enum.RunContext.Server then continue end
        if script:GetDebugId() ~= debugId then continue end
        
        ScriptInstanceMap[debugId] = script
        return script
    end

    return nil
end

local function IsCandidateScriptForMapping(script)
    local IsRobloxScript = (
        script.RobloxLocked or
        script:IsDescendantOf(CoreGui) or
        script:IsDescendantOf(CorePackages) or
        script:IsDescendantOf(ScriptContext)
    )
    if IsRobloxScript then return false end

    local IsServerScript = (
        script:IsA("Script") and (
            script.RunContext == Enum.RunContext.Server or
            script.RunContext == Enum.RunContext.Legacy
        )
    )
    if IsServerScript then return false end

    local debugId = script:GetDebugId()
    local IsAlreadyMapped = MappedScriptIds[debugId]
    if IsAlreadyMapped then return false end

    local IsAlreadyQueued = QueuedScriptIds[debugId]
    if IsAlreadyQueued then return false end

    if ScriptMappingRetryScheduledByDebugId[debugId] then return false end
    if (ScriptMappingRetryCountByDebugId[debugId] or 0) > MaxImmediateScriptMappingRetries then return false end

    return true
end

local function IsVisibleScriptForHierarchy(script)
    return not (
        script.RobloxLocked or
        script:IsDescendantOf(CoreGui) or
        script:IsDescendantOf(CorePackages) or
        script:IsDescendantOf(ScriptContext)
    )
end

local function ScriptMetadataEntry(script, sourceError)
    return {
        debugId = script:GetDebugId(),
        path = script:GetFullName(),
        className = script.ClassName,
        sourceAvailable = false,
        sourceError = sourceError or "Source mapping pending.",
    }
end

local function UploadScriptMetadata(clientId, scripts)
    local function uploadWithRetry(batch)
        for attempt = 1, UploadMaxAttempts do
            if UploadScriptSourceBatch(clientId, batch, false) then
                return true
            end
            if attempt < UploadMaxAttempts then
                task.wait(0.25 * attempt)
            end
        end
        return false
    end

    local batch = {}
    for _, script in scripts do
        local sourceError = IsCandidateScriptForMapping(script)
            and "Source mapping pending."
            or "Source is unavailable in the current client context."
        table.insert(batch, ScriptMetadataEntry(script, sourceError))
        if #batch >= 64 then
            uploadWithRetry(batch)
            table.clear(batch)
        end
    end
    if #batch > 0 then uploadWithRetry(batch) end
end

ReconcileScriptHierarchyMetadata = function(clientId)
    if not IsScriptMappingTransportReady(clientId) then return end

    local visibleScripts = {}
    for _, script in game:QueryDescendants("LuaSourceContainer") do
        if script:IsA("LuaSourceContainer") and IsVisibleScriptForHierarchy(script) then
            table.insert(visibleScripts, script)
        end
    end

    UploadScriptMetadata(clientId, visibleScripts)

    for _, script in visibleScripts do
        if IsCandidateScriptForMapping(script) then
            QueueScriptForMapping(script)
        end
    end

    PublishScriptMappingStatus(ScriptMappingFinished)
end

QueueScriptForMapping = function(script, prepared)
    if not IsScriptMappingTransportReady(ScriptSourceUploadClientId) then return end

    local debugId = script:GetDebugId()
    if MappedScriptIds[debugId] or QueuedScriptIds[debugId] then return end

    QueuedScriptIds[debugId] = true
    SourcesToMap += 1
    ScriptMappingFinished = false
    PublishScriptMappingStatus(false)
    MappedSourceLimiter:QueueOperation(script, prepared)
end

local function StartScriptMapping(clientId)
    if HasStartedMapping then return end
    if not IsScriptMappingTransportReady(clientId) then return end

    HasStartedMapping = true
    ScriptSourceUploadClientId = clientId

    ScriptDescendantAddedConnection = game.DescendantAdded:Connect(function(script)
        if not script:IsA("LuaSourceContainer") then
            return
        end

        if not IsVisibleScriptForHierarchy(script) then return end
        UploadScriptSourceBatch(clientId, { ScriptMetadataEntry(script) }, false)
        if not IsCandidateScriptForMapping(script) then return end
        QueueScriptForMapping(script)
    end)

    local CategoriesToMap = {
        game:QueryDescendants("LuaSourceContainer"),
    }

    --// Map script sources \\--
    task.spawn(function()
        if not IsScriptMappingTransportReady(clientId) then return end

        local VisibleScripts = {}
        local CandidateScripts = {}
        for _, category in CategoriesToMap do
            for _, script in category do
                if not script:IsA("LuaSourceContainer") then continue end
                if not IsVisibleScriptForHierarchy(script) then continue end
                table.insert(VisibleScripts, script)
                if not IsCandidateScriptForMapping(script) then continue end

                table.insert(CandidateScripts, script)
            end
        end

        UploadScriptMetadata(clientId, VisibleScripts)

        for _, script in ipairs(CandidateScripts) do
            QueuedScriptIds[script:GetDebugId()] = true
        end

        SourcesToMap += #CandidateScripts
        PublishScriptMappingStatus(false)

        for idx, script in CandidateScripts do
            task.defer(MappedSourceLimiter.QueueOperation, MappedSourceLimiter, script)
            if idx % 250 == 0 then task.wait(0.1) end
        end

        if SourcesToMap == 0 then
            PublishScriptMappingStatus(true)
        end
    end)
end

local function ResetScriptMappingState(clientId)
    MappedScriptIds = {}
    QueuedScriptIds = {}
    SourcesToMap = 0
    SourcesProcessed = 0
    MappedSources = 0
    HasStartedMapping = false
    ScriptMappingFinished = false
    ScriptSourceUploadClientId = clientId
    ScriptHashByDebugId = {}
    ScriptMappingRetryCountByDebugId = {}
    ScriptMappingRetryScheduledByDebugId = {}

    if ScriptDescendantAddedConnection then
        ScriptDescendantAddedConnection:Disconnect()
        ScriptDescendantAddedConnection = nil
    end

    if MappedSourceLimiter then
        MappedSourceLimiter:SetupManagerThread()
    end

    table.clear(UploadQueue)
    table.clear(UploadQueueDebugIds)
end

local function WaitForBridgeClientId(Bridge)
    local deadline = os.clock() + 5
    repeat
        if Bridge.ClientId then
            return Bridge.ClientId
        end
        if not Bridge.Connected then
            return nil
        end
        task.wait(0.05)
    until os.clock() > deadline

    return nil
end

--// Main Loop \\--
while true do
    local success, Bridge = pcall(CreateBridge)
    
    if not success then
        task.wait(3)
        continue
    end

    local clientId = WaitForBridgeClientId(Bridge)
    if clientId then
        ActiveBridge = Bridge
        StartUploadQueue()

        if ScriptSourceUploadClientId ~= clientId then
            ResetScriptMappingState(clientId)
        end

        if not getgenv().DisableInitialScriptDecompMapping then
            StartScriptMapping(clientId)
        else
            HasStartedMapping = true
            ScriptSourceUploadClientId = clientId
            PublishScriptMappingStatus(true)
        end
    end

    Bridge:BindToType("execute", function(data)
        local riskyMethods = FindRiskyMethodsInSource(data.source)
        if #riskyMethods > 0 then AssertRiskConfirmed(data, riskyMethods) end
        task.defer(function()
            setthreadidentity(8)
            loadstring(data.source)()
        end)
    end)

    Bridge:BindToTypeRaw("get-console-output", function(data)
        local limit = math.max(1, math.min(tonumber(data.limit) or 20, 200))
        local logsOrder = data.logsOrder or "NewestFirst"
        local filter = data.filter
        local hasFilter = typeof(filter) == "string" and filter ~= ""
        local summaryOnly = data.summaryOnly == true

        local logs = LogService:GetLogHistory()
        local cursorIndex = 0
        local cursorTimestamp = nil
        if typeof(data.sinceCursor) == "string" then
            local cursor = ConsoleCursors[data.sinceCursor]
            assert(cursor, "Unknown console cursor: " .. data.sinceCursor)
            if typeof(cursor) == "table" then
                cursorIndex = tonumber(cursor.index) or 0
                cursorTimestamp = tonumber(cursor.timestamp)
            else
                cursorIndex = tonumber(cursor) or 0
            end
        end
        local results = {}
        local matchedCount = 0
        local countsByLevel = {}

        local function matchesFilter(logEntry)
            if not hasFilter then return true end
            return string.find(logEntry.message, filter, 1, true) ~= nil
        end

        local MAX_LOG_MESSAGE_CHARS = 500
        local function formatLogMessage(message)
            local output = tostring(message or "")
            if #output > MAX_LOG_MESSAGE_CHARS then
                output = string.sub(output, 1, MAX_LOG_MESSAGE_CHARS)
                    .. "…(+" .. (#output - MAX_LOG_MESSAGE_CHARS) .. " chars omitted)"
            end
            return output
        end

        if logsOrder == "NewestFirst" then
            for i = #logs, 1, -1 do
                local logEntry = logs[i]
                local entryTimestamp = tonumber(logEntry.timestamp)
                if cursorTimestamp then
                    if entryTimestamp and entryTimestamp <= cursorTimestamp then continue end
                elseif i <= cursorIndex then
                    continue
                end
                if not matchesFilter(logEntry) then continue end
                
                matchedCount += 1
                local levelName = logEntry.messageType and logEntry.messageType.Name or "Unknown"
                countsByLevel[levelName] = (countsByLevel[levelName] or 0) + 1
                if #results < limit then
                    table.insert(results, logEntry)
                end
            end
        else
            for i, logEntry in ipairs(logs) do
                local entryTimestamp = tonumber(logEntry.timestamp)
                if cursorTimestamp then
                    if entryTimestamp and entryTimestamp <= cursorTimestamp then continue end
                elseif i <= cursorIndex then
                    continue
                end
                if not matchesFilter(logEntry) then continue end
                
                matchedCount += 1
                local levelName = logEntry.messageType and logEntry.messageType.Name or "Unknown"
                countsByLevel[levelName] = (countsByLevel[levelName] or 0) + 1
                if #results < limit then
                    table.insert(results, logEntry)
                end
            end
        end

        local outputLines = {}
        if summaryOnly then
            table.insert(outputLines, string.format("Matched %d logs.", matchedCount))
            for levelName, count in countsByLevel do
                table.insert(outputLines, string.format("%s: %d", levelName, count))
            end
            return table.concat(outputLines, "\n")
        end

        table.insert(outputLines, string.format("Displaying %d/%d logs:", #results, matchedCount))

        for _, logEntry in results do
            table.insert(outputLines, string.format(
                "[%s t=%s] %s",
                logEntry.messageType.Name, tostring(logEntry.timestamp),
                formatLogMessage(logEntry.message)
            ))
        end

        return table.concat(outputLines, "\n")
    end)

    Bridge:BindToType("get-data-by-code", function(data)
        local riskyMethods = FindRiskyMethodsInSource(data.source)
        if #riskyMethods > 0 then AssertRiskConfirmed(data, riskyMethods) end
        setthreadidentity(8)
        local dataOutput = table.pack(loadstring(data.source)())

        return dataOutput
    end)

    Bridge:BindToTypeRaw("get-script-content", function(data)
        local source
        local scriptInstance

        --// Handle GC'd script proxies: debugId is passed directly, skip loadstring \\--
        if data.debugId then
            scriptInstance = GetScriptByDebugId(data.debugId)
            assert(scriptInstance, "No live script instance found for ScriptProxy with DebugId: " .. tostring(data.debugId))
        else
            setthreadidentity(8)
            scriptInstance = loadstring(data.source)()

            assert(typeof(scriptInstance) == "Instance", "Script instance is not an instance.")
            assert(scriptInstance:IsA("LuaSourceContainer"), "Script instance is not a LuaSourceContainer (Script, LocalScript, or ModuleScript).")
            assert(not (scriptInstance:IsA("Script") and scriptInstance.RunContext == Enum.RunContext.Server), "Script instance is a Server Script.")
        end

        local scriptHash
        source, _, scriptHash = DecompileScriptSource(scriptInstance)
        assert(source, "Failed to decompile script.")

        local debugId = scriptInstance:GetDebugId()
        if ScriptSourceUploadClientId and not MappedScriptIds[debugId] then
            local uploaded = UploadScriptSourceBatch(ScriptSourceUploadClientId, {
                {
                    debugId = debugId,
                    path = scriptInstance:GetFullName(),
                    source = source,
                    scriptHash = scriptHash,
                }
            }, ScriptMappingFinished)

            if uploaded then
                MappedScriptIds[debugId] = true
            end
        end

        --// Line range support with bounded default preview \\--
        local lines = {}
        local pos = 1
        local len = #source
        while pos <= len do
            local newlinePos = source:find("\n", pos, true)
            if newlinePos then
                table.insert(lines, source:sub(pos, newlinePos - 1))
                pos = newlinePos + 1
            else
                table.insert(lines, source:sub(pos))
                break
            end
        end

        local totalLines = #lines
        local maxLines = math.max(1, math.min(tonumber(data.maxLines) or 200, 2000))
        local startLine = data.startLine and math.max(1, math.min(data.startLine, totalLines)) or 1
        local requestedEndLine = data.endLine and math.max(startLine, math.min(data.endLine, totalLines)) or totalLines
        local endLine = math.min(requestedEndLine, startLine + maxLines - 1)

        local sliced = {}
        for i = startLine, endLine do
            table.insert(sliced, lines[i])
        end

        local footer = ""
        if endLine < requestedEndLine then
            footer = "\n-- Output truncated to " .. maxLines .. " lines. Rerun with startLine=" .. (endLine + 1) .. " or a tighter range to continue."
        end

        return "-- Lines " .. startLine .. "-" .. endLine .. " of " .. totalLines .. "\n" .. table.concat(sliced, "\n") .. footer
    end)

    Bridge:BindToType("search-instances", function(data)
        local rootInstance
        if typeof(data.rootDebugId) == "string" and data.rootDebugId ~= "" then
            rootInstance = GetInstanceByDebugId(data.rootDebugId)
            assert(rootInstance, "rootDebugId did not resolve to a live Instance.")
        else
            rootInstance = loadstring("return " .. (data.root or "game"))()
        end
        local instances = rootInstance:QueryDescendants(data.selector)
        
        local limit = math.max(1, math.min(tonumber(data.limit) or 20, 100))
        local results = {}
        
        for i, instance in instances do
            if i > limit then break end

            local fullName = instance.Name
            pcall(function() fullName = instance:GetFullName() end)

            local debugId = instance:GetDebugId()
            InstanceByDebugId[debugId] = instance
            table.insert(results, {
                Name = instance.Name,
                ClassName = instance.ClassName,
                Path = fullName,
                DebugId = debugId
            })
        end
        
        return {
            count = #instances,
            limited = #instances > limit,
            results = results
        }
    end)

    Bridge:BindToType("inspect-instances", function(data)
        local targets = data.targets
        if typeof(targets) ~= "table" or #targets == 0 then
            targets = {}
            local paths = data.paths
            if typeof(paths) == "table" then
                for _, path in ipairs(paths) do table.insert(targets, { path = path }) end
            end
        end
        assert(#targets > 0, "targets/paths must contain at least one instance target.")

        local maxPaths = math.min(#targets, 25)
        local maxChildren = math.max(0, math.min(tonumber(data.maxChildren) or 20, 100))
        local includeAttributes = data.includeAttributes ~= false
        local includeTags = data.includeTags ~= false
        local includeChildren = data.includeChildren ~= false
        local requestedProperties = data.properties

        local function AddUnique(target, seen, values)
            for _, propertyName in ipairs(values) do
                if not seen[propertyName] then
                    seen[propertyName] = true
                    table.insert(target, propertyName)
                end
            end
        end

        local function GetDefaultProperties(instance)
            local properties = {}
            local seen = {}
            AddUnique(properties, seen, { "Archivable" })

            if instance:IsA("BasePart") then
                AddUnique(properties, seen, {
                    "Anchored", "CanCollide", "CanQuery", "CanTouch", "CastShadow",
                    "CFrame", "Position", "Size", "Color", "Material", "Transparency",
                    "AssemblyLinearVelocity", "AssemblyAngularVelocity",
                })
            end
            if instance:IsA("Model") then
                AddUnique(properties, seen, { "PrimaryPart", "WorldPivot" })
            end
            if instance:IsA("GuiObject") then
                AddUnique(properties, seen, {
                    "Visible", "Active", "Position", "Size", "AnchorPoint", "ZIndex",
                    "BackgroundColor3", "BackgroundTransparency",
                })
            end
            if instance:IsA("TextLabel") or instance:IsA("TextButton") or instance:IsA("TextBox") then
                AddUnique(properties, seen, { "Text", "TextColor3", "TextSize", "TextTransparency" })
            end
            if instance:IsA("ValueBase") then
                AddUnique(properties, seen, { "Value" })
            end
            if instance:IsA("Humanoid") then
                AddUnique(properties, seen, {
                    "Health", "MaxHealth", "WalkSpeed", "JumpPower", "AutoRotate", "RigType",
                    "MoveDirection", "FloorMaterial",
                })
            end
            if instance:IsA("BaseScript") then
                AddUnique(properties, seen, { "Enabled", "RunContext" })
            end
            if instance:IsA("Sound") then
                AddUnique(properties, seen, { "SoundId", "Volume", "PlaybackSpeed", "Playing", "TimePosition" })
            end
            if instance:IsA("Animation") then
                AddUnique(properties, seen, { "AnimationId" })
            end
            if instance:IsA("Decal") or instance:IsA("Texture") then
                AddUnique(properties, seen, { "Texture", "Color3", "Transparency" })
            end
            if instance:IsA("MeshPart") then
                AddUnique(properties, seen, { "MeshId", "TextureID" })
            end
            if instance:IsA("ProximityPrompt") then
                AddUnique(properties, seen, {
                    "ActionText", "ObjectText", "Enabled", "HoldDuration",
                    "KeyboardKeyCode", "MaxActivationDistance", "RequiresLineOfSight",
                })
            end

            return properties
        end

        local function ReadProperties(instance, propertyNames)
            local values = {}
            local unreadable = {}

            for index, propertyName in ipairs(propertyNames) do
                if index > 50 then break end
                if typeof(propertyName) ~= "string" or propertyName == "" then continue end

                local ok, value = pcall(function()
                    return instance[propertyName]
                end)
                if ok then
                    values[propertyName] = value
                else
                    table.insert(unreadable, propertyName)
                end
            end

            return values, unreadable
        end

        local results = {}
        for index = 1, maxPaths do
            local target = targets[index]
            local ok, result = pcall(function()
                if typeof(target) == "string" then target = { path = target } end
                assert(typeof(target) == "table", "Instance target must be a path string or {path/debugId} object.")
                local instance = ResolveInstanceTarget(target)

                local propertyNames = requestedProperties
                if typeof(propertyNames) ~= "table" or #propertyNames == 0 then
                    propertyNames = GetDefaultProperties(instance)
                end
                local properties, unreadableProperties = ReadProperties(instance, propertyNames)

                local children = nil
                local childCount = #instance:GetChildren()
                if includeChildren then
                    children = {}
                    for childIndex, child in ipairs(instance:GetChildren()) do
                        if childIndex > maxChildren then break end
                        local childDebugId = child:GetDebugId()
                        InstanceByDebugId[childDebugId] = child
                        table.insert(children, {
                            Name = child.Name,
                            ClassName = child.ClassName,
                            Path = child:GetFullName(),
                            DebugId = childDebugId,
                            ChildCount = #child:GetChildren(),
                        })
                    end
                end

                return {
                    Name = instance.Name,
                    ClassName = instance.ClassName,
                    Path = instance:GetFullName(),
                    DebugId = instance:GetDebugId(),
                    Parent = instance.Parent,
                    ChildCount = childCount,
                    ChildrenLimited = includeChildren and childCount > maxChildren or false,
                    Properties = properties,
                    UnreadableProperties = #unreadableProperties > 0 and unreadableProperties or nil,
                    Attributes = includeAttributes and instance:GetAttributes() or nil,
                    Tags = includeTags and CollectionService:GetTags(instance) or nil,
                    Children = children,
                }
            end)

            if ok then
                table.insert(results, result)
            else
                table.insert(results, {
                    RequestedTarget = SanitizeForOutput(target),
                    Error = tostring(result),
                })
            end
        end

        return {
            count = #results,
            results = results,
        }
    end)

    Bridge:BindToType("get-game-info", function(data)
        local productInfo = MarketplaceService:GetProductInfo(game.PlaceId)

        local info = {
            -- IDs are strings so JSON/Lua encoders never render them in
            -- scientific notation or lose integer precision downstream.
            PlaceId = tostring(game.PlaceId),
            GameId = tostring(game.GameId),
            PlaceVersion = game.PlaceVersion,
            PlaceName = productInfo.Name,
            Creator = productInfo.Creator.Name,
            CreatorType = tostring(productInfo.Creator.CreatorType),
            CreatorId = tostring(productInfo.Creator.CreatorTargetId),
            JobId = game.JobId,
            ServerType = RobloxReplicatedStorage.GetServerType:InvokeServer()
        }

        -- The marketplace description can be multi-kB of marketing text that is
        -- pure noise for debugging, so omit it unless explicitly requested.
        if data.includeDescription == true then
            info.PlaceDescription = productInfo.Description
        end

        return info
    end)

    Bridge:BindToType("get-descendants-tree", function(data)
        local rootInstance
        if typeof(data.rootDebugId) == "string" and data.rootDebugId ~= "" then
            rootInstance = GetInstanceByDebugId(data.rootDebugId)
        else
            rootInstance = loadstring("return " .. (data.root or "game"))()
        end
        assert(typeof(rootInstance) == "Instance", "Root path/DebugId did not resolve to a valid Instance.")

        local maxDepth = math.max(0, math.min(tonumber(data.maxDepth) or 2, 5))
        local maxChildren = math.max(1, math.min(tonumber(data.maxChildren) or 20, 30))
        local classFilter = data.classFilter or ""
        local hasFilter = classFilter ~= ""
        local summaryOnly = data.summaryOnly == true
        local MAX_TREE_NODES = 300
        local nodeBudget = MAX_TREE_NODES
        local budgetHit = false

        if summaryOnly then
            local classCounts = {}
            local visited = 0
            local matched = 0

            local function walk(instance, depth)
                if depth > maxDepth then
                    return
                end

                for _, child in instance:GetChildren() do
                    visited += 1
                    if not hasFilter or child:IsA(classFilter) then
                        matched += 1
                        classCounts[child.ClassName] = (classCounts[child.ClassName] or 0) + 1
                    end
                    if depth < maxDepth then
                        walk(child, depth + 1)
                    end
                end
            end

            walk(rootInstance, 1)

            return {
                Root = {
                    Name = rootInstance.Name,
                    ClassName = rootInstance.ClassName,
                    DebugId = rootInstance:GetDebugId(),
                    ChildCount = #rootInstance:GetChildren(),
                },
                MaxDepth = maxDepth,
                ClassFilter = if hasFilter then classFilter else nil,
                VisitedDescendants = visited,
                MatchedDescendants = matched,
                ClassCounts = classCounts,
            }
        end

        local function buildTree(instance, depth)
            if depth > maxDepth then
                return nil
            end

            local children = instance:GetChildren()
            local childNodes = {}
            local shown = 0
            local total = #children

            for _, child in children do
                if shown >= maxChildren then break end
                if nodeBudget <= 0 then
                    budgetHit = true
                    break
                end

                if hasFilter and not child:IsA(classFilter) then
                    -- Even if this child doesn't match, check if any descendant might
                    -- Only skip if we're at max depth anyway
                    if depth < maxDepth then
                        local subtree = buildTree(child, depth + 1)
                        if subtree and subtree.Children and #subtree.Children > 0 then
                            table.insert(childNodes, subtree)
                            shown += 1
                        end
                    end
                    continue
                end

                nodeBudget -= 1

                local childDebugId = child:GetDebugId()
                InstanceByDebugId[childDebugId] = child
                local node = {
                    Name = child.Name,
                    ClassName = child.ClassName,
                    DebugId = childDebugId,
                    ChildCount = #child:GetChildren()
                }

                if depth < maxDepth and node.ChildCount > 0 then
                    local subtree = buildTree(child, depth + 1)
                    if subtree then
                        node.Children = subtree.Children
                    end
                end

                table.insert(childNodes, node)
                shown += 1
            end

            local instanceDebugId = instance:GetDebugId()
            InstanceByDebugId[instanceDebugId] = instance
            return {
                Name = instance.Name,
                ClassName = instance.ClassName,
                DebugId = instanceDebugId,
                ChildCount = total,
                TruncatedAt = if shown < total then shown else nil,
                Children = childNodes
            }
        end

        local tree = buildTree(rootInstance, 0)
        if budgetHit and typeof(tree) == "table" then
            tree.Note = "Output capped at " .. MAX_TREE_NODES .. " nodes. Narrow with classFilter, lower maxDepth, or summaryOnly=true."
        end
        return tree
    end)

    Bridge:BindToType("ensure-remote-spy", function(data)
        AssertRiskConfirmed(data, { "Cobalt remote-spy hooks" })
        if getgenv().Cobalt then
            return {
                status = "already_loaded",
                message = "Cobalt remote spy is already running."
            }
        end

        -- Load Cobalt
        local success, err = pcall(function()
            loadstring(game:HttpGet("https://gitlab.com/upio/cobalt/-/releases/permalink/latest/downloads/Cobalt.luau"))()
        end)

        if not success then
            error("Failed to load Cobalt: " .. tostring(err))
        end

        -- Wait for Cobalt to initialize
        local waitStart = os.clock()
        while not getgenv().Cobalt and os.clock() - waitStart < 10 do
            task.wait(0.1)
        end

        assert(getgenv().Cobalt, "Cobalt loaded but failed to initialize within 10 seconds.")
        
        return {
            status = "loaded",
            message = "Cobalt remote spy loaded successfully."
        }
    end)

    Bridge:BindToType("get-remote-spy-logs", function(data)
        local Cobalt = getgenv().Cobalt
        assert(Cobalt and Cobalt.shared and Cobalt.shared.Logs, "Cobalt remote spy is not loaded. Call ensure-remote-spy first.")

        local direction = data.direction or "Both"
        local nameFilter = data.remoteNameFilter or ""
        local limit = math.max(1, math.min(tonumber(data.limit) or 10, 100))
        local maxCallsPerRemote = math.max(0, math.min(tonumber(data.maxCallsPerRemote) or 2, 20))
        local summaryOnly = data.summaryOnly == true
        local hasNameFilter = nameFilter ~= ""
        local cursor = nil
        if typeof(data.sinceCursor) == "string" then
            cursor = RemoteSpyCursors[data.sinceCursor]
            assert(cursor, "Unknown remote-spy cursor: " .. data.sinceCursor)
        end

        local function ProcessLogs(logTable, directionLabel)
            local results = {}

            for instance, log in logTable do
                if typeof(instance) ~= "Instance" then continue end

                local remoteName = ""
                local remoteClass = ""
                pcall(function()
                    remoteName = instance.Name
                    remoteClass = instance.ClassName
                end)

                -- Apply name filter
                if hasNameFilter and not string.find(string.lower(remoteName), string.lower(nameFilter), 1, true) then
                    continue
                end

                -- Get recent calls (raw — LuaEncode handles serialization)
                local recentCalls = {}
                local totalCalls = #log.Calls
                local debugId = instance:GetDebugId()
                local cursorKey = directionLabel .. ":" .. debugId
                local previousCalls = cursor and (cursor[cursorKey] or 0) or 0
                local newCalls = math.max(0, totalCalls - previousCalls)
                if cursor and newCalls == 0 then continue end
                local startIdx = math.max(previousCalls + 1, totalCalls - maxCallsPerRemote + 1, 1)

                if not summaryOnly then
                    for i = startIdx, totalCalls do
                        local call = log.Calls[i]
                        if not call then continue end

                        table.insert(recentCalls, {
                            Index = i,
                            Arguments = call.Arguments,
                            Origin = call.Origin,
                            IsExecutor = call.IsExecutor or false,
                            IsActor = call.IsActor or false,
                            Line = call.Line,
                        })
                    end
                end

                table.insert(results, {
                    RemoteName = remoteName,
                    RemoteClass = remoteClass,
                    Direction = directionLabel,
                    Method = log.Method,
                    TotalCalls = totalCalls,
                    NewCalls = cursor and newCalls or nil,
                    DebugId = debugId,
                    Ignored = log.Ignored,
                    Blocked = log.Blocked,
                    RecentCalls = if summaryOnly then nil else recentCalls,
                })
            end

            return results
        end

        local allResults = {}

        if direction == "Outgoing" or direction == "Both" then
            local outgoing = ProcessLogs(Cobalt.shared.Logs.Outgoing, "Outgoing")
            for _, r in outgoing do
                table.insert(allResults, r)
            end
        end

        if direction == "Incoming" or direction == "Both" then
            local incoming = ProcessLogs(Cobalt.shared.Logs.Incoming, "Incoming")
            for _, r in incoming do
                table.insert(allResults, r)
            end
        end

        -- Sort by total calls descending (most active remotes first)
        table.sort(allResults, function(a, b)
            local av = a.NewCalls or a.TotalCalls
            local bv = b.NewCalls or b.TotalCalls
            if av == bv then return a.TotalCalls > b.TotalCalls end
            return av > bv
        end)

        -- Trim to limit
        if #allResults > limit then
            local trimmed = {}
            for i = 1, limit do
                trimmed[i] = allResults[i]
            end
            allResults = trimmed
        end

        return {
            count = #allResults,
            results = allResults
        }
    end)

    Bridge:BindToType("clear-remote-spy-logs", function(data)
        local Cobalt = getgenv().Cobalt
        assert(Cobalt and Cobalt.shared and Cobalt.shared.ClearLogs, "Cobalt remote spy is not loaded. Call ensure-remote-spy first.")

        Cobalt.shared.ClearLogs()

        return {
            status = "cleared",
            message = "All remote spy logs have been cleared."
        }
    end)

    Bridge:BindToType("block-remote", function(data)
        local Cobalt = getgenv().Cobalt
        assert(Cobalt and Cobalt.shared and Cobalt.shared.Logs, "Cobalt remote spy is not loaded. Call ensure-remote-spy first.")

        local remoteName = data.remoteName
        local remoteDebugId = data.remoteDebugId
        assert((typeof(remoteName) == "string" and remoteName ~= "") or (typeof(remoteDebugId) == "string" and remoteDebugId ~= ""), "Provide remoteName or remoteDebugId.")
        local direction = data.direction
        local shouldBlock = data.shouldBlock

        local logTable = Cobalt.shared.Logs[direction]
        assert(logTable, "Invalid direction: " .. tostring(direction))

        for instance, log in logTable do
            if typeof(instance) ~= "Instance" then continue end

            local name = ""
            pcall(function() name = instance.Name end)

            local debugId = instance:GetDebugId()
            local matches = (typeof(remoteDebugId) == "string" and remoteDebugId ~= "" and debugId == remoteDebugId)
                or ((remoteDebugId == nil or remoteDebugId == "") and name == remoteName)
            if matches then
                if shouldBlock and not log.Blocked then
                    log:Block()
                elseif not shouldBlock and log.Blocked then
                    log:Block() -- toggles
                end

                return {
                    status = "success",
                    message = (shouldBlock and "Blocked" or "Unblocked") .. " remote: " .. name,
                    remoteName = name,
                    remoteDebugId = debugId,
                    blocked = log.Blocked
                }
            end
        end

        error("Remote not found: " .. tostring(remoteDebugId or remoteName) .. " in " .. direction .. " logs. Make sure the remote has been logged at least once.")
    end)

    Bridge:BindToType("ignore-remote", function(data)
        local Cobalt = getgenv().Cobalt
        assert(Cobalt and Cobalt.shared and Cobalt.shared.Logs, "Cobalt remote spy is not loaded. Call ensure-remote-spy first.")

        local remoteName = data.remoteName
        local remoteDebugId = data.remoteDebugId
        assert((typeof(remoteName) == "string" and remoteName ~= "") or (typeof(remoteDebugId) == "string" and remoteDebugId ~= ""), "Provide remoteName or remoteDebugId.")
        local direction = data.direction
        local shouldIgnore = data.shouldIgnore

        local logTable = Cobalt.shared.Logs[direction]
        assert(logTable, "Invalid direction: " .. tostring(direction))

        for instance, log in logTable do
            if typeof(instance) ~= "Instance" then continue end

            local name = ""
            pcall(function() name = instance.Name end)

            local debugId = instance:GetDebugId()
            local matches = (typeof(remoteDebugId) == "string" and remoteDebugId ~= "" and debugId == remoteDebugId)
                or ((remoteDebugId == nil or remoteDebugId == "") and name == remoteName)
            if matches then
                if shouldIgnore and not log.Ignored then
                    log:Ignore()
                elseif not shouldIgnore and log.Ignored then
                    log:Ignore() -- toggles
                end

                return {
                    status = "success",
                    message = (shouldIgnore and "Ignoring" or "Unignored") .. " remote: " .. name,
                    remoteName = name,
                    remoteDebugId = debugId,
                    ignored = log.Ignored
                }
            end
        end

        error("Remote not found: " .. tostring(remoteDebugId or remoteName) .. " in " .. direction .. " logs. Make sure the remote has been logged at least once.")
    end)

    -- Keep Cobalt's implementation details behind one public MCP operation.
    -- The legacy callbacks above remain internal so this dispatcher can reuse
    -- their validated filtering and state-change behavior.
    Bridge:BindToType("remote-spy", function(data)
        local operation = data.operation
        if operation == "status" then
            local Cobalt = getgenv().Cobalt
            local function CountLogs(logTable)
                local count = 0
                if typeof(logTable) ~= "table" then return count end
                for _ in logTable do
                    count += 1
                end
                return count
            end

            return {
                status = Cobalt and "loaded" or "not_loaded",
                provider = "Cobalt",
                source = "https://gitlab.com/upio/cobalt/-/releases/permalink/latest/downloads/Cobalt.luau",
                outgoingRemotes = Cobalt and CountLogs(Cobalt.shared and Cobalt.shared.Logs and Cobalt.shared.Logs.Outgoing) or 0,
                incomingRemotes = Cobalt and CountLogs(Cobalt.shared and Cobalt.shared.Logs and Cobalt.shared.Logs.Incoming) or 0,
            }
        end

        Bridge.Callbacks["ensure-remote-spy"]({ userConfirmedRisk = data.userConfirmedRisk })

        if operation == "list" then
            return Bridge.Callbacks["get-remote-spy-logs"]({
                direction = data.direction,
                remoteNameFilter = data.nameFilter,
                limit = data.limit,
                maxCallsPerRemote = data.maxCallsPerRemote,
                summaryOnly = data.summaryOnly,
                sinceCursor = data.sinceCursor,
            })
        elseif operation == "mark" then
            local Cobalt = getgenv().Cobalt
            RemoteSpyCursorCounter += 1
            if RemoteSpyCursorCounter > 100 then RemoteSpyCursors["remote:" .. tostring(RemoteSpyCursorCounter - 100)] = nil end
            local cursorId = "remote:" .. tostring(RemoteSpyCursorCounter)
            local counts = {}
            local function Capture(logTable, directionLabel)
                if typeof(logTable) ~= "table" then return end
                for instance, log in logTable do
                    if typeof(instance) == "Instance" then
                        counts[directionLabel .. ":" .. instance:GetDebugId()] = #log.Calls
                    end
                end
            end
            Capture(Cobalt.shared.Logs.Outgoing, "Outgoing")
            Capture(Cobalt.shared.Logs.Incoming, "Incoming")
            RemoteSpyCursors[cursorId] = counts
            return { cursor = cursorId, trackedRemotes = (function() local n=0 for _ in counts do n+=1 end return n end)() }
        elseif operation == "profile" then
            local listed = Bridge.Callbacks["get-remote-spy-logs"]({
                direction = data.direction, remoteNameFilter = data.nameFilter, limit = data.limit or 20,
                maxCallsPerRemote = data.maxCallsPerRemote or 20, summaryOnly = false, sinceCursor = data.sinceCursor,
            })
            for _, remote in ipairs(listed.results or {}) do
                local signatures = {}
                local origins = {}
                local executorCalls = 0
                local actorCalls = 0
                for _, call in ipairs(remote.RecentCalls or {}) do
                    local args = call.Arguments
                    local parts = {}
                    if typeof(args) == "table" then
                        for i, arg in ipairs(args) do parts[i] = typeof(arg) end
                    end
                    local sig = "(" .. table.concat(parts, ", ") .. ")"
                    signatures[sig] = (signatures[sig] or 0) + 1
                    local origin = tostring(call.Origin or "Unknown")
                    origins[origin] = (origins[origin] or 0) + 1
                    if call.IsExecutor then executorCalls += 1 end
                    if call.IsActor then actorCalls += 1 end
                end
                remote.Signatures = signatures
                remote.Origins = origins
                remote.ExecutorCalls = executorCalls
                remote.ActorCalls = actorCalls
                remote.RecentCalls = nil
            end
            return listed
        elseif operation == "clear" then
            return Bridge.Callbacks["clear-remote-spy-logs"]({})
        elseif operation == "block" or operation == "unblock" then
            return Bridge.Callbacks["block-remote"]({
                remoteName = data.remoteName,
                remoteDebugId = data.remoteDebugId,
                direction = data.direction,
                shouldBlock = operation == "block",
            })
        elseif operation == "ignore" or operation == "unignore" then
            return Bridge.Callbacks["ignore-remote"]({
                remoteName = data.remoteName,
                remoteDebugId = data.remoteDebugId,
                direction = data.direction,
                shouldIgnore = operation == "ignore",
            })
        end

        error("Invalid remote-spy operation: " .. tostring(operation))
    end)


    Bridge:BindToType("get-executor-capabilities", function(data)
        local names = {
            "getgc", "getconnections", "getloadedmodules", "getnilinstances", "getreg", "getregistry", "getsenv",
            "getscriptclosure", "getconstants", "getupvalues", "getprotos", "hookfunction",
            "hookmetamethod", "firesignal", "fireproximityprompt", "firetouchinterest",
            "getscriptbytecode", "decompile", "request", "http_request", "writefile", "readfile",
            "isfile", "makefolder", "listfiles", "setclipboard", "gethui", "cloneref",
            "setthreadidentity", "getthreadidentity", "queue_on_teleport", "gethiddenproperty", "sethiddenproperty",
        }
        local caps = {}
        for _, name in ipairs(names) do caps[name] = ResolveCallable(name) ~= nil end
        caps["debug.getconstants"] = GetDebugFunction("getconstants") ~= nil
        caps["debug.getupvalues"] = GetDebugFunction("getupvalues") ~= nil
        caps["debug.getupvalue"] = (typeof(debug) == "table" and typeof(debug.getupvalue) == "function")
        caps["debug.getregistry"] = (typeof(debug) == "table" and typeof(debug.getregistry) == "function")
        caps["debug.getprotos"] = GetDebugFunction("getprotos") ~= nil
        caps.websocket = (typeof(WebSocket) == "table" and typeof(WebSocket.connect) == "function")
            or ResolveCallable("websocket") ~= nil
        caps.filesystem = caps.writefile and caps.readfile and caps.isfile
        caps.drawing = (typeof(Drawing) == "table" and typeof(Drawing.new) == "function")
        local executorName, executorVersion = GetExecutorInfo()
        return {
            executor = executorName,
            version = executorVersion,
            capabilities = caps,
            functionDiscovery = {
                tool = "search-executor-functions",
                description = "Search getgenv/getfenv/_G recursively for available executor functions without invoking them.",
            },
        }
    end)

    Bridge:BindToType("search-executor-functions", function(data)
        return SearchExecutorFunctions(data)
    end)

    local function EncodeNilScanField(value)
        if value == nil then return "" end
        local text = tostring(value)
        local ok, encoded = pcall(function()
            return HttpService:UrlEncode(text)
        end)
        if ok and type(encoded) == "string" then return encoded end
        local escaped = text:gsub("%%", "%%25")
        escaped = escaped:gsub("\t", "%%09")
        escaped = escaped:gsub("\r", "%%0D")
        escaped = escaped:gsub("\n", "%%0A")
        return escaped
    end

    local function EncodeNilScanBoolean(value)
        if value == nil then return "" end
        return value and "1" or "0"
    end

    local function EncodeNilScanRecord(item)
        return table.concat({
            EncodeNilScanField(item.DebugId),
            EncodeNilScanField(item.Name),
            EncodeNilScanField(item.ClassName),
            EncodeNilScanField(item.Path),
            EncodeNilScanField(item.RelativePath),
            EncodeNilScanField(item.ParentDebugId),
            EncodeNilScanField(item.RootDebugId),
            tostring(tonumber(item.Depth) or 0),
            EncodeNilScanBoolean(item.IsNilRoot == true),
            EncodeNilScanBoolean(item.IsScript == true),
            EncodeNilScanBoolean(item.Archivable),
            tostring(tonumber(item.ChildCount) or 0),
        }, "\t")
    end

    local function UploadNilInstanceScanPart(clientId, scanId, phase, instances, summary)
        if type(clientId) ~= "string" or clientId == "" then
            return false, "Missing clientId for nil-instance scan upload."
        end
        if type(scanId) ~= "string" or scanId == "" then
            return false, "Missing scanId for nil-instance scan upload."
        end

        local body = ""
        if phase == "batch" then
            local lines = {}
            for i, item in ipairs(instances or {}) do
                lines[i] = EncodeNilScanRecord(item)
            end
            body = table.concat(lines, "\n")
        elseif phase == "finish" then
            local sources = ""
            if type(summary.sourcesUsed) == "table" then
                sources = table.concat(summary.sourcesUsed, "\31")
            end
            body = table.concat({
                "foundNilInstances\t" .. tostring(tonumber(summary.foundNilInstances) or 0),
                "capturedRoots\t" .. tostring(tonumber(summary.capturedRoots) or 0),
                "capturedInstances\t" .. tostring(tonumber(summary.capturedInstances) or 0),
                "recoveredScripts\t" .. tostring(tonumber(summary.recoveredScripts) or 0),
                "capturedScripts\t" .. tostring(tonumber(summary.capturedScripts) or 0),
                "functionScans\t" .. tostring(tonumber(summary.functionScans) or 0),
                "tableScans\t" .. tostring(tonumber(summary.tableScans) or 0),
                "operations\t" .. tostring(tonumber(summary.operations) or 0),
                "maxTreeNodes\t" .. tostring(tonumber(summary.maxTreeNodes) or 0),
                "treeTruncated\t" .. EncodeNilScanBoolean(summary.treeTruncated == true),
                "sourcesUsed\t" .. EncodeNilScanField(sources),
            }, "\n")
        end

        local url = "http://" .. BridgeURL
            .. "/nil-instance-scan?clientId=" .. EncodeNilScanField(clientId)
            .. "&scanId=" .. EncodeNilScanField(scanId)
            .. "&phase=" .. EncodeNilScanField(phase)

        for attempt = 1, 3 do
            local ok, response = pcall(ExecutorRequest, {
                Url = url,
                Method = "POST",
                Headers = { ["Content-Type"] = "text/plain; charset=utf-8" },
                Body = body,
            })
            if ok and response and GetResponseStatus(response) == 200 then
                return true
            end
            if attempt < 3 then task.wait(0.2 * attempt) end
        end

        return false, "Bridge rejected nil-instance scan batch."
    end

    Bridge:BindToType("recover-nil-scripts", function(data)
        -- Heavy recovery is intentionally explicit/on-demand only. Nothing in startup or ordinary
        -- DebugId/script resolution calls getnilinstances/getgc/getreg/getregistry.
        assert(data.userConfirmedRisk == true, "Risk confirmation required before nil/runtime recovery (getnilinstances/getgc/registry scans).")
        local getnilinstancesFn = ResolveCallable("getnilinstances")
        assert(getnilinstancesFn, "Executor does not support getnilinstances.")

        local streamScan = data.dashboardStream == true
        local streamClientId = streamScan and tostring(data.clientId or "") or nil
        local streamScanId = streamScan and tostring(data.scanId or "") or nil
        if streamScan then
            assert(streamClientId ~= "", "Dashboard nil-instance scan is missing clientId.")
            assert(streamScanId ~= "", "Dashboard nil-instance scan is missing scanId.")
            local started, startError = UploadNilInstanceScanPart(streamClientId, streamScanId, "start")
            assert(started, startError or "Failed to start nil-instance scan upload.")
        end

        local S, F = {}, {}
        local ops, fc, tc = 0, 0, 0
        local CF, CU, CT, CP, CS = 6e3, 80, 250, 80, 250
        local sourcesUsed = { "getnilinstances" }

        local function st()
            ops += 1
            if ops % CS == 0 then task.wait() end
        end

        local function par(x)
            local o, p = pcall(function() return x.Parent end)
            return o and p
        end

        local function nilp(x)
            return typeof(x) == "Instance" and not par(x)
        end

        local function scr(x)
            local o, r = pcall(function()
                return x:IsA("LocalScript") or x:IsA("ModuleScript") or x:IsA("Script")
            end)
            return o and r
        end

        local function add(x)
            if nilp(x) and not S[x] then
                S[x] = 1
                F[#F + 1] = x
            end
        end

        local function tab(t)
            if type(t) ~= "table" or tc >= CT then return end
            tc += 1
            local n = 0
            pcall(function()
                for k, v in t do
                    n += 1
                    add(k)
                    add(v)
                    if n >= CP then break end
                    st()
                end
            end)
        end

        local function up(f)
            if type(f) ~= "function" or fc >= CF or not debug or type(debug.getupvalue) ~= "function" then return end
            fc += 1
            for i = 1, CU do
                local o, a, b = pcall(debug.getupvalue, f, i)
                if not o or (a == nil and b == nil) then break end
                add(a)
                add(b)
                tab(a)
                tab(b)
                st()
            end
        end

        local function each(fn, ...)
            local o, t = pcall(fn, ...)
            if not o or type(t) ~= "table" then return false end
            for _, v in t do
                add(v)
                up(v)
                tab(v)
                st()
            end
            return true
        end

        each(getnilinstancesFn)

        local getloadedmodulesFn = ResolveCallable("getloadedmodules")
        if getloadedmodulesFn and each(getloadedmodulesFn) then
            sourcesUsed[#sourcesUsed + 1] = "getloadedmodules"
        end

        local getgcFn = ResolveCallable("getgc")
        if getgcFn and each(getgcFn, false) then
            sourcesUsed[#sourcesUsed + 1] = "getgc(false)"
        end

        local getregFn = ResolveCallable("getreg")
        if getregFn and each(getregFn) then
            sourcesUsed[#sourcesUsed + 1] = "getreg"
        end

        local getregistryFn = ResolveCallable("getregistry")
        if getregistryFn and each(getregistryFn) then
            sourcesUsed[#sourcesUsed + 1] = "getregistry"
        end

        if type(debug) == "table" and type(debug.getregistry) == "function" and each(debug.getregistry) then
            sourcesUsed[#sourcesUsed + 1] = "debug.getregistry"
        end

        local maxTreeNodes = math.max(1000, math.min(tonumber(data.maxTreeNodes) or 5000, 100000))
        local recovered = {}
        local recoveredCount = 0
        local capturedScriptCount = 0
        local capturedRoots = 0
        local instances = {}
        local capturedInstanceCount = 0
        local uploadBatch = {}
        local uploadBatchMax = 96
        local treeTruncated = false

        local function flushUploadBatch()
            if not streamScan or #uploadBatch == 0 then return true end
            local batch = uploadBatch
            uploadBatch = {}
            local uploaded, uploadError = UploadNilInstanceScanPart(
                streamClientId, streamScanId, "batch", batch
            )
            assert(uploaded, uploadError or "Failed to upload nil-instance scan batch.")
            return true
        end

        local function readDebugId(instance)
            local ok, id = pcall(function() return instance:GetDebugId() end)
            if ok and typeof(id) == "string" and id ~= "" then return id end
            return nil
        end

        local function captureInstance(instance, rootDebugId, parentDebugId, depth, relativePath, isRoot)
            if capturedInstanceCount >= maxTreeNodes then
                treeTruncated = true
                return nil, nil
            end

            local isScript = scr(instance)
            local item = {
                Name = tostring(instance.Name),
                ClassName = tostring(instance.ClassName),
                Depth = depth,
                RelativePath = relativePath,
                RootDebugId = rootDebugId,
                ParentDebugId = parentDebugId,
                IsNilRoot = isRoot == true,
                IsScript = isScript == true,
            }
            pcall(function() item.Path = SafeFullName(instance) end)
            pcall(function() item.Archivable = instance.Archivable end)

            local debugId = readDebugId(instance)
            if debugId then
                item.DebugId = debugId
                InstanceByDebugId[debugId] = instance
                if isScript then ScriptInstanceMap[debugId] = instance end
            end

            local children = {}
            pcall(function() children = instance:GetChildren() end)
            item.ChildCount = #children
            capturedInstanceCount += 1
            if streamScan then
                uploadBatch[#uploadBatch + 1] = item
                if #uploadBatch >= uploadBatchMax then flushUploadBatch() end
            else
                instances[#instances + 1] = item
            end
            if isScript then capturedScriptCount += 1 end
            st()
            return item, children
        end

        for _, root in F do
            if not nilp(root) then
                st()
                continue
            end

            capturedRoots += 1
            local rootDebugId = readDebugId(root)
            local rootKey = rootDebugId or ("unresolved:" .. tostring(capturedRoots))
            local rootName = tostring(root.Name)
            local queue = {
                {
                    instance = root,
                    parentDebugId = nil,
                    depth = 0,
                    relativePath = rootName,
                }
            }
            local queueIndex = 1

            while queueIndex <= #queue do
                local pending = queue[queueIndex]
                queueIndex += 1
                local item, children = captureInstance(
                    pending.instance,
                    rootKey,
                    pending.parentDebugId,
                    pending.depth,
                    pending.relativePath,
                    pending.depth == 0
                )
                if not item then break end

                if pending.depth == 0 and item.IsScript then
                    recoveredCount += 1
                    if #recovered < 100 then recovered[#recovered + 1] = item end
                end

                local parentId = item.DebugId
                for _, child in children do
                    queue[#queue + 1] = {
                        instance = child,
                        parentDebugId = parentId,
                        depth = pending.depth + 1,
                        relativePath = pending.relativePath .. "/" .. tostring(child.Name),
                    }
                end
            end

            if treeTruncated then break end
        end

        if streamScan then flushUploadBatch() end

        local result = {
            scanVersion = 1,
            success = true,
            foundNilInstances = #F,
            capturedRoots = capturedRoots,
            capturedInstances = capturedInstanceCount,
            containedInstances = math.max(0, capturedInstanceCount - capturedRoots),
            recoveredScripts = recoveredCount,
            capturedScripts = capturedScriptCount,
            functionScans = fc,
            tableScans = tc,
            operations = ops,
            sourcesUsed = sourcesUsed,
            maxTreeNodes = maxTreeNodes,
            treeTruncated = treeTruncated,
            recovered = recovered,
            recoveredTruncated = recoveredCount > #recovered,
            note = "Original nil roots and their contained descendants are cached by DebugId for direct MCP follow-up; no cloning or reparenting is performed.",
        }

        if streamScan then
            local finished, finishError = UploadNilInstanceScanPart(
                streamClientId, streamScanId, "finish", nil, result
            )
            assert(finished, finishError or "Failed to finalize nil-instance scan upload.")
            return "OK"
        end

        result.instances = instances
        return result
    end)

    -- Dashboard-only streaming form. This is never invoked during startup: the dashboard calls it
    -- only after the user manually starts a nil-instance scan and confirms the risky methods.
    -- Large scans use a plain-text line protocol in bounded batches. Nil-instance rows never use JSON encoding.
    Bridge:BindToType("scan-nil-instances", function(data)
        data.dashboardStream = true
        return Bridge.Callbacks["recover-nil-scripts"](data)
    end)

    Bridge:BindToType("create-console-cursor", function(data)
        ConsoleCursorCounter += 1
        if ConsoleCursorCounter > 100 then ConsoleCursors["console:" .. tostring(ConsoleCursorCounter - 100)] = nil end
        local id = "console:" .. tostring(ConsoleCursorCounter)
        local logs = LogService:GetLogHistory()
        local last = logs[#logs]
        ConsoleCursors[id] = {
            index = #logs,
            timestamp = last and tonumber(last.timestamp) or nil,
        }
        return { cursor = id, index = #logs, timestamp = ConsoleCursors[id].timestamp }
    end)

    Bridge:BindToType("search-runtime-objects", function(data)
        AssertRiskConfirmed(data, { "getgc" })
        local getgcFn = ResolveCallable("getgc")
        assert(getgcFn, "Executor does not support getgc.")
        local objectType = string.lower(tostring(data.objectType or "Any"))
        local constantNeedle = typeof(data.constantContains) == "string" and string.lower(data.constantContains) or nil
        local sourceNeedle = typeof(data.sourceContains) == "string" and string.lower(data.sourceContains) or nil
        local upvalueNeedle = typeof(data.upvalueName) == "string" and string.lower(data.upvalueName) or nil
        local keyNeedle = data.key
        local limit = math.max(1, math.min(tonumber(data.limit) or 20, 100))
        local maxScanned = math.max(limit, math.min(tonumber(data.maxScanned) or 5000, 50000))
        local constantsFn = GetDebugFunction("getconstants")
        local upvaluesFn = GetDebugFunction("getupvalues")
        local results, scanned = {}, 0

        local ok, objects = pcall(getgcFn, true)
        if not ok then ok, objects = pcall(getgcFn) end
        assert(ok and typeof(objects) == "table", "getgc failed.")

        for _, object in ipairs(objects) do
            scanned += 1
            if scanned > maxScanned or #results >= limit then break end
            local t = typeof(object)
            if objectType ~= "any" and string.lower(t) ~= objectType then continue end
            if sourceNeedle then
                if t ~= "function" then continue end
                local sourceOk, source = pcall(function() return debug.info(object, "s") end)
                if not sourceOk or not string.find(string.lower(tostring(source or "")), sourceNeedle, 1, true) then continue end
            end
            if upvalueNeedle then
                if t ~= "function" or not upvaluesFn then continue end
                local uOk, upvalues = pcall(upvaluesFn, object)
                if not uOk or typeof(upvalues) ~= "table" then continue end
                local found = false
                for name in pairs(upvalues) do
                    if string.find(string.lower(tostring(name)), upvalueNeedle, 1, true) then found = true break end
                end
                if not found then continue end
            end
            if keyNeedle ~= nil then
                if t ~= "table" or rawget(object, keyNeedle) == nil then continue end
            end
            if constantNeedle then
                if t ~= "function" or not constantsFn then continue end
                local cOk, constants = pcall(constantsFn, object)
                if not cOk or typeof(constants) ~= "table" then continue end
                local found = false
                for _, constant in pairs(constants) do
                    if string.find(string.lower(tostring(constant)), constantNeedle, 1, true) then found = true break end
                end
                if not found then continue end
            end
            local prefix = t == "function" and "runtime:f" or (t == "table" and "runtime:t" or "runtime:o")
            local handle = StoreRuntimeHandle(object, prefix)
            local item = { Handle = handle, Type = t }
            if t == "table" then
                local keys = {}
                for k in pairs(object) do
                    if #keys >= 15 then break end
                    table.insert(keys, tostring(k))
                end
                item.Keys = keys
            elseif t == "function" then
                local infoOk, info = pcall(function() return debug.info(object, "sln") end)
                if infoOk then item.DebugInfo = tostring(info) end
            end
            table.insert(results, item)
        end
        return { scanned = scanned, count = #results, results = results }
    end)

    Bridge:BindToType("inspect-runtime-object", function(data)
        local object = RuntimeHandles[data.handle]
        assert(object ~= nil, "Unknown or expired runtime handle: " .. tostring(data.handle))
        local t = typeof(object)
        local result = { Handle = data.handle, Type = t }
        if t == "table" then
            local maxEntries = math.max(1, math.min(tonumber(data.maxEntries) or 40, 100))
            local entries, count = {}, 0
            for k, v in pairs(object) do
                count += 1
                if #entries < maxEntries then
                    table.insert(entries, { Key = SanitizeForOutput(k), Value = SanitizeForOutput(v) })
                end
            end
            result.EntryCount = count
            result.Entries = entries
        elseif t == "function" then
            local requestedMethods = {}
            if data.includeConstants ~= false then requestedMethods[#requestedMethods + 1] = "getconstants" end
            if data.includeUpvalues ~= false then requestedMethods[#requestedMethods + 1] = "getupvalues" end
            if data.includeProtos == true then requestedMethods[#requestedMethods + 1] = "getprotos" end
            if #requestedMethods > 0 then AssertRiskConfirmed(data, requestedMethods) end
            local constantsFn = GetDebugFunction("getconstants")
            local upvaluesFn = GetDebugFunction("getupvalues")
            local protosFn = GetDebugFunction("getprotos")
            local info = {}
            pcall(function()
                info.Source = debug.info(object, "s")
                info.Line = debug.info(object, "l")
                info.Name = debug.info(object, "n")
                info.Arity = debug.info(object, "a")
            end)
            result.Info = info
            if data.includeConstants ~= false and constantsFn then
                local okC, values = pcall(constantsFn, object)
                if okC then result.Constants = SanitizeForOutput(values) end
            end
            if data.includeUpvalues ~= false and upvaluesFn then
                local okU, values = pcall(upvaluesFn, object)
                if okU then result.Upvalues = SanitizeForOutput(values) end
            end
            if data.includeProtos == true and protosFn then
                local okP, values = pcall(protosFn, object)
                if okP and typeof(values) == "table" then
                    local handles = {}
                    for i, proto in ipairs(values) do
                        if i > 20 then break end
                        table.insert(handles, StoreRuntimeHandle(proto, "runtime:f"))
                    end
                    result.ProtoHandles = handles
                end
            end
        else
            result.Value = SanitizeForOutput(object)
        end
        return result
    end)

    Bridge:BindToType("inspect-connections", function(data)
        if data.operation == "set-state" then
            local connection = ConnectionHandles[data.handle]
            assert(connection, "Unknown or expired connection handle.")
            local enabled = data.enabled == true
            local ok = pcall(function()
                if enabled and typeof(connection.Enable) == "function" then connection:Enable()
                elseif not enabled and typeof(connection.Disable) == "function" then connection:Disable()
                elseif connection.Enabled ~= nil then connection.Enabled = enabled
                else error("Connection does not expose Enable/Disable.") end
            end)
            assert(ok, "Failed to change connection state.")
            return { handle = data.handle, enabled = enabled }
        end

        AssertRiskConfirmed(data, { "getconnections" })
        local getconnectionsFn = ResolveCallable("getconnections")
        assert(getconnectionsFn, "Executor does not support getconnections.")
        local instance = ResolveInstanceTarget(data)
        local signalName = data.signal
        assert(typeof(signalName) == "string" and signalName ~= "", "signal is required.")
        local signal = instance[signalName]
        local connections = getconnectionsFn(signal)
        local limit = math.max(1, math.min(tonumber(data.limit) or 20, 100))
        local results = {}
        for i, connection in ipairs(connections) do
            if i > limit then break end
            ConnectionHandleCounter += 1
            local handle = "connection:" .. tostring(ConnectionHandleCounter)
            ConnectionHandles[handle] = connection
            local item = { Handle = handle }
            pcall(function() item.Enabled = connection.Enabled end)
            pcall(function() item.Function = connection.Function and StoreRuntimeHandle(connection.Function, "runtime:f") or nil end)
            pcall(function() item.LuaConnection = connection.LuaConnection end)
            table.insert(results, item)
        end
        return { Path = SafeFullName(instance), Signal = signalName, count = #connections, results = results }
    end)

    Bridge:BindToType("inspect-module", function(data)
        local module = ResolveInstanceTarget(data)
        assert(module:IsA("ModuleScript"), "Target is not a ModuleScript.")
        local result = { Name = module.Name, Path = SafeFullName(module), DebugId = module:GetDebugId() }
        local ok, exported = pcall(require, module)
        if not ok then
            result.RequireError = tostring(exported)
            return result
        end
        result.ExportType = typeof(exported)
        if typeof(exported) == "table" then
            local keys = {}
            local maxKeys = math.max(1, math.min(tonumber(data.maxKeys) or 50, 100))
            for key in pairs(exported) do
                if #keys >= maxKeys then break end
                table.insert(keys, tostring(key))
            end
            result.ExportKeys = keys
            if data.includeValues == true then result.Exports = SanitizeForOutput(exported) end
        elseif data.includeValues == true then
            result.ExportValue = SanitizeForOutput(exported)
        end
        return result
    end)

    Bridge:BindToType("inspect-loaded-modules", function(data)
        AssertRiskConfirmed(data, { "getloadedmodules" })
        local getloadedmodulesFn = ResolveCallable("getloadedmodules")
        assert(getloadedmodulesFn, "Executor does not support getloadedmodules.")
        local filter = string.lower(tostring(data.filter or ""))
        local limit = math.max(1, math.min(tonumber(data.limit) or 20, 100))
        local modules = getloadedmodulesFn()
        local results = {}
        for _, module in ipairs(modules) do
            if typeof(module) ~= "Instance" then continue end
            local path = SafeFullName(module)
            if filter ~= "" and not string.find(string.lower(module.Name .. " " .. path), filter, 1, true) then continue end
            local debugId = module:GetDebugId()
            InstanceByDebugId[debugId] = module
            local item = { Name = module.Name, Path = path, DebugId = debugId }
            if data.includeExports == true then
                local okR, exported = pcall(require, module)
                if okR then
                    item.ExportType = typeof(exported)
                    if typeof(exported) == "table" then
                        local keys = {}
                        for k in pairs(exported) do if #keys >= 30 then break end table.insert(keys, tostring(k)) end
                        item.ExportKeys = keys
                    end
                else item.RequireError = tostring(exported) end
            end
            table.insert(results, item)
            if #results >= limit then break end
        end
        return { count = #results, results = results }
    end)

    Bridge:BindToType("inspect-visible-gui", function(data)
        local limit = math.max(1, math.min(tonumber(data.limit) or 50, 200))
        local textFilter = string.lower(tostring(data.textFilter or ""))
        local roots = {}
        local player = Players.LocalPlayer
        if player then
            local pg = player:FindFirstChildOfClass("PlayerGui")
            if pg then table.insert(roots, pg) end
        end
        table.insert(roots, CoreGui)

        local function IsActuallyVisible(obj)
            local current = obj
            while current and current ~= game do
                if current:IsA("GuiObject") and current.Visible == false then return false end
                if current:IsA("ScreenGui") and current.Enabled == false then return false end
                current = current.Parent
            end
            return true
        end

        local results = {}
        for _, rootGui in ipairs(roots) do
            for _, obj in rootGui:QueryDescendants("GuiObject") do
                if #results >= limit then break end
                if not IsActuallyVisible(obj) then continue end
                local text = nil
                if obj:IsA("TextLabel") or obj:IsA("TextButton") or obj:IsA("TextBox") then text = obj.Text end
                if textFilter ~= "" and not string.find(string.lower(tostring(text or obj.Name)), textFilter, 1, true) then continue end
                local debugId = obj:GetDebugId()
                InstanceByDebugId[debugId] = obj
                local item = {
                    Name = obj.Name, ClassName = obj.ClassName, Path = SafeFullName(obj), DebugId = debugId,
                    AbsolutePosition = obj.AbsolutePosition, AbsoluteSize = obj.AbsoluteSize, ZIndex = obj.ZIndex,
                    Active = obj.Active, Text = text,
                }
                if obj:IsA("GuiButton") then item.Interactable = obj.Active and obj.Visible end
                table.insert(results, item)
            end
            if #results >= limit then break end
        end
        return { count = #results, limited = #results >= limit, results = results }
    end)

    Bridge:BindToType("get-player-state", function(data)
        local player = Players.LocalPlayer
        assert(player, "LocalPlayer unavailable.")
        local character = player.Character
        local humanoid = character and character:FindFirstChildOfClass("Humanoid")
        local root = character and character:FindFirstChild("HumanoidRootPart")
        local camera = workspace.CurrentCamera
        local tools = {}
        local function AddTools(container, location)
            if not container then return end
            for _, child in ipairs(container:GetChildren()) do
                if child:IsA("Tool") then
                    local debugId = child:GetDebugId()
                    InstanceByDebugId[debugId] = child
                    table.insert(tools, { Name = child.Name, Location = location, DebugId = debugId })
                end
            end
        end
        AddTools(player:FindFirstChildOfClass("Backpack"), "Backpack")
        AddTools(character, "Character")
        if character then InstanceByDebugId[character:GetDebugId()] = character end
        if humanoid then InstanceByDebugId[humanoid:GetDebugId()] = humanoid end
        if root then InstanceByDebugId[root:GetDebugId()] = root end
        return {
            Player = { Name = player.Name, UserId = tostring(player.UserId) },
            Character = character and { Path = SafeFullName(character), DebugId = character:GetDebugId() } or nil,
            HumanoidDebugId = humanoid and humanoid:GetDebugId() or nil,
            RootPartDebugId = root and root:GetDebugId() or nil,
            Position = root and root.Position or nil,
            Velocity = root and root.AssemblyLinearVelocity or nil,
            Humanoid = humanoid and {
                Health = humanoid.Health, MaxHealth = humanoid.MaxHealth, WalkSpeed = humanoid.WalkSpeed,
                JumpPower = humanoid.JumpPower, State = tostring(humanoid:GetState()), MoveDirection = humanoid.MoveDirection,
                FloorMaterial = tostring(humanoid.FloorMaterial),
            } or nil,
            Camera = camera and { CFrame = camera.CFrame, FieldOfView = camera.FieldOfView, CameraType = tostring(camera.CameraType), CameraSubject = camera.CameraSubject } or nil,
            Tools = tools,
        }
    end)

    Bridge:BindToType("inspect-animations", function(data)
        local player = Players.LocalPlayer
        local character = player and player.Character
        local results = {}
        local limit = math.max(1, math.min(tonumber(data.limit) or 30, 100))
        if character then
            for _, animator in character:QueryDescendants("Animator") do
                for _, track in ipairs(animator:GetPlayingAnimationTracks()) do
                    if #results >= limit then break end
                    local animatorDebugId = animator:GetDebugId()
                    InstanceByDebugId[animatorDebugId] = animator
                    table.insert(results, {
                        Name = track.Name, AnimationId = track.Animation and track.Animation.AnimationId or nil,
                        AnimatorDebugId = animatorDebugId,
                        Priority = tostring(track.Priority), Speed = track.Speed, TimePosition = track.TimePosition,
                        Length = track.Length, WeightCurrent = track.WeightCurrent, WeightTarget = track.WeightTarget,
                        Looped = track.Looped, IsPlaying = track.IsPlaying, Animator = SafeFullName(animator),
                    })
                end
                if #results >= limit then break end
            end
        end
        return { count = #results, results = results }
    end)

    Bridge:BindToType("inspect-sounds", function(data)
        local limit = math.max(1, math.min(tonumber(data.limit) or 30, 100))
        local playingOnly = data.playingOnly ~= false
        local results = {}
        for _, sound in game:QueryDescendants("Sound") do
            if playingOnly and not sound.Playing then continue end
            local soundDebugId = sound:GetDebugId()
            InstanceByDebugId[soundDebugId] = sound
            table.insert(results, {
                Name = sound.Name, Path = SafeFullName(sound), DebugId = soundDebugId, SoundId = sound.SoundId,
                Playing = sound.Playing, Volume = sound.Volume, PlaybackSpeed = sound.PlaybackSpeed,
                TimePosition = sound.TimePosition, SoundGroup = sound.SoundGroup, RollOffMode = tostring(sound.RollOffMode),
                RollOffMinDistance = sound.RollOffMinDistance, RollOffMaxDistance = sound.RollOffMaxDistance,
            })
            if #results >= limit then break end
        end
        return { count = #results, results = results }
    end)

    Bridge:BindToType("get-performance-stats", function(data)
        local duration = math.max(0.1, math.min(tonumber(data.sampleSeconds) or 0.5, 2))
        local frames = 0
        local start = os.clock()
        local connection = RunService.RenderStepped:Connect(function() frames += 1 end)
        repeat task.wait() until os.clock() - start >= duration
        connection:Disconnect()
        local elapsed = os.clock() - start
        local result = { FPS = frames / elapsed, FrameTimeMs = (elapsed / math.max(frames, 1)) * 1000, SampleSeconds = elapsed }
        pcall(function() result.TotalMemoryMb = Stats:GetTotalMemoryUsageMb() end)
        pcall(function() result.InstanceCount = Stats.InstanceCount end)
        pcall(function() result.NetworkPingSeconds = Players.LocalPlayer:GetNetworkPing() end)
        pcall(function() result.LuaHeapKb = gcinfo() end)
        local counts = { Sound = 0, PlayingSound = 0, LuaSourceContainer = 0, GuiObject = 0, BasePart = 0, PlayingAnimation = 0 }
        for _, obj in game:QueryDescendants("Sound, Animator, LuaSourceContainer, GuiObject, BasePart") do
            if obj:IsA("Sound") then
                counts.Sound += 1
                if obj.Playing then counts.PlayingSound += 1 end
            elseif obj:IsA("Animator") then
                local ok, tracks = pcall(function() return obj:GetPlayingAnimationTracks() end)
                if ok then counts.PlayingAnimation += #tracks end
            elseif obj:IsA("LuaSourceContainer") then
                counts.LuaSourceContainer += 1
            elseif obj:IsA("GuiObject") then
                counts.GuiObject += 1
            elseif obj:IsA("BasePart") then
                counts.BasePart += 1
            end
        end
        result.Counts = counts
        return result
    end)

    local function CaptureStateSnapshot(data)
        local snapshot = {
            Instances = {}, ConsoleCount = nil, RemoteCounts = nil, Player = nil,
            Gui = nil, Sounds = nil, Animations = nil, CreatedAt = os.clock(),
        }
        snapshot.TargetSpecs = data.targets
        snapshot.Options = {
            includeConsole = data.includeConsole, includePlayer = data.includePlayer, includeRemotes = data.includeRemotes,
            includeGui = data.includeGui, includeSounds = data.includeSounds, includeAnimations = data.includeAnimations,
            riskApproved = data.userConfirmedRisk == true,
        }
        local targets = data.targets
        if typeof(targets) == "table" then
            for _, target in ipairs(targets) do
                if typeof(target) == "string" then target = { path = target } end
                local ok, instance = pcall(ResolveInstanceTarget, target)
                if ok and instance then
                    local entry = { Path = SafeFullName(instance), DebugId = instance:GetDebugId(), Properties = {} }
                    local properties = target.properties or { "Name", "Parent" }
                    for i, property in ipairs(properties) do
                        if i > 50 then break end
                        local pOk, value = pcall(function() return instance[property] end)
                        if pOk then entry.Properties[property] = StableValue(value) end
                    end
                    snapshot.Instances[entry.DebugId] = entry
                end
            end
        end
        if data.includeConsole ~= false then snapshot.ConsoleCount = #LogService:GetLogHistory() end
        if data.includePlayer ~= false then
            local player = Players.LocalPlayer
            local character = player and player.Character
            local humanoid = character and character:FindFirstChildOfClass("Humanoid")
            local root = character and character:FindFirstChild("HumanoidRootPart")
            snapshot.Player = {
                Position = root and StableValue(root.Position) or nil,
                Velocity = root and StableValue(root.AssemblyLinearVelocity) or nil,
                Health = humanoid and humanoid.Health or nil,
                WalkSpeed = humanoid and humanoid.WalkSpeed or nil,
                State = humanoid and tostring(humanoid:GetState()) or nil,
            }
        end
        if data.includeRemotes == true and getgenv().Cobalt and getgenv().Cobalt.shared and getgenv().Cobalt.shared.Logs then
            snapshot.RemoteCounts = {}
            for _, dir in ipairs({ "Outgoing", "Incoming" }) do
                local logTable = getgenv().Cobalt.shared.Logs[dir]
                for instance, log in logTable do
                    if typeof(instance) == "Instance" then snapshot.RemoteCounts[dir .. ":" .. instance:GetDebugId()] = #log.Calls end
                end
            end
        end

        if data.includeGui == true then
            snapshot.Gui = {}
            local roots = {}
            local player = Players.LocalPlayer
            local playerGui = player and player:FindFirstChildOfClass("PlayerGui")
            if playerGui then table.insert(roots, playerGui) end
            table.insert(roots, CoreGui)
            local captured = 0
            for _, guiRoot in ipairs(roots) do
                for _, obj in guiRoot:QueryDescendants("GuiObject") do
                    if captured >= 250 then break end
                    local visible = true
                    local current = obj
                    while current and current ~= game do
                        if current:IsA("GuiObject") and current.Visible == false then visible = false break end
                        if current:IsA("ScreenGui") and current.Enabled == false then visible = false break end
                        current = current.Parent
                    end
                    if not visible then continue end
                    local text = nil
                    if obj:IsA("TextLabel") or obj:IsA("TextButton") or obj:IsA("TextBox") then text = obj.Text end
                    local id = obj:GetDebugId()
                    snapshot.Gui[id] = {
                        Path = SafeFullName(obj), ClassName = obj.ClassName, Text = text,
                        Position = StableValue(obj.AbsolutePosition), Size = StableValue(obj.AbsoluteSize),
                    }
                    captured += 1
                end
                if captured >= 250 then break end
            end
        end

        if data.includeSounds == true then
            snapshot.Sounds = {}
            for _, sound in game:QueryDescendants("Sound") do
                if sound.Playing then
                    local id = sound:GetDebugId()
                    snapshot.Sounds[id] = { Path = SafeFullName(sound), SoundId = sound.SoundId, Volume = sound.Volume }
                end
            end
        end

        if data.includeAnimations == true then
            snapshot.Animations = {}
            local player = Players.LocalPlayer
            local character = player and player.Character
            if character then
                for _, animator in character:QueryDescendants("Animator") do
                    local animatorId = animator:GetDebugId()
                    for _, track in ipairs(animator:GetPlayingAnimationTracks()) do
                        local animationId = track.Animation and track.Animation.AnimationId or ""
                        local key = animatorId .. "|" .. animationId .. "|" .. track.Name
                        snapshot.Animations[key] = {
                            Animator = SafeFullName(animator), Name = track.Name, AnimationId = animationId,
                            Priority = tostring(track.Priority), Speed = track.Speed,
                        }
                    end
                end
            end
        end
        return snapshot
    end

    local function DiffStateSnapshots(before, after)
        local changes = {
            Instances = {}, Player = {}, ConsoleNewEntries = nil, RemoteCallDeltas = {},
            GuiChanges = {}, SoundsStarted = {}, SoundsStopped = {}, AnimationsStarted = {}, AnimationsStopped = {},
        }
        for id, old in pairs(before.Instances or {}) do
            local new = (after.Instances or {})[id]
            if not new then
                table.insert(changes.Instances, { DebugId = id, Path = old.Path, Change = "removed-or-unresolved" })
            else
                for property, oldValue in pairs(old.Properties or {}) do
                    local newValue = new.Properties and new.Properties[property]
                    if oldValue ~= newValue then
                        table.insert(changes.Instances, { DebugId = id, Path = new.Path, Property = property, Before = oldValue, After = newValue })
                    end
                end
            end
        end
        for id, new in pairs(after.Instances or {}) do
            if not (before.Instances or {})[id] then table.insert(changes.Instances, { DebugId = id, Path = new.Path, Change = "added" }) end
        end
        for key, oldValue in pairs(before.Player or {}) do
            local newValue = (after.Player or {})[key]
            if oldValue ~= newValue then changes.Player[key] = { Before = oldValue, After = newValue } end
        end
        if before.ConsoleCount and after.ConsoleCount then changes.ConsoleNewEntries = math.max(0, after.ConsoleCount - before.ConsoleCount) end
        for key, newCount in pairs(after.RemoteCounts or {}) do
            local delta = newCount - ((before.RemoteCounts or {})[key] or 0)
            if delta > 0 then changes.RemoteCallDeltas[key] = delta end
        end

        for id, oldGui in pairs(before.Gui or {}) do
            local newGui = (after.Gui or {})[id]
            if not newGui then
                table.insert(changes.GuiChanges, { DebugId = id, Path = oldGui.Path, Change = "hidden-or-removed" })
            else
                for _, field in ipairs({ "Text", "Position", "Size" }) do
                    if oldGui[field] ~= newGui[field] then
                        table.insert(changes.GuiChanges, { DebugId = id, Path = newGui.Path, Property = field, Before = oldGui[field], After = newGui[field] })
                    end
                end
            end
        end
        for id, newGui in pairs(after.Gui or {}) do
            if not (before.Gui or {})[id] then table.insert(changes.GuiChanges, { DebugId = id, Path = newGui.Path, Change = "shown-or-added", Text = newGui.Text }) end
        end

        for id, sound in pairs(after.Sounds or {}) do
            if not (before.Sounds or {})[id] then table.insert(changes.SoundsStarted, sound) end
        end
        for id, sound in pairs(before.Sounds or {}) do
            if not (after.Sounds or {})[id] then table.insert(changes.SoundsStopped, sound) end
        end
        for key, animation in pairs(after.Animations or {}) do
            if not (before.Animations or {})[key] then table.insert(changes.AnimationsStarted, animation) end
        end
        for key, animation in pairs(before.Animations or {}) do
            if not (after.Animations or {})[key] then table.insert(changes.AnimationsStopped, animation) end
        end
        return changes
    end

    Bridge:BindToType("state-observation", function(data)
        local operation = data.operation or "snapshot"
        if operation == "snapshot" or operation == "begin" then
            if data.includeRemotes == true then
                AssertRiskConfirmed(data, { "Cobalt remote-spy hooks" })
                Bridge.Callbacks["ensure-remote-spy"]({ userConfirmedRisk = data.userConfirmedRisk })
            end
            StateSnapshotCounter += 1
            if StateSnapshotCounter > 50 then StateSnapshots["snapshot:" .. tostring(StateSnapshotCounter - 50)] = nil end
            local id = "snapshot:" .. tostring(StateSnapshotCounter)
            StateSnapshots[id] = CaptureStateSnapshot(data)
            return { snapshotId = id, createdAt = StateSnapshots[id].CreatedAt, mode = operation }
        elseif operation == "diff" or operation == "end" then
            local before = StateSnapshots[data.snapshotId]
            assert(before, "Unknown snapshotId: " .. tostring(data.snapshotId))
            local captureData = {}
            for k, v in pairs(data) do captureData[k] = v end
            if captureData.targets == nil then captureData.targets = before.TargetSpecs end
            local options = before.Options or {}
            if captureData.includeConsole == nil then captureData.includeConsole = options.includeConsole end
            if captureData.includePlayer == nil then captureData.includePlayer = options.includePlayer end
            if captureData.includeRemotes == nil then captureData.includeRemotes = options.includeRemotes end
            if captureData.userConfirmedRisk == nil and options.riskApproved == true then
                captureData.userConfirmedRisk = true
            end
            if captureData.includeRemotes == true and not getgenv().Cobalt then
                AssertRiskConfirmed(captureData, { "Cobalt remote-spy hooks" })
                Bridge.Callbacks["ensure-remote-spy"]({ userConfirmedRisk = captureData.userConfirmedRisk })
            end
            if captureData.includeGui == nil then captureData.includeGui = options.includeGui end
            if captureData.includeSounds == nil then captureData.includeSounds = options.includeSounds end
            if captureData.includeAnimations == nil then captureData.includeAnimations = options.includeAnimations end
            local after = CaptureStateSnapshot(captureData)
            local diff = DiffStateSnapshots(before, after)
            if operation == "end" then StateSnapshots[data.snapshotId] = nil end
            return { snapshotId = data.snapshotId, diff = diff }
        elseif operation == "delete" then
            StateSnapshots[data.snapshotId] = nil
            return { deleted = data.snapshotId }
        end
        error("Invalid state-observation operation: " .. tostring(operation))
    end)

    Bridge:BindToType("type-text-box", function(data)
        local path = data.path
        local text = data.string or data.text
        local enter = data.enter
        local useKeyPress = data.useKeyPress

        local textBox = ResolveInstanceTarget(data)
        
        assert(typeof(textBox) == "Instance", "Target did not resolve to a valid Instance.")
        assert(textBox:IsA("TextBox"), "Resolved Instance is not a TextBox.")

        textBox:CaptureFocus()
        task.wait(0.05)
        
        if useKeyPress then
            local success = pcall(function()
                for i = 1, #text do
                    VirtualInputManager:SendTextInput(text:sub(i, i), nil, game)
                    task.wait(0.01)
                end
            end)
            
            if not success and type(keypress) == "function" then
                for i = 1, #text do
                    local char = text:sub(i, i):upper()
                    local byte = char:byte()
                    if byte then
                        keypress(byte)
                        task.wait(0.01)
                        if type(keyrelease) == "function" then
                            keyrelease(byte)
                        end
                    end
                end
            end
        else
            textBox.Text = text
        end

        if enter then
            if useKeyPress then
                if type(keypress) == "function" then
                    keypress(0x0D)
                    task.wait(0.01)
                    if type(keyrelease) == "function" then
                        keyrelease(0x0D)
                    end
                else
                    pcall(function()
                        VirtualInputManager:SendKeyEvent(true, Enum.KeyCode.Return, false, game)
                        task.wait(0.01)
                        VirtualInputManager:SendKeyEvent(false, Enum.KeyCode.Return, false, game)
                    end)
                end
            end
            textBox:ReleaseFocus(true)
        else
            textBox:ReleaseFocus(false)
        end

        return {
            status = "success",
            message = "Successfully typed into TextBox."
        }
    end)

    Bridge:BindToType("click-button", function(data)
        local path = data.path
        local action = data.Action or data.action

        local button = ResolveInstanceTarget(data)

        assert(typeof(button) == "Instance", "Target did not resolve to a valid Instance.")
        assert(button:IsA("GuiButton"), "Resolved Instance is not a GuiButton (e.g., TextButton or ImageButton).")
        assert(typeof(firesignal) == "function", "Your executor does not support 'firesignal', which is required for this command.")

        local Signals = {"Activated", "MouseButton1Down", "MouseButton2Down", "MouseButton1Click", "MouseButton2Click"}
        
        if action then
            assert(table.find(Signals, action), "Invalid action provided. Valid actions are: " .. table.concat(Signals, ", "))
            firesignal(button[action])
        else
            for _, signalName in pairs(Signals) do
                pcall(function() firesignal(button[signalName]) end)
            end
        end

        return {
            status = "success",
            message = "Successfully fired click signals on Button."
        }
    end)

    Bridge:WaitForDisconnect()

    if ActiveBridge == Bridge then
        ActiveBridge = nil
    end
    
    task.wait(1)
end
